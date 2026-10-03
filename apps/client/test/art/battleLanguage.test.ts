import { createGame } from '@dice-bandits/engine';
import { afterEach, expect, it, vi } from 'vitest';
import { setLang } from '../../src/i18n';

vi.mock('phaser', () => ({ default: { Scene: class Scene {} } }));
vi.mock('../../src/scenes/battle/backdrop', () => ({ drawBackdrop: vi.fn() }));
vi.mock('../../src/scenes/battle/fighters', () => ({
  drawFighters: vi.fn(() => ({ a: {}, b: {} })),
  drawDicePools: vi.fn(),
}));
vi.mock('../../src/scenes/battle/effects', () => ({ playCoinBurst: vi.fn(), playHit: vi.fn() }));
const { playCoinBurst } = await import('../../src/scenes/battle/effects');
const { default: BattleScene } = await import('../../src/scenes/BattleScene');
afterEach(() => setLang('en'));

it('does not run the unreachable battle-scene GoldStolen effect', async () => {
  vi.mocked(playCoinBurst).mockClear();
  const scene = Object.assign(Object.create(BattleScene.prototype), {
    combatantIds: [0, 1],
  }) as InstanceType<typeof BattleScene>;
  await scene.playEvents([{ type: 'GoldStolen', seat: 0, params: {} }], 1);
  expect(playCoinBurst).not.toHaveBeenCalled();
});

it('updates the canvas exchange label when switching English to Thai mid-battle', () => {
  setLang('en');
  const state = createGame({
    seed: 'exchange-label',
    rounds: 12,
    seats: [
      { name: 'A', classId: 'knight', control: 'human', personality: null },
      { name: 'B', classId: 'thief', control: 'human', personality: null },
    ],
  });
  state.phase = {
    kind: 'battle',
    battle: {
      context: 'pvp',
      spaceId: state.players[0]!.pos,
      a: {
        kind: 'player',
        seat: 0,
        monsterId: null,
        level: 1,
        hp: 20,
        stats: state.players[0]!.stats,
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
      b: {
        kind: 'player',
        seat: 1,
        monsterId: null,
        level: 1,
        hp: 20,
        stats: state.players[1]!.stats,
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
      exchange: 1,
      half: 1,
      attackerSide: 'a',
      pending: { attack: null, defense: null },
    },
  };
  const text = { setOrigin: vi.fn(), setDepth: vi.fn(), setText: vi.fn() };
  text.setOrigin.mockReturnValue(text);
  text.setDepth.mockReturnValue(text);
  const shutdown = vi.fn();
  const scene = Object.assign(Object.create(BattleScene.prototype), {
    game: { events: { on: vi.fn(), off: vi.fn() }, registry: { get: () => state } },
    events: { once: vi.fn((_name, listener) => shutdown.mockImplementation(listener)) },
    children: { removeAll: vi.fn() },
    add: { text: vi.fn(() => text) },
  }) as InstanceType<typeof BattleScene>;
  scene.create();
  expect(scene.add.text).toHaveBeenCalledWith(
    640,
    expect.any(Number),
    'Exchange 1',
    expect.any(Object),
  );
  setLang('th');
  expect(text.setText).toHaveBeenCalledWith('ยกที่ 1');
  shutdown();
});
