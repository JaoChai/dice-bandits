import type { Action, GameState, StepResult } from './types';
import { IllegalActionError } from './types';
import { legalActions } from './legal';
import { applyRoll, applyChooseBranch, applyDuelAnswer, endTurn } from './rules/movement';
import { applyBattlePick } from './rules/battle';

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
    case 'endTurn':
      return endTurn(next, []);
    default:
      // remaining action types become legal in Tasks 5–7; none are enumerated
      // as legal yet, so reaching here means an unimplementable action slipped
      // through the exemption (battlePick) or a future legalActions gap
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
