import { describe, expect, it } from 'vitest';
import { createGame, legalActions, step } from '../src/index';
import { chooseAction } from '../src/bots';
import type { Action, ClassId, Personality } from '../src/types';

const classes: ClassId[] = ['knight', 'thief', 'mage', 'cleric'];
const personalities: Personality[] = ['greedy', 'vengeful', 'cowardly'];

function config(seed: string, count = 4) {
  return {
    seed,
    rounds: 12,
    seats: Array.from({ length: count }, (_, seat) => ({
      name: `Bot ${seat}`,
      classId: classes[seat % classes.length]!,
      control: 'bot' as const,
      personality: personalities[seat % personalities.length]!,
    })),
  };
}

function equalAction(a: Action, b: Action): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

describe('rule-based bots', () => {
  it('samples 200 live state-seat pairs and returns only legal actions without consuming game rng', () => {
    let samples = 0;
    for (let game = 0; game < 20 && samples < 200; game++) {
      let state = createGame(config(`bot-legality-${game}`));
      let steps = 0;
      while (state.phase.kind !== 'gameOver' && samples < 200 && steps < 5000) {
        const before = state.rng.slice();
        let actingSeat = -1;
        for (const player of state.players) {
          const legal = legalActions(state, player.seat);
          if (!legal.length) continue;
          const action = chooseAction(state, player.seat);
          expect(legal.some((candidate) => equalAction(candidate, action))).toBe(true);
          expect(state.rng).toEqual(before);
          actingSeat = player.seat;
          samples += 1;
          if (samples >= 200) break;
        }
        if (actingSeat < 0) throw new Error(`no legal choice in ${state.phase.kind}`);
        state = step(state, chooseAction(state, actingSeat)).state;
        steps += 1;
      }
    }
    expect(samples).toBe(200);
  });

  it('personalities choose differently in a crafted duel offer', () => {
    const state = createGame(config('bot-personality', 3));
    state.phase = { kind: 'duelOffer', remaining: 2, targets: [1] };
    const decisions = personalities.map((personality) => {
      state.players[0]!.personality = personality;
      return chooseAction(state, 0);
    });
    expect(decisions.some((action) => !equalAction(action, decisions[0]!))).toBe(true);
  });
});
