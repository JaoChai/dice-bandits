import type { GameState } from '@dice-bandits/engine';
import { t } from '../i18n';
import { escapeHtml } from './escape';

const KINDS = ['castle', 'town', 'shop', 'chest', 'monster', 'event', 'trap'] as const;

/**
 * Tap-a-space popup (spec §7): tile icon, name, one-line effect, and owner +
 * value for towns. Opens on any space tap; closes on Esc or an outside tap.
 * Popup is a DOM overlay so Thai text wraps instead of clipping.
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

  const close = (): void => {
    shade.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  shade.addEventListener('click', (event) => {
    if (event.target === shade) close();
  });
  popup.querySelector('.space-info-close')?.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);

  shade.append(popup);
  root.append(shade);
  (root as HTMLElement & { __spaceInfoClose?: () => void }).__spaceInfoClose = close;
}

export function closeSpaceInfo(): void {
  document.querySelector('.space-info-shade')?.remove();
  document.removeEventListener('keydown', onEscape, true);
}

function onEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeSpaceInfo();
}
