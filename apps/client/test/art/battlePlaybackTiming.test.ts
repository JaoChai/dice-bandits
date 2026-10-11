import { createGame } from '@dice-bandits/engine';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BattleBeat } from '../../src/scenes/battle/presentation';

// Synthetic scheduler isolation: scene time and monotonic wall time advance independently.
// The real planner and actual browser/engine outcomes are covered by separate tests.
const doubles = vi.hoisted(() => ({
  plan: vi.fn(),
  reduced: vi.fn(() => false),
  destroy: vi.fn(),
  showBeat: vi.fn(),
}));
vi.mock('phaser', () => ({ default: { Scene: class Scene {} } }));
vi.mock('../../src/art/motion', () => ({ reducedMotion: doubles.reduced }));
vi.mock('../../src/scenes/battle/presentation', () => ({ planBattle: doubles.plan }));
vi.mock('../../src/scenes/battle/effects', () => ({
  createBattleEffects: () => ({ destroy: doubles.destroy, showBeat: doubles.showBeat }),
}));
const { default: BattleScene } = await import('../../src/scenes/BattleScene');

const timings: Array<[BattleBeat['kind'], number]> = [
  ['reveal', 240],
  ['anticipation', 220],
  ['lunge', 160],
  ['impact', 100],
  ['damage', 500],
  ['drain', 350],
  ['result', 650],
];
const makeBeat = ([kind, duration]: [BattleBeat['kind'], number]): BattleBeat => ({
  kind,
  duration,
  targets: [],
  result: null,
});
const state = createGame({
  seed: 'scheduler-isolation',
  rounds: 12,
  seats: [
    { name: 'A', classId: 'knight', control: 'human', personality: null },
    { name: 'B', classId: 'thief', control: 'human', personality: null },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  doubles.reduced.mockReturnValue(false);
  doubles.plan.mockImplementation((_previous, _next, _events, _mode, reduced: boolean) =>
    (reduced ? [['result', 0] as [BattleBeat['kind'], number]] : timings).map(makeBeat),
  );
});
afterEach(() => vi.restoreAllMocks());

function scheduler() {
  let wall = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => wall);
  const timers: Array<{
    delay: number;
    elapsed: number;
    fire: () => void;
    removed: boolean;
    remove: ReturnType<typeof vi.fn>;
  }> = [];
  const clock = {
    paused: false,
    timeScale: 1,
    delayedCall(delay: number, fire: () => void) {
      const timer = {
        delay,
        elapsed: 0,
        fire,
        removed: false,
        remove: vi.fn(() => {
          timer.removed = true;
        }),
      };
      timers.push(timer);
      return timer;
    },
  };
  const scene = Object.assign(Object.create(BattleScene.prototype), {
    time: clock,
    fighters: { a: {}, b: {} },
    presentationRevision: 0,
  }) as InstanceType<typeof BattleScene>;
  const seen: Array<{ kind: string; at: number; duration: number }> = [];
  const onCancel = vi.fn();
  let settled = 0;
  const play = (speed = 1, mode: 'human' | 'bot' | 'online' = 'human') =>
    scene
      .playEvents([], speed, {
        previous: state,
        next: state,
        mode,
        onBeat: (beat) => seen.push({ kind: beat.kind, at: wall, duration: beat.duration }),
        onCancel,
      })
      .then(() => {
        settled++;
      });
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  return {
    scene,
    timers,
    clock,
    seen,
    play,
    onCancel,
    get settled() {
      return settled;
    },
    get wall() {
      return wall;
    },
    setWall(value: number) {
      wall = value;
    },
    async fireAt(at: number, index = timers.length - 1) {
      wall = at;
      timers[index]!.fire();
      await flush();
    },
    async frame(rawWall: number, sceneDelta: number) {
      wall += rawWall;
      // Preserve Phaser eligibility: paused/zero-scale clocks cannot dispatch.
      const timer = timers.at(-1);
      if (!clock.paused && timer && !timer.removed) {
        timer.elapsed += sceneDelta * clock.timeScale;
        if (timer.elapsed >= timer.delay) timer.fire();
      }
      await flush();
    },
  };
}

it('human reveal cannot advance at 180 wall ms even when its 240ms scene timer fires', async () => {
  const s = scheduler();
  const playback = s.play();
  await s.fireAt(180);
  expect(s.seen.map((beat) => beat.kind)).toEqual(['reveal']);
  expect(s.settled).toBe(0);
  expect(s.timers.at(-1)!.delay).toBe(60);
  await s.fireAt(239.5);
  expect(s.seen.map((beat) => beat.kind)).toEqual(['reveal']);
  expect(s.timers.at(-1)!.delay).toBe(0.5);
  await s.fireAt(240);
  expect(s.seen.map((beat) => beat.kind)).toEqual(['reveal', 'anticipation']);
  s.scene.cancelBattlePresentation();
  await playback;
});

it('each human beat retains its own floor after late frames, including a late final result', async () => {
  const s = scheduler();
  const playback = s.play();
  await s.fireAt(300);
  await s.fireAt(519.5);
  expect(s.seen.map((beat) => beat.kind)).toEqual(['reveal', 'anticipation']);
  expect(s.timers.at(-1)!.delay).toBe(0.5);
  await s.fireAt(520);
  for (const at of [680, 780, 1280, 1630]) await s.fireAt(at);
  await s.fireAt(2279.5);
  expect(s.settled).toBe(0);
  await s.fireAt(2280);
  await playback;
  expect(s.seen.map((beat) => beat.at)).toEqual([0, 300, 520, 680, 780, 1280, 1630]);
  expect(s.wall).toBeGreaterThanOrEqual(2220);
  expect(s.settled).toBe(1);
  expect(doubles.destroy).toHaveBeenCalledTimes(1);
});

for (const [speed, factor] of [
  [0.5, 0.5],
  [2, 1],
] as const)
  it(`scaled human waits keep existing speed contract at speed ${speed}`, async () => {
    const s = scheduler();
    const playback = s.play(speed);
    for (const [, duration] of timings) {
      await s.fireAt(s.wall + duration * factor - 0.5);
      expect(s.timers.at(-1)!.delay).toBe(0.5);
      await s.fireAt(s.wall + 0.5);
    }
    await playback;
    expect(s.seen.map((beat) => beat.duration)).toEqual(
      timings.map(([, duration]) => duration * factor),
    );
    expect(s.wall).toBe(2220 * factor);
  });

for (const speed of [0, -1])
  it(`speed ${speed} reconciles a static result without a timer`, async () => {
    const s = scheduler();
    await s.play(speed);
    expect(s.seen).toEqual([{ kind: 'result', at: 0, duration: 0 }]);
    expect(s.timers).toHaveLength(0);
  });

it('reduced motion reconciles a static result without a timer', async () => {
  doubles.reduced.mockReturnValue(true);
  const s = scheduler();
  await s.play();
  expect(s.seen).toEqual([{ kind: 'result', at: 0, duration: 0 }]);
  expect(s.timers).toHaveLength(0);
});

it('cancel rearmed wait settles once and ignores hostile late callbacks', async () => {
  const s = scheduler();
  const playback = s.play();
  await s.fireAt(180);
  const rearmed = s.timers.at(-1)!;
  s.setWall(190);
  s.scene.cancelBattlePresentation();
  await playback;
  expect(rearmed.remove).toHaveBeenCalledWith(false);
  expect(s.settled).toBe(1);
  expect(s.onCancel).toHaveBeenCalledTimes(1);
  expect(doubles.destroy).toHaveBeenCalledTimes(1);
  await s.fireAt(200);
  await s.fireAt(240, 0);
  expect(s.timers).toHaveLength(2);
  expect(s.seen).toHaveLength(1);
  expect(s.settled).toBe(1);
});

it('replacement cancels the newest timer and isolates old callbacks from the new wait', async () => {
  const s = scheduler();
  const first = s.play();
  await s.fireAt(180);
  const old = s.timers.length - 1;
  s.setWall(190);
  const second = s.play();
  await first;
  expect(s.timers[old]!.removed).toBe(true);
  await s.fireAt(200, old);
  await s.fireAt(430, old);
  expect(s.timers).toHaveLength(3);
  expect(s.seen.map((beat) => beat.kind)).toEqual(['reveal', 'reveal']);
  expect(s.settled).toBe(1);
  await s.fireAt(430);
  expect(s.seen.map((beat) => beat.kind)).toEqual(['reveal', 'reveal', 'anticipation']);
  s.scene.cancelBattlePresentation();
  await second;
  expect(s.settled).toBe(2);
  expect(doubles.destroy).toHaveBeenCalledTimes(2);
});

it('pause wall time is included but only resumed scene callbacks can advance', async () => {
  const s = scheduler();
  const playback = s.play();
  await s.fireAt(180);
  s.clock.paused = true;
  await s.frame(1000, 1000);
  expect(s.seen).toHaveLength(1);
  expect(s.settled).toBe(0);
  s.clock.paused = false;
  await s.frame(60, 60);
  expect(s.seen.map((beat) => beat.at)).toEqual([0, 1240]);
  await s.fireAt(1459.5);
  expect(s.seen).toHaveLength(2);
  await s.fireAt(1460);
  expect(s.seen.at(-1)!.kind).toBe('lunge');
  s.scene.cancelBattlePresentation();
  await playback;
});

it('zero timeScale freezes scene dispatch until cancellation', async () => {
  const s = scheduler();
  s.clock.timeScale = 0;
  const playback = s.play();
  await s.frame(1000, 1000);
  expect(s.seen).toHaveLength(1);
  expect(s.settled).toBe(0);
  s.scene.cancelBattlePresentation();
  await playback;
  expect(s.settled).toBe(1);
});

for (const [scale, at] of [
  [0.5, 480],
  [2, 240],
] as const)
  it(`timeScale ${scale} preserves scene eligibility and the human wall floor`, async () => {
    const s = scheduler();
    s.clock.timeScale = scale;
    const playback = s.play();
    if (scale === 0.5) {
      await s.frame(240, 240);
      expect(s.seen).toHaveLength(1);
      await s.frame(240, 240);
    } else {
      await s.frame(120, 120);
      expect(s.seen).toHaveLength(1);
      expect(s.timers.at(-1)!.delay).toBe(120);
      await s.frame(60, 60);
      expect(s.seen).toHaveLength(1);
      await s.frame(60, 60);
    }
    expect(s.seen.map((beat) => beat.at)).toEqual([0, at]);
    s.scene.cancelBattlePresentation();
    await playback;
  });

for (const mode of ['bot', 'online'] as const)
  it(`${mode} retains cumulative deadline scheduling without a human floor`, async () => {
    doubles.plan.mockReturnValue(timings.slice(0, 2).map(makeBeat));
    const s = scheduler();
    const playback = s.play(1, mode);
    expect(s.timers[0]!.delay).toBe(216);
    await s.fireAt(300);
    expect(s.timers.at(-1)!.delay).toBe(114);
    await s.fireAt(350);
    await playback;
    expect(s.seen.map((beat) => beat.at)).toEqual([0, 300]);
    expect(s.timers).toHaveLength(2);
    expect(s.settled).toBe(1);
  });

it('empty plans preserve cancellation with no wait or effects', async () => {
  doubles.plan.mockReturnValue([]);
  const s = scheduler();
  await s.play();
  expect(s.onCancel).toHaveBeenCalledTimes(1);
  expect(s.seen).toEqual([]);
  expect(s.timers).toHaveLength(0);
  expect(doubles.destroy).not.toHaveBeenCalled();
});
