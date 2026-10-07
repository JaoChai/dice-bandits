import type { GameEvent } from '@dice-bandits/engine';
import { onLangChange, t } from '../i18n';

/** Non-interactive M1 readout in the existing event lane, not over the map.
 * Scene owns time/lifecycle; this view owns no timers, focus or engine state. */
export function createMovementReadout(root: HTMLElement): {
  step(remaining: number, seat: number): void;
  land(spaceId: number, events: readonly GameEvent[]): void;
  clear(): void;
  destroy(): void;
} {
  let element: HTMLElement | null = null;
  let seat: number | null = null;
  let destroyed = false;
  const clear = (): void => {
    element?.remove();
    element = null;
    seat = null;
  };
  const mount = (): HTMLElement => {
    if (!element) {
      element = document.createElement('div');
      element.className = 'movement-readout';
      element.dataset.testid = 'movement-readout';
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
      element.setAttribute('aria-atomic', 'true');
      (root.querySelector('.game-topline') ?? root).append(element);
    }
    return element;
  };
  const unsubscribe = onLangChange(clear);
  return {
    step(remaining, movingSeat) {
      if (
        destroyed ||
        !Number.isInteger(remaining) ||
        remaining < 0 ||
        !Number.isInteger(movingSeat) ||
        movingSeat < 0
      )
        return;
      seat = movingSeat;
      const chip = document.createElement('span');
      chip.className = 'movement-remaining';
      chip.dataset.testid = 'movement-remaining';
      chip.textContent = t('movement.remaining', { count: remaining });
      mount().replaceChildren(chip);
    },
    land(spaceId, events) {
      if (destroyed || seat === null) return;
      const lastMove = events
        .filter((event) => event.type === 'Moved' && event.seat === seat)
        .at(-1);
      if (lastMove?.params.to !== spaceId || lastMove.params.remaining !== 0) return;
      const card = document.createElement('span');
      card.className = 'movement-arrival';
      card.dataset.testid = 'movement-arrival';
      const title = document.createElement('strong');
      title.textContent = t('movement.arrived', { space: spaceId });
      card.append(title);
      for (const event of events) {
        const amount = event.params.amount;
        if (
          event.type !== 'GoldGained' ||
          event.seat !== seat ||
          typeof amount !== 'number' ||
          !Number.isInteger(amount) ||
          amount <= 0
        )
          continue;
        const outcome = document.createElement('span');
        outcome.textContent = t('movement.gold', { amount });
        card.append(outcome);
      }
      mount().replaceChildren(card);
    },
    clear,
    destroy() {
      destroyed = true;
      clear();
      unsubscribe();
    },
  };
}
