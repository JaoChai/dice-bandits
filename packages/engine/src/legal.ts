import type { Action, AttackPick, DefensePick, GameState } from './types';
import { BALANCE, ITEM_BY_ID, PRANK_ALIASES } from './data/index';
import { leader } from './rules/pvp';

/**
 * Full enumeration of the actions `seat` may legally take right now.
 * `step` accepts exactly these (battlePick exempt; see legalBattlePicks).
 */
export function legalActions(state: GameState, seat: number): Action[] {
  if (state.phase.kind === 'gameOver') return [];
  if (
    state.phase.kind !== 'battle' &&
    state.phase.kind !== 'pvpReward' &&
    state.phase.kind !== 'levelUp' &&
    seat !== state.turnSeat
  )
    return [];
  switch (state.phase.kind) {
    case 'awaitRoll': {
      const p = state.players[seat]!;
      const items: Action[] = [];
      for (const item of p.items.filter((id) => ITEM_BY_ID[id]?.kind === 'field')) {
        if (ITEM_BY_ID[item]?.effect.chooseRoll) {
          for (let target = 1; target <= 6; target++) items.push({ type: 'useItem', item, target });
        } else items.push({ type: 'useItem', item, target: null });
      }
      const cards: Action[] =
        p.seat === leader(state)
          ? []
          : p.banditCards.map((card) => ({ type: 'useBanditCard', card }));
      return [{ type: 'roll' }, ...items, ...cards];
    }
    case 'levelUp':
      return state.phase.seat === seat
        ? state.phase.choices.map((perk) => ({ type: 'pickPerk' as const, perk }))
        : [];
    case 'shop': {
      const p = state.players[seat]!;
      const buys = state.phase.stock
        .filter((id) => {
          const def = ITEM_BY_ID[id];
          const price = def
            ? Math.floor(def.price * (p.perks.includes('haggler') ? 0.85 : 1))
            : Infinity;
          return !!def && p.gold >= price;
        })
        .map((item) => ({ type: 'shopBuy' as const, item }));
      return [
        ...buys,
        ...p.items.map((item) => ({ type: 'shopSell' as const, item })),
        { type: 'leave' },
      ];
    }
    case 'townManage': {
      const p = state.players[seat]!;
      const spaceId = state.phase.spaceId;
      const town = state.towns.find((item) => item.spaceId === spaceId)!;
      return [
        ...(town.owner === seat && p.gold >= BALANCE.investCost
          ? [{ type: 'invest' as const }]
          : []),
        { type: 'leave' },
      ];
    }
    case 'townChallenge':
      return [{ type: 'attackTown' }, { type: 'leave' }];

    case 'chooseBranch':
      return state.phase.options.map((to) => ({ type: 'chooseBranch', to }));
    case 'duelOffer':
      return [
        { type: 'duel', target: null },
        ...state.phase.targets
          .filter((target) => state.players[target]!.hp > 0)
          .map((target) => ({ type: 'duel' as const, target })),
      ];
    case 'pvpReward': {
      if (seat !== state.phase.winner) return [];
      const { loser } = state.phase;
      const target = state.players[loser]!;
      return [
        { type: 'pvpReward', reward: 'rob', item: null, townId: null, alias: null },
        ...target.items.map((item) => ({
          type: 'pvpReward' as const,
          reward: 'loot' as const,
          item,
          townId: null,
          alias: null,
        })),
        ...state.towns
          .filter((town) => town.owner === loser)
          .map((town) => ({
            type: 'pvpReward' as const,
            reward: 'seize' as const,
            item: null,
            townId: town.spaceId,
            alias: null,
          })),
        ...PRANK_ALIASES.map((alias) => ({
          type: 'pvpReward' as const,
          reward: 'prank' as const,
          item: null,
          townId: null,
          alias,
        })),
      ];
    }
    case 'endOfTurn':
      return [{ type: 'endTurn' }];
    case 'battle': {
      const c = state.phase.battle;
      const side = c.pending.attack === null ? c.attackerSide : c.attackerSide === 'a' ? 'b' : 'a';
      const actor = side === 'a' ? c.a : c.b;
      const itemActions: Action[] = [];
      for (const item of actor.kind === 'player'
        ? state.players[seat]!.items.filter((id) => ITEM_BY_ID[id]?.kind === 'battle')
        : []) {
        const opponent = actor === c.a ? c.b : c.a;
        const target = ITEM_BY_ID[item]?.effect.poisonPct
          ? opponent.kind === 'player'
            ? opponent.seat
            : null
          : null;
        itemActions.push({ type: 'useItem', item, target });
      }
      if (actor.kind !== 'player' || actor.seat !== seat) return [];
      const picks: Action[] =
        side === c.attackerSide
          ? (actor.secretUsed
              ? (['attack', 'strike'] as AttackPick[])
              : (['attack', 'strike', 'secret'] as AttackPick[])
            ).map((pick) => ({ type: 'battlePick', side, pick }))
          : (actor.secretUsed
              ? (['defend', 'counter'] as DefensePick[])
              : (['defend', 'counter', 'secret'] as DefensePick[])
            ).map((pick) => ({ type: 'battlePick', side, pick }));
      return [...picks, ...itemActions];
    }
    default:
      // PvP rewards are added by Task 7; all Task 6 phases are enumerated above.
      return [];
  }
}
