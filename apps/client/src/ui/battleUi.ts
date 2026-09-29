import { type Action, type GameState } from '@dice-bandits/engine';
import { t } from '../i18n';
import { needsPassScreen, type BattleSide } from './passDevice';

const readyPasses = new Set<string>();

export function renderBattleUi(
  root: HTMLElement,
  state: GameState,
  actions: Action[],
  battleSeat: number | undefined,
  dispatch: (action: Action) => void,
  actionName: (action: Action) => string,
  humanPicker: boolean,
  onlineMode = false,
  awaitingView = false,
): boolean {
  if (state.phase.kind !== 'battle') {
    readyPasses.clear();
    return false;
  }

  const side = pendingSide(state);
  const passKey = battlePassKey(state, side);
  const passNeeded =
    battleSeat !== undefined &&
    !onlineMode &&
    needsPassScreen(state, side) &&
    !readyPasses.has(passKey);
  const shownActions = passNeeded ? [] : actions;
  const pickerActions = humanPicker
    ? shownActions.filter((action) => action.type === 'battlePick' || action.type === 'useItem')
    : [];
  const buttons = pickerActions
    .map(
      (action, index) =>
        `<button class="action-button" data-testid="${battleActionTestId(action)}" data-action-index="${index}"${awaitingView ? ' disabled' : ''}>${escapeHtml(actionName(action))}</button>`,
    )
    .join('');

  const actionBar = root.querySelector<HTMLElement>('.action-bar');
  if (actionBar) {
    actionBar.setAttribute('aria-label', t('board.actions'));
    actionBar.innerHTML = buttons || `<span>${t('board.botThinking')}</span>`;
  }
  root.querySelector('.dialog-shade')?.remove();
  if (passNeeded && battleSeat !== undefined) {
    const player = state.players[battleSeat]!;
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="dialog-shade pass-device" data-testid="pass-screen"><section class="game-dialog" role="dialog" aria-modal="true"><img class="pass-portrait" src="/sprites/hero-${player.classId}-portrait.png" alt="${t(`class.${player.classId}`)}"><h2>${t('battle.passDevice', { name: escapeHtml(player.prank?.alias ?? player.name) })}</h2><button class="primary" data-testid="pass-ready">${t('battle.ready')}</button></section></div>`,
    );
    root.querySelector('[data-testid="pass-ready"]')?.addEventListener('click', () => {
      readyPasses.add(passKey);
      renderBattleUi(
        root,
        state,
        actions,
        battleSeat,
        dispatch,
        actionName,
        humanPicker,
        onlineMode,
        awaitingView,
      );
    });
  }
  root.querySelectorAll<HTMLButtonElement>('[data-action-index]').forEach((button) => {
    const action = pickerActions[Number(button.dataset.actionIndex)];
    if (action) button.addEventListener('click', () => dispatch(action));
  });
  return true;
}

function battleActionTestId(action: Action): string {
  if (action.type === 'battlePick') return `pick-${action.pick}`;
  if (action.type === 'useItem') {
    return `action-useItem-${action.item}${action.target === null ? '' : `-${action.target}`}`;
  }
  return '';
}

function pendingSide(state: GameState): BattleSide {
  if (state.phase.kind !== 'battle') return 'a';
  const battle = state.phase.battle;
  return battle.pending.attack === null
    ? battle.attackerSide
    : battle.attackerSide === 'a'
      ? 'b'
      : 'a';
}

function battlePassKey(state: GameState, side: BattleSide): string {
  if (state.phase.kind !== 'battle') return '';
  const battle = state.phase.battle;
  return `${battle.exchange}-${battle.half}-${side}-${battle.pending.attack ?? ''}-${battle.pending.defense ?? ''}`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}
