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

  it('greedy chooses rob over a low-value town seize while vengeful chooses seize', () => {
    const state = createGame(config('bot-greedy-reward', 2));
    state.phase = { kind: 'pvpReward', winner: 0, loser: 1 };
    state.towns[0]!.owner = 1;
    state.towns[0]!.value = 1;
    const actions = legalActions(state, 0);
    const greedy = actions.find(
      (action) => action.type === 'pvpReward' && action.reward === 'rob',
    )!;
    const seize = actions.find(
      (action) => action.type === 'pvpReward' && action.reward === 'seize',
    )!;

    state.players[0]!.personality = 'greedy';
    expect(chooseAction(state, 0)).toEqual(greedy);
    state.players[0]!.personality = 'vengeful';
    expect(chooseAction(state, 0)).toEqual(seize);
  });

  it('vengeful duels its top-grudge target while greedy chooses the other target', () => {
    const state = createGame(config('bot-vengeful-target', 3));
    state.phase = { kind: 'duelOffer', remaining: 2, targets: [1, 2] };
    state.players[0]!.level = 5;
    state.players[0]!.grudges[2] = 10;
    state.players[1]!.level = 1;
    state.players[2]!.level = 1;
    state.players[1]!.gold = 100;
    state.players[2]!.gold = 100;

    state.players[0]!.personality = 'vengeful';
    expect(chooseAction(state, 0)).toEqual({ type: 'duel', target: 2 });
    state.players[0]!.personality = 'greedy';
    expect(chooseAction(state, 0)).toEqual({ type: 'duel', target: 1 });
  });

  it('cowardly declines a dangerous duel that greedy accepts', () => {
    const state = createGame(config('bot-cowardly-duel', 2));
    state.phase = { kind: 'duelOffer', remaining: 2, targets: [1] };
    state.players[1]!.level = state.players[0]!.level + 1;

    state.players[0]!.personality = 'cowardly';
    expect(chooseAction(state, 0)).toEqual({ type: 'duel', target: null });
    state.players[0]!.personality = 'greedy';
    expect(chooseAction(state, 0)).toEqual({ type: 'duel', target: 1 });
  });

  it('greedy avoids danger when rich but not while poor', () => {
    const state = createGame(config('bot-greedy-danger', 2));
    const [safe, danger] = state.board.spaces.slice(1, 3);
    safe!.kind = 'event';
    danger!.kind = 'monster';
    state.phase = { kind: 'chooseBranch', remaining: 1, options: [danger!.id, safe!.id] };
    state.players[0]!.personality = 'greedy';
    state.players[0]!.gold = 600;
    expect(chooseAction(state, 0)).toEqual({ type: 'chooseBranch', to: safe!.id });
    state.players[0]!.gold = 0;
    state.players[1]!.gold = 1_000;
    expect(chooseAction(state, 0)).toEqual({ type: 'chooseBranch', to: danger!.id });
  });
});
