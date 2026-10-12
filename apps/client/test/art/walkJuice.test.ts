import type Phaser from 'phaser';
import { createGame, type GameEvent } from '@dice-bandits/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BoardScene from '../../src/scenes/BoardScene';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

beforeEach(() => {
  vi.useFakeTimers();
  window.diceBanditsSpeed = 1;
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  const state = createGame({
    seed: 'juice',
    rounds: 12,
    seats: [
      { name: 'A', classId: 'knight', control: 'human', personality: null },
      { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' },
    ],
  });
  const destination = state.board.spaces.find((s) => s.id === 1)!;
  const token = {
    x: destination.x + 100,
    y: destination.y,
    scaleX: 1.18,
    scaleY: 1.18,
    angle: 0,
    flipX: false,
    displayHeight: 85,
    setFlipX: vi.fn((flip: boolean) => {
      token.flipX = flip;
      return token;
    }),
    setPosition: vi.fn((x: number, y: number) => {
      token.x = x;
      token.y = y;
      return token;
    }),
  };
  const tag = {
    x: token.x,
    y: token.y - 89,
    destroy: vi.fn(),
    setPosition: vi.fn((x: number, y: number) => {
      tag.x = x;
      tag.y = y;
      return tag;
    }),
  };
  const shadow = {
    x: token.x,
    y: token.y,
    scaleX: 1,
    scaleY: 1,
    setPosition: vi.fn().mockReturnThis(),
    setScale: vi.fn((scale: number) => {
      shadow.scaleX = scale;
      shadow.scaleY = scale;
      return shadow;
    }),
  };
  type Puff = Record<
    'destroy' | 'setStrokeStyle' | 'setDepth' | 'setName',
    ReturnType<typeof vi.fn>
  >;
  const puffs: Puff[] = [];
  function circle(): Puff {
    const puff = {
      destroy: vi.fn(),
      setStrokeStyle: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
      setName: vi.fn().mockReturnThis(),
    };
    puffs.push(puff);
    return puff;
  }
  const configs: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
  const handles: Array<{ remove: ReturnType<typeof vi.fn> }> = [];
  const handlers = new Map<string, () => void>();
  const camera = {
    width: 1280,
    height: 720,
    setBounds: vi.fn(),
    setScroll: vi.fn(),
    ignore: vi.fn(),
  };
  const board = Object.assign(new BoardScene(), {
    game: { registry: { get: () => undefined }, events: { on: vi.fn(), off: vi.fn() } },
    cameras: { main: camera, add: () => camera, remove: vi.fn() },
    events: {
      once: (key: string, fn: () => void) => handlers.set(key, fn),
      on: vi.fn(),
      off: vi.fn(),
    },
    scale: { on: (key: string, fn: () => void) => handlers.set(key, fn), off: vi.fn() },
    tweens: {
      killTweensOf: vi.fn(),
      add: vi.fn((config) => {
        configs.push(config);
        const handle = { remove: vi.fn() };
        handles.push(handle);
        return handle;
      }),
    },
    add: { circle },
    nameTags: new Map(),
    applyViewports: vi.fn(),
    drawPaintedMap: vi.fn(),
    applyCamera: vi.fn(),
    panCameraTo: vi.fn(),
    showWalkCounter: vi.fn(),
  }) as unknown as BoardScene;
  board.create();
  const live = board as unknown as {
    latestState: typeof state;
    tokenObjects: Map<number, typeof token>;
    nameTags: Map<number, typeof tag>;
    spacePositions: Map<number, { x: number; y: number }>;
    activeShadow: typeof shadow;
  };
  live.latestState = state;
  live.tokenObjects.set(0, token);
  live.nameTags.set(0, tag);
  live.activeShadow = shadow;
  live.spacePositions.set(1, destination);
  const move: GameEvent = { type: 'Moved', seat: 0, params: { to: 1, remaining: 0 } };
  const update = (progress: number) => {
    const config = configs.find((c) => c.progress === 1)!;
    (config.targets as { progress: number }).progress = progress;
    (config.onUpdate as () => void)();
  };
  return {
    board,
    token,
    tag,
    shadow,
    puffs,
    configs,
    handles,
    handlers,
    move,
    update,
    destination,
  };
}

describe('local walk juice and lifecycle', () => {
  it('squeezes once at a genuine direction change inside the original 560ms hop', async () => {
    const s = setup();
    const done = s.board.playEvents([s.move]);
    await vi.advanceTimersByTimeAsync(300);
    expect(s.token.setFlipX).not.toHaveBeenCalled();
    expect(s.configs.filter((c) => c.progress === 1).map((c) => c.duration)).toEqual([560]);
    s.update(90 / 560);
    expect(s.token.scaleX).toBeCloseTo(1.18 * 0.05);
    expect(s.token.flipX).toBe(true);
    s.update(180 / 560);
    expect(s.token.scaleX).toBeCloseTo(1.18);
    s.update(0.6);
    expect(s.token.setFlipX).toHaveBeenCalledOnce();
    s.board.cancelLocalMovement();
    await done;
  });
  it('keeps facing on a near-vertical hop without a squeeze', async () => {
    const s = setup();
    s.token.x = s.destination.x + 5;
    s.token.flipX = true;
    const done = s.board.playEvents([s.move]);
    await vi.advanceTimersByTimeAsync(300);
    s.update(0.1);
    expect(s.token.flipX).toBe(true);
    expect(s.token.setFlipX).not.toHaveBeenCalled();
    expect(s.token.scaleX).toBe(1.18);
    s.board.cancelLocalMovement();
    await done;
  });
  it.each(['speed zero', 'reduced motion'])(
    'flips instantly without cosmetic waits for %s',
    async (policy) => {
      const s = setup();
      if (policy === 'speed zero') window.diceBanditsSpeed = 0;
      else vi.stubGlobal('matchMedia', () => ({ matches: true }));
      await s.board.playEvents([s.move]);
      expect(s.token.flipX).toBe(true);
      expect(s.configs).toEqual([]);
      expect(s.puffs).toEqual([]);
      expect(s.token).toMatchObject({
        x: s.destination.x,
        y: s.destination.y,
        angle: 0,
        scaleX: 1.18,
        scaleY: 1.18,
      });
    },
  );
  it.each(['cancel', 'resize', 'shutdown', 'destroy'])(
    'restores angle, scales, shadow and fences stale callbacks on %s',
    async (exit) => {
      const s = setup();
      const done = s.board.playEvents([s.move]);
      await vi.advanceTimersByTimeAsync(300);
      s.update(0.1);
      expect(s.token.scaleY).toBeCloseTo(1.18 * 0.82);
      expect(Math.abs(s.token.angle)).toBeGreaterThan(6);
      s.update(0.5);
      expect(s.shadow.scaleX).toBeCloseTo(0.55);
      if (exit === 'cancel') s.board.cancelLocalMovement();
      else s.handlers.get(exit)!();
      await done;
      expect(s.token).toMatchObject({ angle: 0, scaleX: 1.18, scaleY: 1.18 });
      expect(s.shadow).toMatchObject({ scaleX: 1, scaleY: 1 });
      const before = { x: s.token.x, y: s.token.y };
      s.update(0.8);
      (s.configs.find((c) => c.progress === 1)!.onComplete as () => void)();
      expect(s.token).toMatchObject(before);
      expect(s.puffs).toEqual([]);
    },
  );
  it('plants upright, follows the name tag and destroys eight landing puffs after fade', async () => {
    const s = setup();
    const done = s.board.playEvents([s.move]);
    await vi.advanceTimersByTimeAsync(300);
    s.update(0.25);
    expect(s.tag.x).toBe(s.token.x);
    expect(s.tag.y).toBeLessThan(s.token.y - s.token.displayHeight);
    (s.configs.find((c) => c.progress === 1)!.onComplete as () => void)();
    expect(s.token).toMatchObject({ angle: 0, scaleX: 1.18, scaleY: 1.18 });
    expect(s.puffs).toHaveLength(8);
    const fades = s.configs.filter((c) => c.alpha === 0);
    expect(fades).toHaveLength(8);
    for (const fade of fades) {
      expect(fade.duration).toBe(520);
      (fade.onComplete as () => void)();
    }
    expect(s.puffs.every((puff) => puff.destroy.mock.calls.length === 1)).toBe(true);
    await vi.advanceTimersByTimeAsync(970);
    await done;
  });
  it('removes dust tweens and puffs on cancel, without duplicate destruction from old callbacks', async () => {
    const s = setup();
    const done = s.board.playEvents([s.move]);
    await vi.advanceTimersByTimeAsync(300);
    (s.configs.find((c) => c.progress === 1)!.onComplete as () => void)();
    expect(s.puffs).toHaveLength(8);
    s.board.cancelLocalMovement();
    await done;
    for (const fade of s.configs.filter((c) => c.alpha === 0)) (fade.onComplete as () => void)();
    expect(s.puffs.every((puff) => puff.destroy.mock.calls.length === 1)).toBe(true);
    expect(s.handles.slice(1).every((handle) => handle.remove.mock.calls.length === 1)).toBe(true);
  });
});
