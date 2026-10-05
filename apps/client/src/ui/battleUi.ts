import { type Action, type GameState } from '@dice-bandits/engine';
import { t } from '../i18n';
import { CARD_ICON, portraitStyle, iconStyle } from './artFrames';
import { needsPassScreen, type BattleSide } from './passDevice';

const readyPasses = new Set<string>();

export function renderBattleUi(
  root: HTMLElement,
  state: GameState,
  actions: Action[],
  battleSeat: number | undefined,
  dispatch: (action: Action) => void,
  actionName: (action: Action) => string,
  humanPicker = false,
  onlineMode = false,
  awaitingView = false,
): boolean {
  const shell = root.querySelector<HTMLElement>('.game-shell');
  if (state.phase.kind !== 'battle') {
    readyPasses.clear();
    shell?.classList.remove('battle-mode');
    shell?.querySelector('.board-stage')?.classList.remove('battle-panel');
    shell?.querySelector('.battle-hud')?.remove();
    return false;
  }

  shell?.classList.add('battle-mode');
  shell?.querySelector('.board-stage')?.classList.add('battle-panel');
  const exit = shell?.querySelector<HTMLButtonElement>('.game-topline [data-action="exit"]');
  if (exit) exit.textContent = t('setup.back');
  const battle = state.phase.battle;
  const hpCard = (side: 'a' | 'b') => {
    const fighter = battle[side];
    const player = fighter.kind === 'player' ? state.players[fighter.seat!] : undefined;
    const name = player?.prank?.alias ?? player?.name ?? t('battle.opponent');
    const hp = Math.max(0, Math.min(fighter.stats.maxHp, fighter.hp));
    const percent = (hp / Math.max(1, fighter.stats.maxHp)) * 100;
    const position = side === 'a' ? 'left' : 'right';
    return `<div class="battle-hp-card frame ${position}"><strong>${escapeHtml(name)}</strong><div class="battle-hp-track" role="meter" aria-label="${escapeHtml(t('board.hp'))}" aria-valuemin="0" aria-valuemax="${fighter.stats.maxHp}" aria-valuenow="${hp}"><span style="width:${percent}%"></span></div><span class="battle-hp-value" data-testid="hp-${position}">${fighter.hp}/${fighter.stats.maxHp}</span></div>`;
  };
  if (shell) {
    let hud = shell.querySelector<HTMLElement>('.battle-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.className = 'battle-hud';
      shell.append(hud);
    }
    hud.innerHTML = hpCard('a') + hpCard('b');
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
    .map((action, index) => {
      const pick = action.type === 'battlePick' ? action.pick : 'item';
      const label = escapeHtml(actionName(action));
      const className = action.type === 'battlePick' ? 'command-card' : 'item-card';
      return `<button type="button" class="action-button ${className}" data-testid="${battleActionTestId(action)}" data-action-index="${index}"${awaitingView ? ' disabled' : ''}><span class="card-icon" style="${iconStyle(CARD_ICON[pick])}" aria-hidden="true"></span><span class="card-label">${label}</span></button>`;
    })
    .join('');

  const actionBar = root.querySelector<HTMLElement>('.action-bar');
  if (actionBar) {
    actionBar.setAttribute('aria-label', t('board.actions'));
    // The attack is locked while the defender chooses; show its back, not the
    // secret pick or a selection cursor on an action no longer offered.
    const chosen =
      battle.pending.attack !== null && battle.pending.defense === null
        ? '<span class="chosen-card" data-testid="chosen-card" aria-hidden="true">?</span>'
        : '';
    const markup = chosen + (buttons || `<span>${t('board.botThinking')}</span>`);
    if (actionBar.innerHTML !== markup) actionBar.innerHTML = markup;
  }
  root.querySelector('.dialog-shade')?.remove();
  if (passNeeded && battleSeat !== undefined) {
    const player = state.players[battleSeat]!;
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="dialog-shade pass-device" data-testid="pass-screen"><section class="game-dialog" role="dialog" aria-modal="true"><div class="pass-portrait portrait-${player.classId}" style="${portraitStyle(player.classId)}" role="img" aria-label="${t(`class.${player.classId}`)}"></div><h2>${t('battle.passDevice', { name: escapeHtml(player.prank?.alias ?? player.name) })}</h2><button class="primary" data-testid="pass-ready">${t('battle.ready')}</button></section></div>`,
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
    if (action) button.onclick = () => dispatch(action);
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
