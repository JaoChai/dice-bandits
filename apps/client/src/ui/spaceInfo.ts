import type { GameState } from '@dice-bandits/engine';
import { t } from '../i18n';
import { escapeHtml } from './escape';

const KINDS = ['castle', 'town', 'shop', 'chest', 'monster', 'event', 'trap'] as const;

/** The one live close function for the open popup (Review 6b). */
let activeClose: (() => void) | null = null;

/**
 * Tap-a-space popup (spec §7): tile icon, name, one-line effect, and owner +
 * value for towns. Opens on any space tap; closes on Esc or an outside tap.
 * Popup is a DOM overlay so Thai text wraps instead of clipping.
 *
 * Review 6b: every close path goes through the same `close` that removes
 * the same keydown listener `openSpaceInfo` registered — no dead names, no
 * leaks across re-renders.
 */
export function openSpaceInfo(root: HTMLElement, state: GameState, spaceId: number): void {
  closeSpaceInfo();
  const space = state.board.spaces.find((candidate) => candidate.id === spaceId);
  if (!space) return;
  const kind = KINDS.includes(space.kind as (typeof KINDS)[number])
    ? (space.kind as (typeof KINDS)[number])
    : 'event';

  const shade = document.createElement('div');
  shade.className = 'space-info-shade';
  const popup = document.createElement('aside');
  popup.className = 'space-info';
  popup.dataset.testid = 'space-info';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', t(`space.${kind}.name`));

  const ownerSeat = state.towns.find((town) => town.spaceId === space.id)?.owner;
  const ownerLine =
    kind === 'town' && ownerSeat !== null && ownerSeat !== undefined
      ? `<span class="space-info-owner" data-testid="space-info-owner">${escapeHtml(
          t('space.owner', { seat: ownerSeat + 1 }),
        )} · <span data-testid="space-info-value">${state.towns.find((town) => town.spaceId === space.id)!.value}</span></span>`
      : '';

  popup.innerHTML = `<h3 class="space-info-name"><span class="space-info-icon space-icon-${kind}" aria-hidden="true"></span>${escapeHtml(t(`space.${kind}.name`))}</h3><p class="space-info-text">${escapeHtml(t(`space.${kind}.info`))}</p>${ownerLine}<button type="button" class="space-info-close" data-testid="space-info-close" aria-label="${escapeHtml(t('common.close'))}">×</button>`;

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  // Capture before Phaser's target handler: blank-map taps dismiss, while a
  // different tile can open its own popup in the same pointer sequence. Do not
  // consume the event — fork arrows and other underlying controls stay usable.
  const onOutside = (event: PointerEvent): void => {
    if (event.target instanceof Node && !popup.contains(event.target)) close();
  };
  const close = (): void => {
    shade.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    if (activeClose === close) activeClose = null;
  };
  activeClose = close;
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);

  shade.addEventListener('click', (event) => {
    if (event.target === shade) close();
  });
  popup.querySelector('.space-info-close')?.addEventListener('click', close);

  shade.append(popup);
  root.append(shade);
}

/** The single close path every caller uses (BoardScene re-renders, Esc). */
export function closeSpaceInfo(): void {
  activeClose?.();
}
