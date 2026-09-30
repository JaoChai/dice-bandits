import { beforeEach, describe, expect, it } from 'vitest';
import type { GameEvent, GameState } from '@dice-bandits/engine';
import {
  getAudioSettings,
  initAudio,
  onGameEvents,
  playSfx,
  resetAudioForTests,
  setAudioSettings,
  setMusic,
} from '../../src/audio';
import {
  asAudioContext,
  FakeAudioBuffer,
  FakeAudioContext,
  fakeAudioUrlMap,
  fakeFetch,
  flushAudio,
  sourcesOf,
} from './fakeAudio';

const event = (type: string): GameEvent => ({ type, seat: null, params: {} });
const boardState = { phase: { kind: 'board' } } as unknown as Pick<GameState, 'phase'>;
const battleState = { phase: { kind: 'battle' } } as unknown as Pick<GameState, 'phase'>;

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

interface Harness {
  fake: FakeAudioContext;
  fireOnBody: (type: string) => void;
}

function harness(options?: {
  makeContext?: () => AudioContext | null;
  storage?: ReturnType<typeof memoryStorage> | null;
}): Harness {
  const fake = new FakeAudioContext();
  const fetcher = fakeFetch(fakeAudioUrlMap());
  const storage = options?.storage === undefined ? memoryStorage() : options.storage;
  initAudio({
    makeContext: options?.makeContext ?? (() => asAudioContext(fake)),
    fetcher,
    now: () => 0,
    storage,
  });
  return {
    fake,
    fireOnBody: (type: string) => {
      document.body.dispatchEvent(new Event(type, { bubbles: true }));
    },
  };
}

function startedSources(fake: FakeAudioContext) {
  return sourcesOf(fake).filter((source) => source.started);
}

function startedMusic(fake: FakeAudioContext) {
  return startedSources(fake).filter((source) => source.loop);
}

function startedSfx(fake: FakeAudioContext) {
  return startedSources(fake).filter((source) => !source.loop);
}

beforeEach(() => {
  resetAudioForTests();
  document.body.innerHTML = '';
});

describe('audio public API', () => {
  it('does not create, resume or start anything before the first gesture', async () => {
    const h = harness();
    playSfx('click');
    setMusic('board');
    onGameEvents([event('DiceRolled')], battleState);
    await flushAudio();
    expect(h.fake.sources.length).toBe(0);
    expect(h.fake.resumeCalls).toBe(0);
    expect(getAudioSettings()).toEqual({ muted: false, music: 0.5, sfx: 0.8 });
  });

  it('unlocks once on the first pointerdown and starts the desired music', async () => {
    const h = harness();
    setMusic('board');
    h.fireOnBody('pointerdown');
    await flushAudio();
    expect(h.fake.resumeCalls).toBe(1);
    expect(startedMusic(h.fake).length).toBe(1);
    h.fireOnBody('pointerdown');
    h.fireOnBody('keydown');
    await flushAudio();
    expect(h.fake.resumeCalls).toBe(1);
  });

  it('plays mapped event sounds and switches music to battle after unlock', async () => {
    const h = harness();
    h.fireOnBody('pointerdown');
    await flushAudio();
    const returned = onGameEvents(
      [event('DiceRolled'), event('DamageDealt'), event('DiceRolled'), event('TurnEnded')],
      battleState,
    );
    await flushAudio();
    expect(returned).toBeUndefined();
    expect(startedSfx(h.fake).length).toBe(2);
    // Only the battle track plays: nothing is started until a screen or state asks for music.
    expect(startedMusic(h.fake).length).toBe(1);
    expect((startedMusic(h.fake)[0]?.buffer as unknown as FakeAudioBuffer).duration).toBe(12);
  });

  it('ignores event sounds that arrive while still locked', async () => {
    const h = harness();
    setMusic('board');
    onGameEvents([event('DiceRolled')], battleState);
    await flushAudio();
    expect(startedSfx(h.fake).length).toBe(0);
    h.fireOnBody('keydown');
    await flushAudio();
    expect(startedSfx(h.fake).length).toBe(0);
    expect(startedMusic(h.fake).length).toBe(1);
  });

  it('is a safe no-op everywhere when no AudioContext can be created', async () => {
    const h = harness({ makeContext: () => null });
    expect(() => {
      setMusic('board');
      playSfx('dice');
      onGameEvents([event('DiceRolled')], battleState);
      h.fireOnBody('pointerdown');
      setAudioSettings({ muted: true });
    }).not.toThrow();
    await flushAudio();
    expect(getAudioSettings()).toEqual({ muted: true, music: 0.5, sfx: 0.8 });
  });

  it('is a safe no-op everywhere when the context factory throws', async () => {
    const h = harness({
      makeContext: () => {
        throw new Error('audio unavailable');
      },
    });
    expect(() => {
      h.fireOnBody('pointerdown');
      playSfx('dice');
      onGameEvents([event('GoldGained')], boardState);
    }).not.toThrow();
    await flushAudio();
  });

  it('suspends on hidden and resumes once on visible', async () => {
    const h = harness();
    h.fireOnBody('pointerdown');
    await flushAudio();
    const resumedAtUnlock = h.fake.resumeCalls;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    h.fireOnBody('visibilitychange');
    expect(h.fake.suspendCalls).toBe(1);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    h.fireOnBody('visibilitychange');
    h.fireOnBody('visibilitychange');
    await flushAudio();
    expect(h.fake.resumeCalls).toBe(resumedAtUnlock + 1);
    delete (document as { hidden?: unknown }).hidden;
  });

  it('persists settings changes and applies mute immediately', async () => {
    const storage = memoryStorage();
    const h = harness({ storage });
    const updated = setAudioSettings({ muted: true, music: 0.2 });
    expect(updated).toEqual({ muted: true, music: 0.2, sfx: 0.8 });
    expect(getAudioSettings()).toEqual(updated);
    expect(storage.getItem('diceBandits.audio')).toBe(JSON.stringify(updated));
    h.fireOnBody('pointerdown');
    await flushAudio();
    // Master is the first gain created by createGraph.
    const master = h.fake.gains[0];
    expect(master?.gain.value).toBe(0);
  });

  it('plays the click sound for enabled buttons only', async () => {
    const h = harness();
    h.fireOnBody('pointerdown');
    await flushAudio();
    document.body.innerHTML = '<button id="on">Go</button><button id="off" disabled>Nope</button>';
    const enabled = document.getElementById('on') as HTMLButtonElement;
    const disabled = document.getElementById('off') as HTMLButtonElement;
    enabled.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAudio();
    expect(startedSfx(h.fake).length).toBe(1);
    disabled.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAudio();
    expect(startedSfx(h.fake).length).toBe(1);
  });

  it('ignores repeated initAudio calls', async () => {
    const h = harness();
    initAudio({});
    h.fireOnBody('pointerdown');
    await flushAudio();
    expect(h.fake.resumeCalls).toBe(1);
    expect(startedMusic(h.fake).length).toBe(0);
  });

  it('re-initialises cleanly after resetAudioForTests', async () => {
    harness();
    resetAudioForTests();
    const second = harness();
    setMusic('board');
    second.fireOnBody('pointerdown');
    await flushAudio();
    expect(second.fake.resumeCalls).toBe(1);
    expect(startedMusic(second.fake).length).toBe(1);
  });
});
