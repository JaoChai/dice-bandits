import { describe, expect, it } from 'vitest';
import { createGame, legalActions, step } from '../src/index';
import { BALANCE } from '../src/data/index';
import type { GameConfig } from '../src/types';
import { startOfRound } from '../src/rules/underdog';

const config: GameConfig = {
  seed: 'task7-under',
  rounds: 12,
  seats: [
    { name: 'A', classId: 'knight', control: 'human', personality: null },
    { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
};

describe('underdog and round start', () => {
  it('grants round-one card to the higher seat when net worth ties', () => {
    const state = createGame(config);
    expect(state.players[1]!.banditCards).toHaveLength(1);
    expect(state.players[0]!.banditCards).toHaveLength(0);
  });

  it('grants a seeded card only to a non-leader lowest-net-worth seat below capacity', () => {
    const state = createGame(config);
    state.players[0]!.gold = 0;
    state.players[1]!.gold = 900;
    state.players.forEach((player) => (player.banditCards = []));
    const before = structuredClone(state.rng);
    const result = startOfRound(state);
    expect(result.state.players[0]!.banditCards).toHaveLength(1);
    expect(result.state.rng).not.toEqual(before);
    expect(result.state.players[1]!.banditCards).toHaveLength(0);
  });

  it('restricts cards to awaitRoll and applies pickpocket, cursed legs, and bounty effects', () => {
    const state = createGame(config);
    state.players[0]!.gold = 0;
    state.players[1]!.gold = 900;
    state.players[0]!.banditCards = ['pickpocketFar', 'cursedLegs', 'bounty'];
    expect(legalActions(state, 0).filter((action) => action.type === 'useBanditCard')).toHaveLength(
      3,
    );
    expect(legalActions(state, 1).filter((action) => action.type === 'useBanditCard')).toHaveLength(
      0,
    );
    const stolenAmount = Math.floor((900 * BALANCE.pickpocketFarPct) / 100);
    const stolen = step(state, { type: 'useBanditCard', card: 'pickpocketFar' });
    expect(stolen.state.players[0]!.gold).toBe(stolenAmount);
    expect(stolen.state.players[1]!.gold).toBe(900 - stolenAmount);
    const cursedState = createGame(config);
    cursedState.players[0]!.gold = 0;
    cursedState.players[1]!.gold = 900;
    cursedState.players[0]!.banditCards = ['cursedLegs'];
    const cursed = step(cursedState, { type: 'useBanditCard', card: 'cursedLegs' });
    expect(cursed.state.players[1]!.rollCap).toBe(3);

    const bountyState = createGame(config);
    bountyState.players[0]!.gold = 0;
    bountyState.players[1]!.gold = 900;
    bountyState.players[0]!.banditCards = ['bounty'];
    const bounty = step(bountyState, { type: 'useBanditCard', card: 'bounty' });
    expect(bounty.state.bounty).toEqual({ target: 1, untilRound: 1 + BALANCE.bountyRounds });
    bounty.state.phase = { kind: 'shop', stock: [] };
    expect(
      legalActions(bounty.state, 0).filter((action) => action.type === 'useBanditCard'),
    ).toHaveLength(0);
  });

  it('expires an overdue bounty at round start', () => {
    const state = createGame(config);
    state.bounty = { target: 1, untilRound: 3 };
    state.round = 4;
    const result = startOfRound(state);
    expect(result.state.bounty).toBeNull();
  });
});
