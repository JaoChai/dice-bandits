import type { GameEvent, GameState, StepResult } from '../types';
import { BALANCE } from '../data/index';
import { pick } from '../rng';
import { leader, netWorth } from './pvp';

export function startOfRound(state: GameState): StepResult {
  const events: GameEvent[] = [];
  for (const p of state.players) if (p.prank && state.round >= p.prank.untilRound) p.prank = null;
  if (state.bounty && state.round > state.bounty.untilRound) {
    events.push({ type: 'BountyExpired', seat: state.bounty.target, params: {} });
    state.bounty = null;
  }
  if (state.round === BALANCE.frenzyFromRound)
    events.push({ type: 'FrenzyStarted', seat: null, params: { round: state.round } });
  const lead = leader(state);
  const lowest = state.players.reduce(
    (best, p) => (netWorth(state, p.seat) <= netWorth(state, best) ? p.seat : best),
    0,
  ); // tie goes to higher seat
  const p = state.players[lowest]!;
  if (lowest !== lead && p.banditCards.length < BALANCE.banditCardsMax) {
    const [card, rng] = pick(state.rng, ['pickpocketFar', 'cursedLegs', 'bounty'] as const);
    state.rng = rng;
    p.banditCards.push(card);
    events.push({ type: 'BanditCardGranted', seat: lowest, params: { card } });
  }
  return { state, events };
}
