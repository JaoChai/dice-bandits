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
  const toast = document.createElement('div');
  toast.className = 'game-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = t(`event.${event.type}`);
  root.querySelector('.game-toast')?.remove();
  root.append(toast);
  window.setTimeout(() => toast.remove(), 2400);
}

export function showActionDialog(
  root: HTMLElement,
  actions: Action[],
  dispatch: (action: Action) => void,
): void {
  const choices = actions.filter((candidate) => candidate.type === 'pvpReward');
  if (!choices.length) return;
  const dialog = document.createElement('div');
  dialog.className = 'dialog-shade';
  dialog.innerHTML = `<section class="game-dialog" role="dialog" aria-modal="true"><h2>${t('board.reward')}</h2>${choices.map((choice, index) => `<button data-choice="${index}">${rewardLabel(choice as Extract<Action, { type: 'pvpReward' }>)}</button>`).join('')}</section>`;
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
