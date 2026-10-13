import { createGame, step } from '@dice-bandits/engine';
import { afterEach, expect, it, vi } from 'vitest';
import { setLang } from '../../src/i18n';
import { postResult } from '../../src/ui/battlePostModel';

vi.mock('phaser', () => ({ default: { Scene: class Scene {} } }));
vi.mock('../../src/scenes/battle/backdrop', () => ({ drawBackdrop: vi.fn() }));
vi.mock('../../src/scenes/battle/fighters', () => ({
  drawFighters: vi.fn(() => ({ a: {}, b: {} })),
  drawDicePools: vi.fn(),
}));
const { default: BattleScene } = await import('../../src/scenes/BattleScene');

afterEach(() => setLang('en'));

function battle() {
  const state = createGame({
    seed: 'post-lifecycle',
    rounds: 12,
    seats: [
      { name: 'Ada', classId: 'knight', control: 'human', personality: null },
      { name: 'Ben', classId: 'thief', control: 'human', personality: null },
    ],
  });
  state.phase = { kind: 'duelOffer', remaining: 1, targets: [1] };
  return step(state, { type: 'duel', target: 1 }).state;
}

const previous = battle();
const next = structuredClone(previous);
next.phase = { kind: 'pvpReward', winner: 0, loser: 1 };
const result = postResult(previous, next, [
  { type: 'BattleEnded', seat: 0, params: { result: 'aWin' } },
  { type: 'GoldGained', seat: 0, params: { amount: 32 } },
])!;

it.each(['unbooted', 'stopped'] as const)(
  'leaves an %s canvas untouched for DOM-only finale playback',
  (lifecycle) => {
    const scene = Object.assign(new BattleScene(), {
      sys: { isActive: () => false },
      cameras: { main: lifecycle === 'unbooted' ? undefined : { width: 1280, height: 720 } },
      children: {
        get list() {
          throw new Error('dead display list accessed');
        },
      },
    });
    expect(() => scene.postVictory(result, 680)).not.toThrow();
    expect(() => scene.postRewards(result, 900)).not.toThrow();
    expect(() => scene.postChoice(true, false)).not.toThrow();
    expect((scene as unknown as Record<string, unknown>).postChoiceMounted).toBe(false);
  },
);

it('ignores a destroyed fighter even if its scene has not shut down yet', () => {
  const dead = {
    active: false,
    setPosition() {
      throw new Error('dead fighter mutated');
    },
  };
  const scene = Object.assign(new BattleScene(), {
    sys: { isActive: () => true },
    cameras: { main: { width: 1280, height: 720 } },
    children: { list: [] },
    tweens: { killTweensOf: vi.fn() },
    fighters: { a: dead, b: dead },
  }) as unknown as InstanceType<typeof BattleScene>;
  expect(() => scene.postVictory(result, 680)).not.toThrow();
  expect(() => scene.postRewards(result, 900)).not.toThrow();
  expect(() => scene.postChoice(true, false)).not.toThrow();
});

it('shutdown releases owned scene references and unregisters locale/resize/state callbacks', () => {
  let shutdown!: () => void;
  let active = true;
  const text = {
    setOrigin: vi.fn().mockReturnThis(),
    setDepth: vi.fn().mockReturnThis(),
    setText: vi.fn().mockReturnThis(),
  };
  const scene = Object.assign(new BattleScene(), {
    sys: { isActive: () => active },
    game: { events: { on: vi.fn(), off: vi.fn() }, registry: { get: () => previous } },
    events: {
      once: vi.fn((_name, listener: () => void) => {
        shutdown = listener;
      }),
    },
    scale: { on: vi.fn(), off: vi.fn() },
    cameras: { main: { width: 1280, height: 720 } },
    children: { list: [], removeAll: vi.fn() },
    add: { text: vi.fn(() => text) },
  });
  scene.create();
  scene.postVictory(result, 0);
  scene.postChoice(true, true);
  shutdown();
  active = false;
  const owned = scene as unknown as Record<string, unknown>;
  expect(owned.latestState).toBeUndefined();
  expect(owned.fighters).toBeUndefined();
  expect(owned.exchangeLabel).toBeUndefined();
  expect(owned.combatantIds).toBeUndefined();
  expect(owned.postWinner).toBeNull();
  expect(owned.postChoiceMounted).toBe(false);
  expect(owned.heldPostResult).toBeNull();
  expect(owned.heldPostLevelUp).toBe(false);
  setLang('th');
  expect(text.setText).not.toHaveBeenCalled();
  expect(scene.scale.off).toHaveBeenCalledWith('resize', expect.any(Function));
  expect(scene.game.events.off).toHaveBeenCalledWith('game-state', expect.any(Function), scene);
});
