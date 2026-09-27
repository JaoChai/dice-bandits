import { describe, expect, it } from 'vitest';
import { createGame, legalActions, startBattle, step } from '../src/index';
import type { Action, ClassId, GameConfig, GameState } from '../src/types';
import { assertInvariants } from './invariants';

const classes: ClassId[] = ['knight', 'thief', 'mage', 'cleric'];

function config(seed: string, seatCount: number): GameConfig {
  return {
    seed,
    rounds: 12,
    seats: Array.from({ length: seatCount }, (_, seat) => ({
      name: `Seat ${seat}`,
      classId: classes[(seat + (Number(seed.slice(4)) % classes.length)) % classes.length]!,
      control: seat === 0 ? ('human' as const) : ('bot' as const),
      personality: seat === 0 ? null : ('greedy' as const),
    })),
  };
}

function nextLegalAction(state: GameState): Action {
  const seats = [state.turnSeat, ...state.players.map((player) => player.seat)];
  for (const seat of [...new Set(seats)]) {
    const actions = legalActions(state, seat);
    if (actions.length > 0) return actions[0]!;
  }
  throw new Error(`No legal actions in phase ${state.phase.kind}`);
}

describe('game liveness', () => {
  it('reaches gameOver for 50 seeded games without deadlocked states', () => {
    for (let i = 0; i < 50; i++) {
      let state = createGame(config(`live${i}`, 2 + (i % 3)));
      let steps = 0;
      while (state.phase.kind !== 'gameOver' && steps < 20_000) {
        expect(state.players.some((player) => legalActions(state, player.seat).length > 0)).toBe(
          true,
        );
        state = step(state, nextLegalAction(state)).state;
        steps += 1;
      }
      expect(state.phase.kind).toBe('gameOver');
      expect(steps).toBeLessThan(20_000);
      assertInvariants(state);
    }
  });

  it('auto-draws a faster monster attack so the player can immediately defend', () => {
    const state = createGame(config('live0', 2));
    const rngBefore = structuredClone(state.rng);
    const result = startBattle(state, {
      context: 'monster',
      spaceId: state.players[0]!.pos,
      opponent: {
        kind: 'monster',
        seat: null,
        monsterId: 'quickMonster',
        level: 1,
        hp: 100,
        stats: { maxHp: 100, atk: 10, def: 5, spd: 100, mag: 0 },
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
    });

    expect(result.state.phase.kind).toBe('battle');
    if (result.state.phase.kind !== 'battle') throw new Error('expected battle');
    expect(result.state.phase.battle.attackerSide).toBe('b');
    expect(['attack', 'strike']).toContain(result.state.phase.battle.pending.attack);
    expect(result.events.map((event) => event.type)).toEqual(['BattleStarted']);
    expect(legalActions(result.state, 0).length).toBeGreaterThan(0);
    expect(result.state.rng).not.toEqual(rngBefore);
  });
});
