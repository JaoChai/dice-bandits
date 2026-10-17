import type { GameState } from '@dice-bandits/engine';
import type { Page } from '@playwright/test';

export async function observePreparation(page: Page) {
  // One selector evaluation per browser observes the public state and the
  // actual visible/enabled controls together. Do not take three full-state
  // scene snapshots and several independent locator round trips per action.
  return page
    .locator('button[data-choice]:visible:enabled, button[data-action-index]:visible:enabled')
    .evaluateAll((buttons) => ({
      state: (window as unknown as { __db: { getState(): GameState } }).__db.getState(),
      buttons: buttons.map((button) => ({
        testid: button.getAttribute('data-testid'),
        selector: button.hasAttribute('data-choice')
          ? `[data-choice="${button.getAttribute('data-choice')}"]`
          : `[data-action-index="${button.getAttribute('data-action-index')}"]`,
      })),
    }));
}

export function preparationChoice(
  buttons: Awaited<ReturnType<typeof observePreparation>>['buttons'],
) {
  return (
    buttons.find((button) => button.testid === 'pick-attack') ??
    buttons.find(
      (button) =>
        button.testid?.startsWith('shop-leave-') ||
        button.testid === 'action-leave' ||
        button.testid === 'action-duel',
    ) ??
    buttons[0]!
  );
}

type HandoffEligibility = Pick<GameState, 'worldRule' | 'round'> & {
  players: Array<Pick<GameState['players'][number], 'skipTurns'>>;
  towns: Array<Pick<GameState['towns'][number], 'owner' | 'value'>>;
};

// Whether Bob can receive the particular empty, non-skipped turn this spec
// needs. This is a read-only preparation decision, never an injected state.
export function emptyBobTurnPossible(state: HandoffEligibility) {
  if (state.players[1]!.skipTurns > 0) return false;
  if (state.worldRule === 'taxHoliday' && state.round <= 4) return true;
  return !state.towns.some((town) => town.owner === 1 && town.value > 0);
}
