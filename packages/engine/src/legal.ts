import type { Action, AttackPick, DefensePick, GameState } from './types';
import { BALANCE, ITEM_BY_ID } from './data/index';

/**
 * Full enumeration of the actions `seat` may legally take right now.
 * `step` accepts exactly these (battlePick exempt; see legalBattlePicks).
 */
export function legalActions(state: GameState, seat: number): Action[] {
  if (state.phase.kind === 'gameOver') return [];
  if (state.phase.kind !== 'battle' && seat !== state.turnSeat) return [];
  switch (state.phase.kind) {
    case 'awaitRoll': {
      const p = state.players[seat]!;
      const items: Action[] = [];
      for (const item of p.items.filter((id) => ITEM_BY_ID[id]?.kind === 'field')) {
        if (ITEM_BY_ID[item]?.effect.chooseRoll) {
          for (let target = 1; target <= 6; target++) items.push({ type: 'useItem', item, target });
        } else items.push({ type: 'useItem', item, target: null });
      }
      return [{ type: 'roll' }, ...items];
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
      // duel *initiation* (target !== null) arrives with Task 7's pvp battle;
      // until then declining is the only executable answer
      return [{ type: 'duel', target: null }];
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
