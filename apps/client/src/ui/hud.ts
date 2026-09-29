import { legalActions, type Action, type GameState, type Player } from '@dice-bandits/engine';
import type { PublicSeat } from '@dice-bandits/room';
import type { RoomSocketStatus } from '../online/socket';
import { data } from '@dice-bandits/engine';
import { getLang, setLang, t } from '../i18n';
import { renderBattleUi } from './battleUi';
import { showActionDialog, showPhaseDialog } from './dialogs';

type HudOnlineState = {
  you: number;
  seats: PublicSeat[];
  opponentPicked: boolean;
  socketStatus: RoomSocketStatus;
  awaitingView: boolean;
  reclaim: () => void;
};

type HudOptions = { legal?: Action[]; online?: HudOnlineState };

const hudContexts = new WeakMap<
  HTMLElement,
  { state: GameState; dispatch: (action: Action) => void; options?: HudOptions }
>();
const hudLanguageListeners = new WeakSet<HTMLElement>();

export function renderHud(
  root: HTMLElement,
  state: GameState,
  dispatch: (action: Action) => void,
  options?: HudOptions,
): void {
  const online = options?.online;
  const suppliedLegal = options?.legal;
  const battleSeat =
    state.phase.kind === 'battle'
      ? online
        ? (suppliedLegal ?? []).some((action) => action.type === 'battlePick')
          ? online.you
          : undefined
        : state.players.find((seat) =>
            legalActions(state, seat.seat).some((action) => action.type === 'battlePick'),
          )?.seat
      : undefined;
  const activeSeat = online
    ? online.you
    : state.phase.kind === 'levelUp'
      ? state.phase.seat
      : state.phase.kind === 'pvpReward'
        ? state.phase.winner
        : (battleSeat ?? state.turnSeat);
  const player = state.players[activeSeat];
  if (!player) return;
  const actions = online
    ? (suppliedLegal ?? [])
    : (suppliedLegal ?? legalActions(state, activeSeat));
  const seats = state.players.map((seat) => playerCard(state, seat, online?.seats)).join('');
  const canAct = online ? online.you === activeSeat : player.control === 'human';
  const buttons = canAct
    ? actions
        .map(
          (action, index) =>
            `<button class="action-button" data-testid="${testId(action)}" data-action-index="${index}"${online?.awaitingView ? ' disabled' : ''}>${escapeHtml(actionName(action))}</button>`,
        )
        .join('')
    : '';
  const header = `<header class="game-topline"><strong class="pixel">${t('title.gameName')}</strong><span class="round-label">${t('board.round', { round: state.round, total: state.config.rounds })}</span><span class="world-chip">${t(`worldRule.${state.worldRule}`)}</span><nav class="language-toggle" aria-label="${t('title.language')}"><button type="button" data-lang="th" aria-pressed="${getLang() === 'th'}">${t('lang.th')}</button><button type="button" data-lang="en" aria-pressed="${getLang() === 'en'}">${t('lang.en')}</button></nav><button class="text-button" data-action="exit">${t('setup.back')}</button></header>`;
  if (!root.querySelector('.game-shell')) {
    root.innerHTML = `<section class="game-shell" data-testid="screen-board"><div class="board-stage" id="phaser-board"></div>${header}<div class="online-status" aria-live="polite"></div><section class="seat-hud"></section><nav class="action-bar" aria-label="${t('board.actions')}"></nav><div class="rotate-hint" data-testid="rotate-hint">${t('board.rotateHint')}</div></section>`;
  } else {
    const existingHeader = root.querySelector('.game-topline');
    if (existingHeader) {
      existingHeader.querySelector('strong')!.textContent = t('title.gameName');
      existingHeader.querySelector('.round-label')!.textContent = t('board.round', {
        round: state.round,
        total: state.config.rounds,
      });
      existingHeader.querySelector('.world-chip')!.textContent = t(`worldRule.${state.worldRule}`);
      existingHeader.querySelector('nav')?.setAttribute('aria-label', t('title.language'));
      existingHeader.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.lang === getLang()));
      });
    }
  }
  const shell = root.querySelector<HTMLElement>('.game-shell')!;
  hudContexts.set(shell, { state, dispatch, options });
  if (!hudLanguageListeners.has(shell)) {
    hudLanguageListeners.add(shell);
    shell.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>('[data-lang]');
      if (!button || !shell.contains(button)) return;
      const context = hudContexts.get(shell);
      if (!context) return;
      setLang(button.dataset.lang as 'th' | 'en');
      renderHud(root, context.state, context.dispatch, context.options);
    });
  }
  root.querySelector('.seat-hud')!.innerHTML = seats;
  const onlineStatus = root.querySelector<HTMLElement>('.online-status')!;
  const ownTakeover =
    online?.seats.find((seat) => seat.seat === online.you)?.controller === 'botTakeover';
  onlineStatus.innerHTML = [
    online?.socketStatus === 'reconnecting'
      ? `<div class="online-reconnecting" data-testid="online-reconnecting">${t('online.reconnecting')}</div>`
      : '',
    ownTakeover
      ? `<div class="online-takeover" data-testid="online-takeover">${t('online.takeover')} <button type="button" data-testid="online-reclaim">${t('online.reclaim')}</button></div>`
      : '',
    online?.opponentPicked
      ? `<div data-testid="online-opponent-picked">${t('online.opponentPicked')}</div>`
      : '',
  ].join('');
  onlineStatus
    .querySelector<HTMLButtonElement>('[data-testid="online-reclaim"]')
    ?.addEventListener('click', online!.reclaim);
  const actionBar = root.querySelector<HTMLElement>('.action-bar')!;
  const isBattle = renderBattleUi(
    root,
    state,
    actions,
    battleSeat,
    dispatch,
    actionName,
    canAct,
    online !== undefined,
    online?.awaitingView ?? false,
  );
  if (!isBattle) {
    actionBar.setAttribute('aria-label', t('board.actions'));
    actionBar.innerHTML = buttons || `<span>${t('board.botThinking')}</span>`;
    root.querySelector('.dialog-shade')?.remove();
    root.querySelectorAll<HTMLButtonElement>('[data-action-index]').forEach((button) => {
      const action = actions[Number(button.dataset.actionIndex)];
      if (action) button.addEventListener('click', () => dispatch(action));
    });
  }
  if (state.phase.kind === 'pvpReward')
    showActionDialog(root, actions, dispatch, online?.awaitingView);
  else if (state.phase.kind === 'levelUp' || state.phase.kind === 'shop')
    showPhaseDialog(root, state, actions, dispatch, online?.awaitingView);
}

function playerCard(state: GameState, player: Player, seats?: PublicSeat[]): string {
  const hp = Math.max(0, Math.min(100, (player.hp / player.stats.maxHp) * 100));
  const towns = state.towns.filter((town) => town.owner === player.seat).length;
  const name = player.prank?.alias ?? player.name;
  const statsLabel = `${player.gold} ${t('board.gold')} · ${t('board.level')} ${player.level} · ${towns} ${t('board.towns')}`;
  const cards = player.banditCards.map((card) => t(`card.${card}`)).join(' · ');
  const compactCards = player.banditCards.length
    ? `<small class="seat-status" title="${escapeHtml(cards)}" aria-label="${escapeHtml(cards)}">${player.banditCards.length} 🃏</small>`
    : '';
  const takeoverBadge =
    seats?.find((seat) => seat.seat === player.seat)?.controller === 'botTakeover'
      ? `<small class="seat-status" data-testid="seat-takeover-${player.seat}">${t('online.takeover')}</small>`
      : '';
  return `<article class="seat-card ${player.seat === state.turnSeat ? 'active' : ''}" style="--seat-color:${seatHex(player.seat)}"><img src="/sprites/hero-${player.classId}-portrait.png" alt="${t(`class.${player.classId}`)}"><div class="seat-details"><strong>${escapeHtml(name)}</strong><span title="${escapeHtml(statsLabel)}" aria-label="${escapeHtml(statsLabel)}">${player.gold}🪙 · ${t('board.levelShort')}${player.level} · ${towns}🏘</span><div class="hp-track" aria-label="${t('board.hp')}"><span style="width:${hp}%"></span></div>${compactCards}${takeoverBadge}</div></article>`;
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
      ? `-${action.item}${action.target === null ? '' : `-${action.target}`}`
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
