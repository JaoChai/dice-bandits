import { legalActions, type Action, type GameState, type Player } from '@dice-bandits/engine';
import type { PublicSeat } from '@dice-bandits/room';
import type { RoomSocketStatus } from '../online/socket';
import { data } from '@dice-bandits/engine';
import { getLang, setLang, t } from '../i18n';
import { getAudioSettings, setAudioSettings } from '../audio';
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
  const header = `<header class="game-topline"><strong class="pixel">${t('title.gameName')}</strong><span class="round-label">${t('board.round', { round: state.round, total: state.config.rounds })}</span><span class="world-chip">${t(`worldRule.${state.worldRule}`)}</span><nav class="language-toggle" aria-label="${t('title.language')}"><button type="button" data-lang="th" aria-pressed="${getLang() === 'th'}">${t('lang.th')}</button><button type="button" data-lang="en" aria-pressed="${getLang() === 'en'}">${t('lang.en')}</button></nav>${audioToggleHtml()}<button class="text-button" data-testid="map-toggle" aria-pressed="false">${t('map.whole')}</button><button class="text-button" data-action="exit">${t('setup.back')}</button></header>`;
  if (!root.querySelector('.game-shell')) {
    root.innerHTML = `<section class="game-shell" data-testid="screen-board"><div class="board-stage" id="phaser-board"></div>${header}<div class="event-banner frame" data-testid="event-banner" role="status" tabindex="0"><span class="event-meta"><span class="round-label">${t('board.round', { round: state.round, total: state.config.rounds })}</span><span class="world-chip">${t(`worldRule.${state.worldRule}`)}</span></span><span class="event-text">${state.round >= 10 ? t('event.FrenzyStarted') : ''}</span></div><div class="online-status" aria-live="polite"></div><section class="seat-hud">${seats}</section><nav class="action-tray action-bar frame" data-testid="action-tray" aria-label="${t('board.actions')}"></nav><div class="rotate-hint" data-testid="rotate-hint">${t('board.rotateHint')}</div></section>`;
    bindAudioToggle(root.querySelector('.game-topline [data-testid="audio-toggle"]'));
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
      syncAudioToggle(
        existingHeader.querySelector<HTMLButtonElement>('[data-testid="audio-toggle"]'),
      );
    }
  }
  const shell = root.querySelector<HTMLElement>('.game-shell')!;
  hudContexts.set(shell, { state, dispatch, options });
  if (!hudLanguageListeners.has(shell)) {
    hudLanguageListeners.add(shell);
    shell.addEventListener('keydown', (event) => {
      if (!(event.target instanceof Element)) return;
      const banner = event.target.closest<HTMLElement>('[data-testid="event-banner"]');
      if (!banner || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      banner.classList.toggle('expanded');
    });
    shell.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const banner = target.closest<HTMLElement>('[data-testid="event-banner"]');
      if (banner) banner.classList.toggle('expanded');
      const button = target.closest<HTMLButtonElement>('[data-lang]');
      if (!button || !shell.contains(button)) return;
      const context = hudContexts.get(shell);
      if (!context) return;
      setLang(button.dataset.lang as 'th' | 'en');
      renderHud(root, context.state, context.dispatch, context.options);
    });
  }
  root.querySelector('.seat-hud')!.innerHTML = seats;
  // "<name>'s turn" ribbon (spec §7): re-created per render, cheapest correct.
  const ribbonText = t('turn.ribbon', {
    name: state.players[state.turnSeat]?.name ?? '',
  });
  let ribbon = root.querySelector<HTMLElement>('[data-testid="turn-ribbon"]');
  if (!ribbon) {
    ribbon = document.createElement('div');
    ribbon.className = 'turn-ribbon';
    ribbon.dataset.testid = 'turn-ribbon';
    ribbon.setAttribute('role', 'status');
    root.querySelector('.game-shell')!.append(ribbon);
  }
  ribbon.textContent = ribbonText;
  ribbon.classList.toggle('visible', true);
  const mapToggle = root.querySelector<HTMLButtonElement>('[data-testid="map-toggle"]');
  if (mapToggle) {
    const whole = window.diceBanditsMapWhole === true;
    mapToggle.setAttribute('aria-pressed', String(whole));
    mapToggle.textContent = whole ? t('map.back') : t('map.whole');
  }
  const banner = root.querySelector<HTMLElement>('[data-testid="event-banner"]')!;
  banner.querySelector('.round-label')!.textContent = t('board.round', {
    round: state.round,
    total: state.config.rounds,
  });
  banner.querySelector('.world-chip')!.textContent = t(`worldRule.${state.worldRule}`);
  if (state.round >= 10 && !banner.querySelector('.event-text')!.textContent)
    banner.querySelector('.event-text')!.textContent = t('event.FrenzyStarted');
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
  const actionBar = root.querySelector<HTMLElement>('.action-tray')!;
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
    const markup = buttons || `<span>${t('board.botThinking')}</span>`;
    if (actionBar.innerHTML !== markup) actionBar.innerHTML = markup;
    root.querySelector('.dialog-shade')?.remove();
    root.querySelectorAll<HTMLButtonElement>('[data-action-index]').forEach((button) => {
      const action = actions[Number(button.dataset.actionIndex)];
      if (action) button.onclick = () => dispatch(action);
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
  const cards = player.banditCards.map((card) => t(`card.${card}`)).join(' · ');
  const compactCards = player.banditCards.length
    ? `<small class="seat-status" title="${escapeHtml(cards)}" aria-label="${escapeHtml(cards)}">${player.banditCards.length} 🃏</small>`
    : '';
  const takeoverBadge =
    seats?.find((seat) => seat.seat === player.seat)?.controller === 'botTakeover'
      ? `<small class="seat-status" data-testid="seat-takeover-${player.seat}">${t('online.takeover')}</small>`
      : '';
  const classes = ['corner-tl', 'corner-tr', 'corner-bl', 'corner-br'];
  const accent = ['#f15b4a', '#52c2ed', '#a5d65b', '#cd76d7'][player.seat % 4]!;
  return `<article class="seat-card ${classes[player.seat % 4]} ${player.seat === state.turnSeat ? 'active' : ''}" style="--seat-color:${accent}"><div class="seat-portrait portrait-${player.classId}" role="img" aria-label="${t(`class.${player.classId}`)}"></div><div class="seat-details"><strong>${escapeHtml(name)}</strong><div class="seat-stats"><span aria-label="${player.gold} ${escapeHtml(t('board.gold'))}">${player.gold} ${t('board.gold')}</span><span aria-label="${escapeHtml(t('board.level'))} ${player.level}">${t('board.levelShort')} ${player.level}</span><span aria-label="${towns} ${escapeHtml(t('board.towns'))}">${towns} ${t('board.towns')}</span></div><div class="hp-track" aria-label="${t('board.hp')}"><span style="width:${hp}%"></span></div>${compactCards}${takeoverBadge}</div></article>`;
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
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

/** Pixel-style speaker SVG: waves show when sound is on, a red slash when muted. */
function audioToggleHtml(): string {
  const muted = getAudioSettings().muted;
  const label = muted ? t('audio.unmute') : t('audio.mute');
  return `<button type="button" class="audio-toggle" data-testid="audio-toggle" aria-pressed="${muted}" aria-label="${label}" title="${label}"><svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true" focusable="false"><g shape-rendering="crispEdges" fill="currentColor"><rect x="2" y="6" width="2" height="4"/><rect x="4" y="5" width="2" height="6"/><rect x="6" y="4" width="2" height="8"/><g class="audio-waves"><rect x="10" y="6" width="1" height="4"/><rect x="12" y="4" width="1" height="8"/></g></g><g class="audio-slash" shape-rendering="crispEdges" stroke="#e2606c" stroke-width="2"><line x1="1" y1="15" x2="15" y2="1"/></g></svg></button>`;
}

/** Bind the mute handler exactly once per button element. */
function bindAudioToggle(button: HTMLButtonElement | null): void {
  if (!button || button.dataset.audioBound) return;
  button.dataset.audioBound = '1';
  button.addEventListener('click', () => {
    setAudioSettings({ muted: !getAudioSettings().muted });
    syncAudioToggle(button);
  });
}

/** Refresh aria-pressed / aria-label from the current settings (no rebind, no recreate). */
function syncAudioToggle(button: HTMLButtonElement | null): void {
  if (!button) return;
  const muted = getAudioSettings().muted;
  button.setAttribute('aria-pressed', String(muted));
  const label = muted ? t('audio.unmute') : t('audio.mute');
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
}
