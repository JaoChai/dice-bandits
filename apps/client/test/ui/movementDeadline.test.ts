import type Phaser from 'phaser';
import { createGame, step } from '@dice-bandits/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMovementOverlay } from '../../src/scenes/board/movementOverlay';
import { planMovement } from '../../src/scenes/board/movementPlan';

vi.mock('../../src/scenes/board/tokens', () => ({
  createHeroToken: (
    scene: { add: { image: (x: number, y: number) => unknown } },
    _class: string,
    x: number,
    y: number,
  ) => scene.add.image(x, y),
}));

beforeEach(() => {
  vi.useFakeTimers();
  window.diceBanditsSpeed = 1;
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup() {
  // Use Phaser's real TweenManager: its >500ms lag smoothing consumes only
  // 33ms of a stalled frame, unlike the ideal setTimeout mocks in older tests.
  const { default: TweenManager } = await vi.importActual<{
    default: new (scene: Phaser.Scene) => Phaser.Tweens.TweenManager & { start(): void };
  }>(
    new URL('../../../../node_modules/phaser/src/tweens/TweenManager.js', import.meta.url).pathname,
  );
  const previous = createGame({
    seed: 'ghost-six-2',
    rounds: 12,
    seats: [
      { name: 'A', classId: 'knight', control: 'human', personality: null },
      { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' },
    ],
  });
  const { state: next, events } = step(previous, { type: 'roll' });
  const plan = planMovement(previous, events, 'online');
  expect(plan.segments).toHaveLength(6);
  expect(plan.segments.map((s) => s.hopMs)).toEqual([100, 100, 100, 100, 100, 100]);
  const objects: Array<{ x: number; y: number; destroy: ReturnType<typeof vi.fn> }> = [];
  const scene = {
    sys: { events: { once: vi.fn(), on: vi.fn(), off: vi.fn() } },
    game: { registry: { get: () => next } },
    add: {
      image: (x: number, y: number) => {
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
      },
    },
    tweens: undefined as Phaser.Tweens.TweenManager | undefined,
  };
  const tweens = new TweenManager(scene as unknown as Phaser.Scene);
  scene.tweens = tweens;
  tweens.start();
  const before = JSON.stringify(next);
  const overlay = createMovementOverlay(scene as unknown as Phaser.Scene);
  return { overlay, objects, tweens, plan, next, before };
}

describe('online movement wall-clock deadline', () => {
  it('does not retain a ghost beyond the existing 2s cleanup deadline after a stalled frame', async () => {
    const { overlay, objects, tweens, plan } = await setup();
    overlay.play(plan, 1);
    tweens.tick();
    await vi.advanceTimersByTimeAsync(2000);
    tweens.tick();
    expect(tweens.time).toBeCloseTo(0.033);
    expect(objects[0]!.destroy).toHaveBeenCalledOnce();
  });

  it('clears six real moves at 600ms even when Phaser frame time is lag-smoothed', async () => {
    const { overlay, objects, tweens, plan, next, before } = await setup();
    expect(overlay.play(plan, 1)).toBeUndefined();
    tweens.tick();
    await vi.advanceTimersByTimeAsync(550);
    tweens.tick();
    // The real manager advanced only 33ms, not the 550ms wall-clock gap.
    expect(tweens.time).toBeCloseTo(0.033);
    expect(objects[0]!.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(objects[0]!.destroy).toHaveBeenCalledOnce();
    for (let frame = 0; frame < 180; frame++) {
      await vi.advanceTimersByTimeAsync(16);
      tweens.tick();
    }
    expect(objects).toHaveLength(1);
    expect(objects[0]!.destroy).toHaveBeenCalledOnce();
    expect(JSON.stringify(next)).toBe(before);
    expect(tweens.getTweens()).toHaveLength(0);
  });

  it('cancels the old deadline without clearing a newer generation', async () => {
    const { overlay, objects, tweens, plan } = await setup();
    overlay.play(plan, 1);
    await vi.advanceTimersByTimeAsync(300);
    overlay.play(plan, 2);
    expect(objects[0]!.destroy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(300);
    expect(objects[1]!.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(objects[1]!.destroy).toHaveBeenCalledOnce();
    overlay.destroy();
    await vi.runAllTimersAsync();
    tweens.tick();
    expect(objects).toHaveLength(2);
    expect(objects.every((object) => object.destroy.mock.calls.length === 1)).toBe(true);
  });
});
