import { EventEmitter } from 'node:events';
import { createGame } from '@dice-bandits/engine';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  BATTLE_EXCHANGE_Y,
  BATTLE_FRAME,
  BATTLE_FIGHTER_HEIGHT,
  battleLayout,
} from '../../src/scenes/battle/layout';

vi.mock('phaser', () => ({ default: { Scene: class Scene {} } }));
vi.mock('../../src/scenes/battle/backdrop', () => ({ drawBackdrop: vi.fn() }));
vi.mock('../../src/scenes/battle/fighters', () => ({
  drawFighters: vi.fn(() => ({ a: {}, b: {} })),
  drawDicePools: vi.fn(),
}));
vi.mock('../../src/scenes/battle/effects', () => ({ playCoinBurst: vi.fn(), playHit: vi.fn() }));
const { default: BattleScene } = await import('../../src/scenes/BattleScene');

/** 720p battle composition, mirrored from layout.ts: fighters on the ground line. */
const GROUND = (BATTLE_FRAME.height * 11) / 12;
const layout = battleLayout();

const battlePhaseState = () => {
  const state = createGame({
    seed: 'battle-coords',
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
  return state;
};

function battleScene() {
  const created: Array<{ kind: string; x: number; y: number; object: Record<string, unknown> }> =
    [];
  let onGameState: ((state: ReturnType<typeof battlePhaseState>) => void) | undefined;
  const scene = Object.assign(Object.create(BattleScene.prototype), {
    game: {
      events: {
        on: vi.fn(
          (_name: string, listener: (state: ReturnType<typeof battlePhaseState>) => void) => {
            onGameState = listener;
          },
        ),
        off: vi.fn(),
      },
      registry: { get: () => undefined },
    },
    scale: new EventEmitter(),
    events: { once: vi.fn() },
    cameras: { main: { width: 1280, height: 720 } },
    children: { removeAll: vi.fn() },
    add: {
      text: vi.fn((x: number, y: number, value: string) => {
        const text = {
          setOrigin: vi.fn().mockReturnThis(),
          setDepth: vi.fn().mockReturnThis(),
          setText: vi.fn().mockReturnThis(),
          destroy: vi.fn(),
        };
        created.push({ kind: value, x, y, object: text });
        return text;
      }),
    },
    time: { delayedCall: vi.fn((_delay: number, fire: () => void) => fire()) },
    tweens: {
      add: vi.fn((spec: Record<string, unknown>) => {
        (spec.onComplete as (() => void) | undefined)?.();
        return spec;
      }),
    },
  }) as InstanceType<typeof BattleScene>;
  return {
    scene,
    created,
    render: (state: ReturnType<typeof battlePhaseState>) => onGameState?.call(scene, state),
  };
}

beforeEach(() => vi.clearAllMocks());

it('derives the exchange label from the frame, not the 640x360 constants', () => {
  const { scene, created, render } = battleScene();
  scene.create();
  render(battlePhaseState());
  const label = created.find((entry) => entry.kind === 'Exchange 1');
  expect(label, 'exchange label rendered').toBeDefined();
  // Round 2, reviewer item 2: centred on the 1280 stage, not the left quarter.
  expect(label!.x).toBe(BATTLE_FRAME.width / 2);
  expect(BATTLE_EXCHANGE_Y).toBeLessThan(GROUND - BATTLE_FIGHTER_HEIGHT);
  expect(BATTLE_EXCHANGE_Y).toBeGreaterThan(layout.hpLeft.y + layout.hpLeft.height);
});

it('derives the secret card banner from the fighter height, not 180', async () => {
  const { scene, created } = battleScene();
  scene.create();
  await scene.playEvents(
    [{ type: 'BattlePick', seat: 0, params: { pick: 'secret', side: 'a' } }],
    1,
  );
  const secret = created.find((entry) => entry.kind === '?');
  expect(secret, 'secret card banner rendered').toBeDefined();
  expect(secret!.x).toBe(layout.left.x);
  expect(secret!.y).toBe(174); // 528px feet − 330px fighter − 24px banner gap
});
