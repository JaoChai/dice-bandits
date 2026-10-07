import { createGame, type GameEvent } from '@dice-bandits/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { planMovement } from '../../src/scenes/board/movementPlan';
import { createMovementOverlay } from '../../src/scenes/board/movementOverlay';
import BoardScene from '../../src/scenes/BoardScene';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    GameObjects: { Image: class {}, Sprite: class {}, Graphics: class {} },
  },
}));

vi.mock('../../src/scenes/board/tokens', () => ({
  createHeroToken: (
    scene: { add: { image: (x: number, y: number) => unknown } },
    _class: string,
    x: number,
    y: number,
  ) => scene.add.image(x, y),
}));

const state = createGame({
  seed: 'movement-overlay',
  rounds: 12,
  seats: [
    { name: 'A', classId: 'knight', control: 'human', personality: null },
    { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
});
const moved = (to: number, remaining: number, seat = 0): GameEvent => ({
  type: 'Moved',
  seat,
  params: { to, remaining },
});
const events = [moved(6, 5), moved(7, 4), moved(8, 3), moved(9, 2), moved(10, 0)];

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers();
  const objects: Array<{ x: number; y: number; destroy: ReturnType<typeof vi.fn> }> = [];
  const tweens: Array<{ x: number; y: number; duration: number }> = [];
  const image = (x: number, y: number) => {
    const object = {
      x,
      y,
      destroy: vi.fn(),
      setAlpha: vi.fn(),
      setDepth: vi.fn(),
      setName: vi.fn(),
      setFlipX: vi.fn(),
    };
    for (const method of [object.setAlpha, object.setDepth, object.setName, object.setFlipX])
      method.mockReturnValue(object);
    objects.push(object);
    return object;
  };
  const scene = {
    game: { registry: { get: () => state } },
    add: { image },
    tweens: {
      add: vi.fn((config) => {
        tweens.push(config);
        const timer = setTimeout(() => {
          Object.assign(config.targets, { x: config.x, y: config.y });
          config.onComplete();
        }, config.duration);
        return { remove: () => clearTimeout(timer) };
      }),
    },
  };
  return {
    scene,
    objects,
    tweens,
    overlay: createMovementOverlay(scene as unknown as Phaser.Scene),
  };
}

describe('movement plan', () => {
  it('uses ordered board IDs and before-consumption counts, without changing state', () => {
    const before = JSON.stringify(state);
    const plan = planMovement(state, events, 'online');
    expect(plan.segments.map(({ to, remaining }) => [to, remaining])).toEqual([
      [6, 4],
      [7, 3],
      [8, 2],
      [9, 1],
      [10, 0],
    ]);
    expect(plan.segments.map((segment) => segment.from)).toEqual([
      state.players[0]!.pos,
      6,
      7,
      8,
      9,
    ]);
    expect(plan).toMatchObject({ landingSeat: 0, landingSpace: 10 });
    expect(JSON.stringify(state)).toBe(before);
    expect(planMovement(state, events, 'online')).toEqual(plan);
  });
  it('does not invent a landing during a fork, or accept invalid/duplicate movement', () => {
    const invalid = { type: 'Moved', seat: null, params: { to: 6, remaining: 2 } } as GameEvent;
    const plan = planMovement(state, [invalid, moved(999, 2), moved(6, 2), moved(6, 2)], 'online');
    expect(plan.segments).toHaveLength(1);
    expect(plan).toMatchObject({ landingSeat: null, landingSpace: null });
    expect(planMovement(state, [], 'online').segments).toEqual([]);
  });
  it('scales catch-up time without dropping any events', () => {
    const route = Array.from({ length: 10 }, (_, index) => moved(index + 1, 10 - index));
    const plan = planMovement(state, route, 'online');
    expect(plan.segments).toHaveLength(10);
    expect(plan.segments.reduce((sum, s) => sum + s.hopMs + s.holdMs, 0)).toBeLessThanOrEqual(600);
    expect(plan.segments.every((s) => s.hopMs <= 120 && s.holdMs === 0)).toBe(true);
  });
});

describe('detached movement overlay', () => {
  it.each(['shutdown', 'destroy', 'resize'])(
    'BoardScene %s clears real overlay ownership and stale callbacks',
    async (event) => {
      const { scene, objects } = setup();
      const handlers = new Map<string, () => void>();
      const camera = { setBounds: vi.fn(), setScroll: vi.fn(), ignore: vi.fn() };
      const board = Object.assign(Object.create(BoardScene.prototype), scene, {
        scene: { isActive: () => true },
        game: { ...scene.game, events: { on: vi.fn(), off: vi.fn() } },
        cameras: { main: camera, add: () => camera, remove: vi.fn() },
        events: {
          on: vi.fn(),
          off: vi.fn(),
          once: (name: string, fn: () => void) => handlers.set(name, fn),
        },
        scale: { on: (name: string, fn: () => void) => handlers.set(name, fn), off: vi.fn() },
        tweens: { ...scene.tweens, killTweensOf: vi.fn() },
        tokenObjects: new Map(),
        spacePositions: new Map(),
        mapImages: [],
        applyViewports: vi.fn(),
        renderBoard: vi.fn(),
      });
      board.create();
      board.presentOnlineMovement(state, state, events, 1);
      expect(objects).toHaveLength(1);
      handlers.get(event)?.();
      await vi.runAllTimersAsync();
      expect(objects[0]!.destroy).toHaveBeenCalledOnce();
      expect(scene.tweens.add).toHaveBeenCalledOnce();
    },
  );
  it('returns before delayed tweens and reaches every endpoint in order within 600 ms', async () => {
    const { overlay, objects, tweens } = setup();
    expect(overlay.play(planMovement(state, events, 'online'), 1)).toBeUndefined();
    expect(objects[0]!.x).toBe(state.board.spaces.find((s) => s.id === state.players[0]!.pos)!.x);
    for (const event of events) {
      await vi.advanceTimersByTimeAsync(120);
      const target = state.board.spaces.find((s) => s.id === event.params.to)!;
      expect(objects[0]).toMatchObject({ x: target.x, y: target.y });
    }
    expect(tweens).toHaveLength(5);
    expect(objects[0]!.destroy).toHaveBeenCalledOnce();
  });
  it('new generations, empty views and destroy cancel old callbacks without hiding authoritative tokens', async () => {
    const { overlay, objects, tweens } = setup();
    const plan = planMovement(state, events, 'online');
    overlay.play(plan, 1);
    overlay.play(plan, 2);
    expect(objects[0]!.destroy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(120);
    expect(tweens).toHaveLength(3);
    overlay.play(planMovement(state, [], 'online'), 3);
    expect(objects[1]!.destroy).toHaveBeenCalledOnce();
    overlay.play(plan, 4);
    overlay.destroy();
    overlay.destroy();
    await vi.runAllTimersAsync();
    expect(objects[2]!.destroy).toHaveBeenCalledOnce();
    expect(tweens).toHaveLength(4);
  });
  it.each([0, 1])('creates no moving ghost with speed %s / reduced motion', (speed) => {
    window.diceBanditsSpeed = speed;
    const { overlay, objects } = setup();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    overlay.play(planMovement(state, events, 'online'), 1);
    expect(objects).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
