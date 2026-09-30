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
} | null = null;

let listenerControl: AbortController | null = null;

/** Runs an audio action, swallowing any failure — audio must never break the game. */
function runSafely(action: () => void): void {
  try {
    action();
  } catch (error) {
    console.warn(`[audio] operation failed: ${describe(error)}`);
  }
}

/** Wraps a listener body so a dispatch on a broken audio stack never escapes. */
function listener(body: (event: Event) => void): (event: Event) => void {
  return (event: Event) => {
    runSafely(() => body(event));
  };
}

export function initAudio(deps?: {
  makeContext?: () => AudioContext | null;
  fetcher?: typeof fetch;
  storage?: Stored | null;
}): void {
  runSafely(() => {
    if (state) return;
    const storage = deps && 'storage' in deps ? (deps.storage ?? null) : loadStorage();
    state = {
      settings: loadAudioSettings(storage),
      storage,
      desiredMusic: 'none',
      runtime: null,
      ctxFactory: deps?.makeContext ?? defaultContext,
      fetcher: deps?.fetcher,
    };
    installListeners();
  });
}

export function onGameEvents(
  events: readonly GameEvent[],
  nextState: Pick<GameState, 'phase'>,
): void {
  runSafely(() => {
    for (const id of sfxForEvents(events)) playSfx(id);
    // While locked this only records the desired track — no runtime, no context, no fetch.
    setMusic(musicForState(nextState));
  });
}

export function playSfx(id: SfxId): void {
  runSafely(() => {
    const runtime = state?.runtime;
    if (!runtime || !runtime.unlocked) return;
    runtime.sfx.play(id);
  });
}

export function setMusic(track: MusicId | 'none'): void {
  runSafely(() => {
    if (!state || state.desiredMusic === track) return;
    state.desiredMusic = track;
    // Never build the AudioContext outside a user gesture (autoplay policy): while
    // locked the track is recorded and unlock() starts it.
    const runtime = state.runtime;
    if (!runtime || !runtime.unlocked) return;
    runtime.music.set(track);
  });
}

export function getAudioSettings(): AudioSettings {
  try {
    return { ...(state ? state.settings : loadAudioSettings()) };
  } catch {
    return loadAudioSettings(null);
  }
}

export function setAudioSettings(patch: Partial<AudioSettings>): AudioSettings {
  try {
    if (!state) return getAudioSettings();
    state.settings = {
      muted: patch.muted ?? state.settings.muted,
      music: patch.music ?? state.settings.music,
      sfx: patch.sfx ?? state.settings.sfx,
    };
    saveAudioSettings(state.settings, state.storage);
    if (state.runtime) applySettings(state.runtime.graph, state.settings);
    return { ...state.settings };
  } catch {
    return getAudioSettings();
  }
}

export function resetAudioForTests(): void {
  runSafely(() => {
    listenerControl?.abort();
    listenerControl = null;
    state = null;
  });
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
  runtime.graph.ctx.resume().catch((error: unknown) => {
    console.warn(`[audio] resume failed: ${describe(error)}`);
  });
  if (state.desiredMusic !== 'none') runtime.music.set(state.desiredMusic);
}

function installListeners(): void {
  listenerControl = new AbortController();
  const signal = listenerControl.signal;
  const onGesture = (): void => unlock();
  document.addEventListener('pointerdown', listener(onGesture), { capture: true, signal });
  document.addEventListener('keydown', listener(onGesture), { capture: true, signal });
  document.addEventListener(
    'click',
    listener((event) => {
      unlock();
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('button:not(:disabled)')) playSfx('click');
    }),
    { capture: true, signal },
  );
  let suspendedByVisibility = false;
  document.addEventListener(
    'visibilitychange',
    listener(() => {
      const ctx = state?.runtime?.graph.ctx;
      if (!ctx) return;
      if (document.hidden) {
        suspendedByVisibility = true;
        ctx.suspend().catch(() => undefined);
      } else if (suspendedByVisibility) {
        suspendedByVisibility = false;
        ctx.resume().catch(() => undefined);
      }
    }),
    { capture: true, signal },
  );
}

function defaultContext(): AudioContext | null {
  const scope = globalThis as { webkitAudioContext?: typeof AudioContext };
  const Ctor = globalThis.AudioContext ?? scope.webkitAudioContext;
  return Ctor ? new Ctor() : null;
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
