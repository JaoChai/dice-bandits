import type { Action, AttackPick, DefensePick, GameState } from './types';

/**
 * Full enumeration of the actions `seat` may legally take right now.
 * `step` accepts exactly these (battlePick exempt; see legalBattlePicks).
 */
export function legalActions(state: GameState, seat: number): Action[] {
  if (state.phase.kind === 'gameOver') return [];
  if (state.phase.kind !== 'battle' && seat !== state.turnSeat) return [];
  switch (state.phase.kind) {
    case 'awaitRoll':
      return [{ type: 'roll' }];
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
      if (actor.kind !== 'player' || actor.seat !== seat) return []; // monsters pick internally
      if (side === c.attackerSide) {
        const picks: AttackPick[] = actor.secretUsed
          ? ['attack', 'strike']
          : ['attack', 'strike', 'secret'];
        return picks.map((pick) => ({ type: 'battlePick' as const, side, pick }));
      }
      const picks: DefensePick[] = actor.secretUsed
        ? ['defend', 'counter']
        : ['defend', 'counter', 'secret'];
      return picks.map((pick) => ({ type: 'battlePick' as const, side, pick }));
    }
    default:
      // pvpReward/levelUp/shop/townManage/townChallenge arrive with Tasks 6–7
      return [];
  }
}
