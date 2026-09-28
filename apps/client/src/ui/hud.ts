import { legalActions, type Action, type GameState, type Player } from '@dice-bandits/engine';
import { data } from '@dice-bandits/engine';
import { t } from '../i18n';
import { showActionDialog } from './dialogs';

export function renderHud(
  root: HTMLElement,
  state: GameState,
  dispatch: (action: Action) => void,
): void {
  const battleSeat =
    state.phase.kind === 'battle'
      ? state.players.find((seat) => legalActions(state, seat.seat).length > 0)?.seat
      : undefined;
  const activeSeat =
    state.phase.kind === 'levelUp'
      ? state.phase.seat
      : state.phase.kind === 'pvpReward'
        ? state.phase.winner
        : (battleSeat ?? state.turnSeat);
  const player = state.players[activeSeat];
  if (!player) return;
  const seats = state.players.map((seat) => playerCard(state, seat)).join('');
  const actions = legalActions(state, activeSeat);
  const buttons =
    player.control === 'human'
      ? actions
          .map(
            (action, index) =>
              `<button class="action-button" data-testid="${testId(action)}" data-action-index="${index}">${escapeHtml(actionName(action))}</button>`,
          )
          .join('')
      : '';
  const header = `<header class="game-topline"><strong class="pixel">${t('title.gameName')}</strong><span class="round-label">${t('board.round', { round: state.round, total: state.config.rounds })}</span><span class="world-chip">${t(`worldRule.${state.worldRule}`)}</span><button class="text-button" data-action="exit">${t('setup.back')}</button></header>`;
  if (!root.querySelector('.game-shell')) {
    root.innerHTML = `<section class="game-shell" data-testid="screen-board"><div class="board-stage" id="phaser-board"></div>${header}<section class="seat-hud"></section><nav class="action-bar" aria-label="${t('board.actions')}"></nav></section>`;
  } else {
    const existingHeader = root.querySelector('.game-topline');
    if (existingHeader) {
      existingHeader.querySelector('strong')!.textContent = t('title.gameName');
      existingHeader.querySelector('.round-label')!.textContent = t('board.round', {
        round: state.round,
        total: state.config.rounds,
      });
      existingHeader.querySelector('.world-chip')!.textContent = t(`worldRule.${state.worldRule}`);
    }
  }
  root.querySelector('.seat-hud')!.innerHTML = seats;
  const actionBar = root.querySelector<HTMLElement>('.action-bar')!;
  actionBar.setAttribute('aria-label', t('board.actions'));
  actionBar.innerHTML = buttons || `<span>${t('board.botThinking')}</span>`;
  root.querySelector('.dialog-shade')?.remove();
  root.querySelectorAll<HTMLButtonElement>('[data-action-index]').forEach((button) => {
    const action = actions[Number(button.dataset.actionIndex)];
    if (action) button.addEventListener('click', () => dispatch(action));
  });
  if (state.phase.kind === 'pvpReward') showActionDialog(root, actions, dispatch);
}

function playerCard(state: GameState, player: Player): string {
  const hp = Math.max(0, Math.min(100, (player.hp / player.stats.maxHp) * 100));
  const towns = state.towns.filter((town) => town.owner === player.seat).length;
  const name = player.prank?.alias ?? player.name;
  const cards = player.banditCards.map((card) => t(`card.${card}`)).join(' · ');
  return `<article class="seat-card ${player.seat === state.turnSeat ? 'active' : ''}" style="--seat-color:${seatHex(player.seat)}"><img src="/sprites/hero-${player.classId}-portrait.png" alt="${t(`class.${player.classId}`)}"><div class="seat-details"><strong>${escapeHtml(name)}</strong><span>${player.gold} ${t('board.gold')} · ${t('board.level')} ${player.level} · ${towns} ${t('board.towns')}</span><div class="hp-track" aria-label="${t('board.hp')}"><span style="width:${hp}%"></span></div><small>${cards}</small></div></article>`;
}

function actionName(action: Action): string {
  switch (action.type) {
    case 'roll':
      return t('action.roll');
    case 'useItem':
      return `${t('action.item')} · ${itemName(action.item)}${action.target === null ? '' : ` ${action.target}`}`;
    case 'useBanditCard':
      return t(`card.${action.card}`);
    case 'chooseBranch':
      return t('action.branch', { to: action.to });
    case 'duel':
      return action.target === null
        ? t('action.skip')
        : t('action.duel', { target: action.target + 1 });
    case 'battlePick':
      return t(`action.${action.pick}`);
    case 'pvpReward':
      return t(`action.${action.reward}`);
    case 'pickPerk':
      return t(`perk.${action.perk}`);
    case 'shopBuy':
      return `${t('action.buy')} · ${itemName(action.item)}`;
    case 'shopSell':
      return `${t('action.sell')} · ${itemName(action.item)}`;
    case 'invest':
      return t('action.invest');
    case 'attackTown':
      return t('action.attackTown');
    case 'leave':
      return t('action.leave');
    case 'endTurn':
      return t('action.endTurn');
  }
}

function itemName(id: string): string {
  const key = `item.${id}`;
  return t(Object.hasOwn(data.ITEM_BY_ID, id) ? key : id);
}
function testId(action: Action): string {
  const suffix =
    action.type === 'useItem'
      ? `-${action.item}`
      : action.type === 'shopBuy' || action.type === 'shopSell'
        ? `-${action.item}`
        : action.type === 'chooseBranch'
          ? `-${action.to}`
          : action.type === 'duel' && action.target !== null
            ? `-${action.target}`
            : action.type === 'pickPerk'
              ? `-${action.perk}`
              : '';
  return `action-${action.type}${suffix}`;
}
function seatHex(seat: number): string {
  return ['#f15b4a', '#52c2ed', '#a5d65b', '#cd76d7'][seat % 4]!;
}
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}
