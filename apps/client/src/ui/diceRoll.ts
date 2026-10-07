import type { GameEvent } from '@dice-bandits/engine';
import { onLangChange, t } from '../i18n';

export type RollResult = { seat: number | null; total: number; count: number; sides: number };

export function readRollResult(event: GameEvent): RollResult | null {
  if (event.type !== 'DiceRolled') return null;
  const { value, dice, sides } = event.params;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    typeof dice !== 'number' ||
    !Number.isFinite(dice) ||
    !Number.isInteger(dice) ||
    dice <= 0 ||
    typeof sides !== 'number' ||
    !Number.isFinite(sides) ||
    !Number.isInteger(sides) ||
    sides <= 0
  )
    return null;
  return { seat: event.seat, total: value, count: dice, sides };
}

type RollOptions = { speed: number; reduced: boolean; waitBeforeMovement: boolean };
const pipPositions: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** View-only telemetry: never dispatches, rolls RNG or infers a saved result. */
export function createDiceRoll(root: HTMLElement): {
  play(result: RollResult, options: RollOptions): Promise<void>;
  destroy(): void;
} {
  let destroyed = false;
  let last: RollResult | undefined;
  let overlay: HTMLElement | undefined;
  let chip: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settle: (() => void) | undefined;
  const refresh = (): void => {
    if (!last) return;
    if (chip) chip.textContent = t('dice.result', { value: last.total });
    const label = overlay?.querySelector('.dice-roll-label');
    if (label)
      label.textContent =
        overlay?.dataset.stage === 'rolling'
          ? t('dice.rolling')
          : t('dice.result', { value: last.total });
    const count = overlay?.querySelector('.dice-count');
    if (count) count.textContent = t('dice.count', { count: last.count, sides: last.sides });
  };
  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    overlay?.remove();
    overlay = undefined;
    const finish = settle;
    settle = undefined;
    finish?.();
  };
  const unsubscribe = onLangChange(refresh);
  return {
    play(result, options) {
      if (destroyed) return Promise.resolve();
      cancel();
      last = { ...result };
      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'last-roll-chip';
        chip.dataset.testid = 'last-roll-chip';
        chip.setAttribute('role', 'status');
        chip.setAttribute('aria-atomic', 'true');
      }
      // Header children survive renderHud's updates; never put it in the tray.
      (root.querySelector('.game-topline') ?? root).append(chip);
      overlay = document.createElement('div');
      overlay.className = 'dice-roll';
      overlay.dataset.testid = 'dice-roll';
      // The chip is the sole announcement; the big face is a visual duplicate.
      overlay.setAttribute('aria-hidden', 'true');
      const wait =
        options.waitBeforeMovement &&
        !options.reduced &&
        Number.isFinite(options.speed) &&
        options.speed > 0;
      overlay.dataset.stage = wait ? 'rolling' : 'result';
      overlay.dataset.mode = wait ? 'animated' : 'static';
      overlay.style.setProperty('--dice-tumble-duration', `${900 * options.speed}ms`);
      const truthfulFace =
        result.count === 1 &&
        result.total >= 1 &&
        result.total <= result.sides &&
        result.sides <= 6;
      // While tumbling show an unmarked die, not invented intermediate faces.
      const pips = truthfulFace
        ? pipPositions[result.total]!.map(
            (position) =>
              `<circle class="dice-pip" cx="${24 + (position % 3) * 26}" cy="${24 + Math.floor(position / 3) * 26}" r="7"/>`,
          ).join('')
        : '';
      overlay.innerHTML = `<div class="dice-face"><svg viewBox="0 0 100 100" focusable="false">${pips}</svg>${truthfulFace ? '' : '<span class="dice-count"></span>'}</div><strong class="dice-roll-label"></strong>`;
      (root.querySelector('.game-shell') ?? root).append(overlay);
      refresh();
      if (!wait) return Promise.resolve();
      return new Promise<void>((resolve) => {
        settle = resolve;
        timer = setTimeout(() => {
          overlay!.dataset.stage = 'result';
          refresh();
          timer = setTimeout(cancel, 1400 * options.speed);
        }, 900 * options.speed);
      });
    },
    destroy() {
      destroyed = true;
      cancel();
      chip?.remove();
      chip = undefined;
      last = undefined;
      unsubscribe();
    },
  };
}
