import type { GameEvent, GameState, StepResult } from '../types';
import { netWorth } from './pvp';

export function finishGame(state: GameState): StepResult {
  const towns = (seat: number) => state.towns.filter((t) => t.owner === seat).length;
  const compareResult = (a: number, b: number) => {
    const worth = netWorth(state, b) - netWorth(state, a);
    if (worth) return worth;
    const townDiff = towns(b) - towns(a);
    if (townDiff) return townDiff;
    return state.players[b]!.level - state.players[a]!.level;
  };
  const seats = state.players.map((p) => p.seat).sort((a, b) => compareResult(a, b) || a - b);
  const top = seats[0];
  const winners = top === undefined ? [] : seats.filter((seat) => compareResult(top, seat) === 0);
  const max = (values: number[]) => Math.max(0, ...values);
  const highlights: import('../types').Highlight[] = [];
  for (const [key, values] of [
    ['biggestRobbery', state.stats.robbedGold],
    ['mostKod', state.stats.kos],
  ] as const) {
    const value = max(values);
    const seat = values.findIndex((v) => v === value);
    highlights.push({ key, seat: seat < 0 ? 0 : seat, value });
  }
  const flips = Object.entries(state.stats.townFlips)
    .map(([spaceId, count]) => [Number(spaceId), Number(count)] as const)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const hottest = flips[0];
  highlights.push({
    key: 'hotTown',
    spaceId: hottest?.[0] ?? null,
    flips: hottest?.[1] ?? 0,
  });
  state.phase = { kind: 'gameOver', ranking: seats, winners, highlights };
  const events: GameEvent[] = [
    {
      type: 'GameEnded',
      seat: top ?? null,
      params: { winner: top ?? -1, winners: winners.join(',') },
    },
  ];
  return { state, events };
}
