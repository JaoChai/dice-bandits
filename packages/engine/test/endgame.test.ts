import { describe, expect, it } from 'vitest';
import { createGame, step } from '../src/index';
import type { GameConfig } from '../src/types';
import { finishGame } from '../src/rules/endgame';
const cfg: GameConfig = {
  seed: 'task7-end',
  rounds: 12,
  seats: [
    { name: 'A', classId: 'knight', control: 'human', personality: null },
    { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
};
describe('endgame and frenzy', () => {
  it('ranks by worth, towns, then level and emits all highlights', () => {
    const s = createGame(cfg);
    s.players[0]!.gold = 100;
    s.players[1]!.gold = 300;
    s.stats.robbedGold = [12, 40];
    s.stats.kos = [1, 3];
    s.stats.townFlips = { 4: 2 };
    const r = finishGame(s);
    expect(r.state.phase).toMatchObject({
      kind: 'gameOver',
      ranking: [1, 0],
      highlights: [
        { key: 'biggestRobbery', seat: 1, value: 40 },
        { key: 'mostKod', seat: 1, value: 3 },
        { key: 'hotTown', seat: 0, value: 2 },
      ],
    });
  });
  it('uses town count, then level, then shared seat-order ranking to break net-worth ties', () => {
    const state = createGame(cfg);
    state.towns[0]!.owner = 1;
    expect(finishGame(state).state.phase).toMatchObject({ kind: 'gameOver', ranking: [1, 0] });
    state.towns[0]!.owner = null;
    state.players[1]!.level += 1;
    expect(finishGame(state).state.phase).toMatchObject({ kind: 'gameOver', ranking: [1, 0] });
    state.players[1]!.level = state.players[0]!.level;
    expect(finishGame(state).state.phase).toMatchObject({ kind: 'gameOver', ranking: [0, 1] });
  });

  it('starts round transitions with FrenzyStarted and doubles tax in rounds 10-12', () => {
    const s = createGame(cfg);
    s.round = 9;
    s.turnSeat = 1;
    s.phase = { kind: 'endOfTurn' };
    s.towns[0]!.owner = 0;
    s.players[0]!.pos = s.towns[0]!.spaceId;
    const taxBefore = s.players[0]!.gold;
    const result = step(s, { type: 'endTurn' });
    expect(result.events.some((e) => e.type === 'FrenzyStarted')).toBe(true);
    expect(result.state.players[0]!.gold).toBeGreaterThan(taxBefore);
    expect(result.state.round).toBe(10);
  });
});
