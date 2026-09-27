import type { Action, GameState, StepResult } from './types';
import { IllegalActionError } from './types';
import { legalActions } from './legal';
import { applyRoll, applyChooseBranch, applyDuelAnswer, endTurn } from './rules/movement';
import { applyBattlePick } from './rules/battle';
import { useItem, shopBuy, shopSell } from './rules/items';
import { pickPerk } from './rules/leveling';
import { invest, startTownChallenge } from './rules/towns';

/**
 * Apply `action` to a state, returning a fresh state + events. The input is
 * never mutated: it is deep-cloned once here and all rule functions operate
 * on the clone.
 */
export function step(state: GameState, action: Action): StepResult {
  const next = structuredClone(state);
  const seat = next.turnSeat;

  const isBattlePick = action.type === 'battlePick';
  const legal = legalActions(next, seat).some((a) => actionsEq(a, action));
  if (!legal && !isBattlePick) {
    throw new IllegalActionError(`illegal action ${action.type} in phase ${next.phase.kind}`);
  }

  switch (action.type) {
    case 'roll':
      return applyRoll(next);
    case 'chooseBranch':
      return applyChooseBranch(next, action.to);
    case 'duel':
      return applyDuelAnswer(next, action.target);
    case 'battlePick':
      return applyBattlePick(next, action.side, action.pick);
    case 'useItem': {
      const r = useItem(next, seat, action.item, action.target);
      return r.state.phase.kind === 'endOfTurn' ? endTurn(r.state, r.events) : r;
    }
    case 'pickPerk':
      return pickPerk(next, seat, action.perk);
    case 'shopBuy':
      return shopBuy(next, seat, action.item);
    case 'shopSell':
      return shopSell(next, seat, action.item);
    case 'invest': {
      if (next.phase.kind !== 'townManage')
        throw new IllegalActionError('invest outside townManage');
      const r = invest(next, seat, next.phase.spaceId);
      r.state.phase = { kind: 'endOfTurn' };
      return endTurn(r.state, r.events);
    }
    case 'attackTown': {
      if (next.phase.kind !== 'townChallenge')
        throw new IllegalActionError('attackTown outside townChallenge');
      return startTownChallenge(next, seat, next.phase.spaceId);
    }
    case 'leave':
      return endTurn(next, []);
    case 'endTurn':
      return endTurn(next, []);
    default:
      // Only Task 7 PvP reward actions remain unimplemented.
      throw new IllegalActionError(`action ${action.type} not implemented yet`);
  }
}

/** Structural equality of two actions (payload included). */
function actionsEq(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'useItem':
      return a.item === (b as typeof a).item && a.target === (b as typeof a).target;
    case 'chooseBranch':
      return a.to === (b as typeof a).to;
    case 'duel':
      return a.target === (b as typeof a).target;
    case 'pvpReward':
      return (
        a.reward === (b as typeof a).reward &&
        a.item === (b as typeof a).item &&
        a.townId === (b as typeof a).townId &&
        a.alias === (b as typeof a).alias
      );
    case 'pickPerk':
    case 'shopBuy':
    case 'shopSell':
    case 'useBanditCard':
      return JSON.stringify(a) === JSON.stringify(b);
    default:
      // roll / battlePick / invest / attackTown / leave / endTurn: no payload
      return true;
  }
}
