import { t } from '../i18n';
import { data } from '@dice-bandits/engine';
import type { Action, GameEvent } from '@dice-bandits/engine';

export function renderEventToast(root: HTMLElement, events: GameEvent[]): void {
  const event = [...events]
    .reverse()
    .find((item) =>
      ['GoldStolen', 'FrenzyStarted', 'TownClaimed', 'BattleEnded'].includes(item.type),
    );
  if (!event) return;
  const toast = root.querySelector<HTMLElement>('[data-testid="event-banner"]');
  if (toast) {
    const text = toast.querySelector<HTMLElement>('.event-text');
    if (!text) return;
    text.textContent = t(`event.${event.type}`);
    toast.setAttribute('title', text.textContent);
    return;
  }
  const legacyToast = document.createElement('div');
  legacyToast.className = 'game-toast';
  legacyToast.setAttribute('role', 'status');
  legacyToast.textContent = t(`event.${event.type}`);
  root.querySelector('.game-toast')?.remove();
  root.append(legacyToast);
  window.setTimeout(() => legacyToast.remove(), 2400);
}

export function showPhaseDialog(
  root: HTMLElement,
  state: import('@dice-bandits/engine').GameState,
  actions: Action[],
  dispatch: (action: Action) => void,
  disabled = false,
): void {
  const dialog = document.createElement('div');
  dialog.className = 'dialog-shade';
  const title = state.phase.kind === 'levelUp' ? t('perk.title') : t('shop.title');
  dialog.innerHTML = `<section class="game-dialog phase-dialog" role="dialog" aria-modal="true"><h2>${title}</h2><div class="phase-choices">${actions.map((action, index) => `<button data-testid="${phaseTestId(action)}" data-choice="${index}"${disabled ? ' disabled' : ''}>${phaseLabel(action)}</button>`).join('')}</div></section>`;
  dialog.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = actions[Number(button.dataset.choice)];
      if (action) dispatch(action);
      dialog.remove();
    });
  });
  root.append(dialog);
}

function phaseTestId(action: Action): string {
  return action.type === 'pickPerk'
    ? `perk-${action.perk}`
    : `shop-${action.type}-${action.type === 'shopBuy' || action.type === 'shopSell' ? action.item : 'leave'}`;
}

function phaseLabel(action: Action): string {
  if (action.type === 'pickPerk') return t(`perk.${action.perk}`);
  if (action.type === 'shopBuy') return `${t('action.buy')} · ${t(`item.${action.item}`)}`;
  if (action.type === 'shopSell') return `${t('action.sell')} · ${t(`item.${action.item}`)}`;
  if (action.type === 'leave') return t('action.leave');
  return '';
}

export function showActionDialog(
  root: HTMLElement,
  actions: Action[],
  dispatch: (action: Action) => void,
  disabled = false,
): void {
  const choices = actions.filter((candidate) => candidate.type === 'pvpReward');
  if (!choices.length) return;
  const dialog = document.createElement('div');
  dialog.className = 'dialog-shade';
  dialog.innerHTML = `<section class="game-dialog" role="dialog" aria-modal="true"><h2>${t('board.reward')}</h2>${choices.map((choice, index) => `<button data-choice="${index}"${disabled ? ' disabled' : ''}>${rewardLabel(choice as Extract<Action, { type: 'pvpReward' }>)}</button>`).join('')}</section>`;
  dialog.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((button) => {
    button.addEventListener('click', () => {
      const choice = choices[Number(button.dataset.choice)];
      if (choice) dispatch(choice);
      dialog.remove();
    });
  });
  root.append(dialog);
}

function rewardLabel(action: Extract<Action, { type: 'pvpReward' }>): string {
  let detail = '';
  if (action.item) detail = ` · ${t(`item.${action.item}`)}`;
  if (action.townId !== null) detail = ` · ${action.townId}`;
  if (action.alias) {
    const index = data.PRANK_ALIASES.indexOf(action.alias) + 1;
    detail = ` · ${t(`prank.alias.${index}`)}`;
  }
  return `${t(`action.${action.reward}`)}${detail}`;
}
