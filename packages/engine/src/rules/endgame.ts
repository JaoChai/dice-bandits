import type { GameEvent, GameState, StepResult } from '../types';
import { netWorth } from './pvp';
export function finishGame(state: GameState): StepResult {
  const seats = state.players
    .map((p) => p.seat)
    .sort((a, b) => {
      const worth = netWorth(state, b) - netWorth(state, a);
      if (worth) return worth;
      const towns = (seat: number) => state.towns.filter((t) => t.owner === seat).length;
      const townDiff = towns(b) - towns(a);
      if (townDiff) return townDiff;
      const level = state.players[b]!.level - state.players[a]!.level;
      return level || a - b;
    });
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
  const flips = Object.entries(state.stats.townFlips);
  const hottest = flips.sort(
    (a, b) => Number(b[1]) - Number(a[1]) || Number(a[0]) - Number(b[0]),
  )[0];
  const townId = hottest ? Number(hottest[0]) : 0;
  const owner = state.towns.find((t) => t.spaceId === townId)?.owner ?? 0;
  highlights.push({ key: 'hotTown', seat: owner, value: hottest ? Number(hottest[1]) : 0 });
  state.phase = { kind: 'gameOver', ranking: seats, highlights };
  const events: GameEvent[] = [
    { type: 'GameEnded', seat: seats[0] ?? null, params: { winner: seats[0] ?? -1 } },
  ];
  return { state, events };
}
