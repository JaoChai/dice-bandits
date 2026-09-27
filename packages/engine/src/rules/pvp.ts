import type { GameEvent, GameState, StepResult } from '../types';
import { BALANCE, ITEM_BY_ID } from '../data/index';
import { receiveItem } from './items';

export function netWorth(state: GameState, seat: number): number {
  const player = state.players[seat]!;
  const items = player.items.reduce(
    (sum, id) => sum + Math.floor((ITEM_BY_ID[id]?.price ?? 0) * BALANCE.resaleRatio),
    0,
  );
  const towns = state.towns.reduce((sum, town) => sum + (town.owner === seat ? town.value : 0), 0);
  return player.gold + items + towns;
}
export function leader(state: GameState): number {
  return state.players.reduce(
    (best, p) => (netWorth(state, p.seat) > netWorth(state, best) ? p.seat : best),
    0,
  );
}
export function applyPvpReward(
  state: GameState,
  action: Extract<import('../types').Action, { type: 'pvpReward' }>,
): StepResult {
  if (state.phase.kind !== 'pvpReward') throw new Error('pvpReward outside phase');
  const { winner, loser } = state.phase;
  const w = state.players[winner]!,
    l = state.players[loser]!;
  const events: GameEvent[] = [];
  if (action.reward === 'rob') {
    const pct = w.perks.includes('looter') ? BALANCE.looterRobPct : BALANCE.robPct;
    const amount = Math.floor((l.gold * pct) / 100);
    l.gold -= amount;
    w.gold += amount;
    state.stats.robbedGold[winner] = (state.stats.robbedGold[winner] ?? 0) + amount;
    l.grudges[winner] = (l.grudges[winner] ?? 0) + amount;
    events.push({ type: 'GoldStolen', seat: winner, params: { amount } });
  } else if (action.reward === 'loot') {
    const item = action.item!;
    const i = l.items.indexOf(item);
    const def = ITEM_BY_ID[item]!;
    if ((l.weapon === item || l.armor === item) && def.slot) {
      const stat = Object.keys(def.effect)[0] as keyof typeof l.stats;
      l.stats[stat] -= Number(def.effect[stat]);
      l[def.slot] = null;
    }
    l.items.splice(i, 1);
    receiveItem(state, winner, item, events);
    l.grudges[winner] = (l.grudges[winner] ?? 0) + 1;
    events.push({ type: 'ItemLooted', seat: winner, params: { item } });
  } else if (action.reward === 'seize') {
    const town = state.towns.find((t) => t.spaceId === action.townId)!;
    town.owner = winner;
    state.stats.townFlips[town.spaceId] = (state.stats.townFlips[town.spaceId] ?? 0) + 1;
    l.grudges[winner] = (l.grudges[winner] ?? 0) + town.value;
    events.push({
      type: 'TownFlipped',
      seat: winner,
      params: { spaceId: town.spaceId, previousOwner: loser },
    });
  } else {
    l.prank = { alias: action.alias!, untilRound: state.round + BALANCE.prankRounds };
    l.grudges[winner] = (l.grudges[winner] ?? 0) + 1;
    events.push({
      type: 'Pranked',
      seat: loser,
      params: { alias: action.alias!, untilRound: l.prank.untilRound },
    });
  }
  state.phase = { kind: 'endOfTurn' };
  return { state, events };
}
