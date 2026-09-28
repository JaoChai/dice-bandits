import type { GameEvent, GameState, StepResult } from '../types';
import { BALANCE } from '../data/index';
import { startBattle } from './battle';
export function collectTaxes(state: GameState, seat: number): StepResult {
  const events: GameEvent[] = [];
  if (state.worldRule === 'taxHoliday' && state.round <= 4) return { state, events };
  let pct = BALANCE.townTaxPct * (state.players[seat]!.perks.includes('taxman') ? 1.2 : 1);
  if (state.round >= BALANCE.frenzyFromRound) pct *= BALANCE.frenzyMultiplier;
  let total = 0;
  for (const town of state.towns)
    if (town.owner === seat) total += Math.floor((town.value * pct) / 100);
  if (total > 0) {
    state.players[seat]!.gold += total;
    events.push({ type: 'TaxesCollected', seat, params: { amount: total } });
  }
  return { state, events };
}

export function invest(state: GameState, seat: number, spaceId: number): StepResult {
  const town = state.towns.find((item) => item.spaceId === spaceId)!;
  const cost = BALANCE.investCost;
  if (town.owner !== seat || state.players[seat]!.gold < cost)
    throw new Error('illegal town investment');
  state.players[seat]!.gold -= cost;
  const increase = Math.floor((town.value * BALANCE.investValuePct) / 100);
  town.value += increase;
  return {
    state,
    events: [{ type: 'TownInvested', seat, params: { spaceId, cost, value: town.value } }],
  };
}

export function startTownChallenge(state: GameState, seat: number, spaceId: number): StepResult {
  const town = state.towns.find((item) => item.spaceId === spaceId)!;
  const owner = state.players[town.owner!]!;
  const level = 2 + Math.floor(town.value / 100);
  const opponent = {
    kind: 'monster' as const,
    seat: null,
    monsterId: 'townGuardian',
    level,
    hp: owner.stats.maxHp + level * 5,
    stats: {
      ...owner.stats,
      maxHp: owner.stats.maxHp + level * 5,
      atk: owner.stats.atk + level,
      def: owner.stats.def + level,
      spd: owner.stats.spd,
      mag: owner.stats.mag,
    },
    secretUsed: false,
    buffs: { ironSkin: false, poison: false, halveNext: false },
  };
  return startBattle(state, { context: 'town', spaceId, opponent });
}
