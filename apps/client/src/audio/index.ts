import type { GameEvent, GameState } from '@dice-bandits/engine';
import { applySettings, createGraph, type AudioGraph } from './context';
import { SfxPlayer, type SfxPlayer as Player } from './sfx';
import { MusicPlayer } from './music';
import { musicForState, sfxForEvents, type MusicId, type SfxId } from './events';
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from './settings';
import { recordAudioStart } from './testHooks';

const SFX_URL = (id: SfxId): string => `/audio/sfx/${id}.wav`;

let musicExtension: '.ogg' | '.mp3' | null = null;

function musicUrl(id: MusicId): string {
  if (musicExtension === null) {
    try {
      const supported = new globalThis.Audio().canPlayType('audio/ogg; codecs="vorbis"');
      musicExtension = supported === '' ? '.mp3' : '.ogg';
    } catch {
      musicExtension = '.mp3';
    }
  }
  return `/audio/music/${id}${musicExtension}`;
}

type Stored = Pick<Storage, 'getItem' | 'setItem'>;

interface AudioRuntime {
  graph: AudioGraph;
  sfx: Player;
  music: ReturnType<typeof MusicPlayer>;
  unlocked: boolean;
}

let state: {
  settings: AudioSettings;
  storage: Stored | null;
  desiredMusic: MusicId | 'none';
  runtime: AudioRuntime | null;
  ctxFactory: () => AudioContext | null;
  fetcher?: typeof fetch;
  now: () => number;
} | null = null;

let listenerControl: AbortController | null = null;

export function initAudio(deps?: {
  makeContext?: () => AudioContext | null;
  fetcher?: typeof fetch;
  now?: () => number;
  storage?: Stored | null;
}): void {
  if (state) return;
  const storage = deps && 'storage' in deps ? (deps.storage ?? null) : loadStorage();
  state = {
    settings: loadAudioSettings(storage),
    storage,
    desiredMusic: 'none',
    runtime: null,
    ctxFactory: deps?.makeContext ?? defaultContext,
    fetcher: deps?.fetcher,
    now: deps?.now ?? defaultClock,
  };
  installListeners();
}

export function onGameEvents(
  events: readonly GameEvent[],
  nextState: Pick<GameState, 'phase'>,
): void {
  for (const id of sfxForEvents(events)) playSfx(id);
  setMusic(musicForState(nextState));
}

export function playSfx(id: SfxId): void {
  const runtime = state?.runtime;
  if (!runtime || !runtime.unlocked) return;
  runtime.sfx.play(id);
}

export function setMusic(track: MusicId | 'none'): void {
  if (!state || state.desiredMusic === track) return;
  state.desiredMusic = track;
  const runtime = ensureRuntime();
  if (!runtime || !runtime.unlocked) return;
  runtime.music.set(track);
}

export function getAudioSettings(): AudioSettings {
  return { ...(state ? state.settings : loadAudioSettings()) };
}

export function setAudioSettings(patch: Partial<AudioSettings>): AudioSettings {
  if (!state) return getAudioSettings();
  state.settings = {
    muted: patch.muted ?? state.settings.muted,
    music: patch.music ?? state.settings.music,
    sfx: patch.sfx ?? state.settings.sfx,
  };
  saveAudioSettings(state.settings, state.storage);
  if (state.runtime) applySettings(state.runtime.graph, state.settings);
  return { ...state.settings };
}

export function resetAudioForTests(): void {
  listenerControl?.abort();
  listenerControl = null;
  state = null;
}

function ensureRuntime(): AudioRuntime | null {
  if (!state) return null;
  if (state.runtime) return state.runtime;
  try {
    const ctx = state.ctxFactory();
    if (!ctx) return null;
    const graph = createGraph(() => ctx);
    applySettings(graph, state.settings);
    const sfx = SfxPlayer(graph, {
      url: SFX_URL,
      now: state.now,
      onStart: recordAudioStart,
      fetcher: state.fetcher,
    });
    const music = MusicPlayer(graph, { url: musicUrl, fetcher: state.fetcher });
    sfx.preload();
    state.runtime = { graph, sfx, music, unlocked: false };
    return state.runtime;
  } catch (error) {
    console.warn(`[audio] init failed: ${describe(error)}`);
    state.ctxFactory = () => null;
    return null;
  }
}

function unlock(): void {
  if (!state || (state.runtime && state.runtime.unlocked)) return;
  const runtime = ensureRuntime();
  if (!runtime || runtime.unlocked) return;
  runtime.unlocked = true;
  void runtime.graph.ctx.resume().catch((error: unknown) => {
    console.warn(`[audio] resume failed: ${describe(error)}`);
  });
  if (state.desiredMusic !== 'none') runtime.music.set(state.desiredMusic);
}

function installListeners(): void {
  listenerControl = new AbortController();
  const signal = listenerControl.signal;
  const onGesture = () => unlock();
  document.addEventListener('pointerdown', onGesture, { capture: true, signal });
  document.addEventListener('keydown', onGesture, { capture: true, signal });
  document.addEventListener(
    'click',
    (event) => {
      unlock();
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('button:not(:disabled)')) playSfx('click');
    },
    { capture: true, signal },
  );
  let suspendedByVisibility = false;
  document.addEventListener(
    'visibilitychange',
    () => {
      const ctx = state?.runtime?.graph.ctx;
      if (!ctx) return;
      if (document.hidden) {
        suspendedByVisibility = true;
        void ctx.suspend().catch(() => undefined);
      } else if (suspendedByVisibility) {
        suspendedByVisibility = false;
        void ctx.resume().catch(() => undefined);
      }
    },
    { capture: true, signal },
  );
}

function defaultContext(): AudioContext | null {
  const Ctor = globalThis.AudioContext;
  return Ctor ? new Ctor() : null;
}

function defaultClock(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

function loadStorage(): Stored | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
