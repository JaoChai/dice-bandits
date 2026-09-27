import type { Action, GameState } from './types';

/**
 * Full enumeration of the actions `seat` may legally take right now.
 * `step` accepts exactly these (battlePick exempt; see legalBattlePicks).
 */
export function legalActions(state: GameState, seat: number): Action[] {
  if (seat !== state.turnSeat || state.phase.kind === 'gameOver') return [];
  switch (state.phase.kind) {
    case 'awaitRoll':
      return [{ type: 'roll' }];
    case 'chooseBranch':
      return state.phase.options.map((to) => ({ type: 'chooseBranch', to }));
    case 'duelOffer':
      return state.phase.targets
        .map((target) => ({ type: 'duel', target }) as Action)
        .concat([{ type: 'duel', target: null }]);
    case 'endOfTurn':
      return [{ type: 'endTurn' }];
    default:
      // battle/pvpReward/levelUp/shop/townManage/townChallenge arrive with Tasks 5–7
      return [];
  }
}
