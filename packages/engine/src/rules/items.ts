import type { GameEvent, GameState, StepResult } from '../types';
import { BALANCE, ITEM_BY_ID } from '../data/index';

export function receiveItem(
  state: GameState,
  seat: number,
  item: string,
  events: GameEvent[],
): void {
  const p = state.players[seat]!;
  if (p.items.length >= BALANCE.inventoryMax) {
    const value = Math.floor((ITEM_BY_ID[item]?.price ?? 0) * BALANCE.resaleRatio);
    p.gold += value;
    events.push({ type: 'ItemAutoSold', seat, params: { item, gold: value } });
    return;
  }
  p.items.push(item);
}

export function useItem(
  state: GameState,
  seat: number,
  item: string,
  target: number | null,
): StepResult {
  const player = state.players[seat]!;
  const def = ITEM_BY_ID[item];
  if (!def || !player.items.includes(item)) throw new Error('item unavailable');
  const inBattle = state.phase.kind === 'battle';
  if (
    (def.kind === 'battle') !== inBattle ||
    (def.kind === 'field' && state.phase.kind !== 'awaitRoll')
  )
    throw new Error('item not usable in this phase');
  if (def.effect.chooseRoll && (target === null || target < 1 || target > 6))
    throw new Error('mapScroll requires target 1..6');
  const events: GameEvent[] = [];
  const effect = def.effect;
  if (effect.bonusDice) player.bonusDice += Number(effect.bonusDice);
  if (effect.gold) {
    const amount =
      Number(effect.gold) * (state.round >= BALANCE.frenzyFromRound ? BALANCE.frenzyMultiplier : 1);
    player.gold += amount;
    events.push({ type: 'GoldGained', seat, params: { amount } });
  }
  if (effect.warpTo === 'castle') player.pos = state.board.castleId;
  if (effect.placeTrap === 'currentSpace') state.traps[player.pos] = seat;
  if (effect.skipNextFight) player.skipNextFight = true;
  if (effect.chooseRoll) player.forcedRoll = target;
  if (inBattle && state.phase.kind === 'battle') {
    const bt = state.phase.battle;
    const own = [bt.a, bt.b].find((c) => c.kind === 'player' && c.seat === seat);
    const enemy =
      [bt.a, bt.b].find((c) => c.kind === 'player' && c.seat !== seat) ??
      [bt.a, bt.b].find((c) => c.kind === 'monster');
    if (!own) throw new Error('user is not in this battle');
    if (effect.healPct) {
      const healed = Math.min(
        own.stats.maxHp - own.hp,
        Math.ceil((own.stats.maxHp * Number(effect.healPct)) / 100),
      );
      own.hp += healed;
      player.hp = own.hp;
      events.push({ type: 'ItemHealed', seat, params: { item, amount: healed } });
    }
    if (effect.ironSkin) own.buffs.ironSkin = true;
    if (effect.poisonPct) {
      if (target !== null && enemy?.kind === 'player' && enemy.seat !== target)
        throw new Error('invalid poison target');
      if (enemy) enemy.buffs.poison = true;
    }
    if (effect.attackMult) own.buffs.rage = true;
    if (effect.escape) state.phase = { kind: 'endOfTurn' };
  }
  player.items.splice(player.items.indexOf(item), 1);
  events.push({ type: 'ItemUsed', seat, params: { item, ...(target === null ? {} : { target }) } });
  return { state, events };
}

export function shopBuy(state: GameState, seat: number, item: string): StepResult {
  const phase = state.phase;
  const player = state.players[seat]!;
  const def = ITEM_BY_ID[item];
  if (phase.kind !== 'shop' || !phase.stock.includes(item) || !def)
    throw new Error('item not in stock');
  const price = Math.floor(def.price * (player.perks.includes('haggler') ? 0.85 : 1));
  if (player.gold < price) throw new Error('not enough gold');
  player.gold -= price;
  const events: GameEvent[] = [];
  if (player.items.length >= BALANCE.inventoryMax) {
    const resale = Math.floor(def.price * BALANCE.resaleRatio);
    player.gold += resale;
    events.push({ type: 'ItemAutoSold', seat, params: { item, gold: resale } });
  } else {
    player.items.push(item);
    if (def.kind === 'equipment' && def.slot) {
      const old = player[def.slot];
      if (old) {
        const previous = ITEM_BY_ID[old]!;
        const stat = Object.keys(previous.effect)[0] as keyof typeof player.stats;
        player.stats[stat] -= Number(previous.effect[stat]);
      }
      player[def.slot] = item;
      const stat = Object.keys(def.effect)[0] as keyof typeof player.stats;
      player.stats[stat] += Number(def.effect[stat]);
    }
  }
  events.push({ type: 'ItemBought', seat, params: { item, price } });
  return { state, events };
}

export function shopSell(state: GameState, seat: number, item: string): StepResult {
  const player = state.players[seat]!;
  const def = ITEM_BY_ID[item];
  if (state.phase.kind !== 'shop' || !def || !player.items.includes(item))
    throw new Error('item cannot be sold');
  const value = Math.floor(def.price * BALANCE.resaleRatio);
  player.gold += value;
  player.items.splice(player.items.indexOf(item), 1);
  if (player.weapon === item || player.armor === item) {
    const slot = player.weapon === item ? 'weapon' : 'armor';
    const stat = Object.keys(def.effect)[0] as keyof typeof player.stats;
    player.stats[stat] -= Number(def.effect[stat]);
    player[slot] = null;
  }
  return { state, events: [{ type: 'ItemSold', seat, params: { item, gold: value } }] };
}
