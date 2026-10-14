import { type Action, type GameState } from '@dice-bandits/engine';
import { onLangChange, t } from '../i18n';
import { CARD_ICON, portraitStyle, monsterPortraitStyle, iconStyle } from './artFrames';
import { reducedMotion } from '../art/motion';
import { publishBattlePicker } from '../scenes/battle/camera';
import { needsPassScreen, type BattleSide } from './passDevice';
import { battleIdentity } from '../scenes/battle/presentation';

const readyPasses = new Set<string>();
const readoutModes = new WeakMap<HTMLElement, 'human' | 'bot' | 'online'>();
const swaps = new WeakMap<HTMLElement, { half: string; cancel(): void }>();

function showSwap(shell: HTMLElement, half: string, choosing: boolean): void {
  const previous = swaps.get(shell);
  if (!choosing) {
    previous?.cancel();
    return;
  }
  if (previous?.half === half) return;
  previous?.cancel();
  const cue = document.createElement('button');
  const timer = window.setTimeout(() => cue.remove(), 200);
  const cancel = () => {
    window.clearTimeout(timer);
    cue.remove();
  };
  const entry = { half, cancel };
  swaps.set(shell, entry);
  if (!previous || reducedMotion()) {
    cancel();
    return;
  }
  cue.type = 'button';
  cue.className = 'swap-beat';
  cue.dataset.testid = 'swap-beat';
  cue.setAttribute('aria-label', t('battle.swapDismiss'));
  cue.textContent = t('battle.swap');
  cue.onclick = cancel;
  shell.append(cue);
}

function revealCards(root: HTMLElement, beat: BattleBeat): void {
  root.querySelector('[data-testid="reveal-pair"]')?.remove();
  if (readoutModes.get(root) !== 'human') return;
  if (!beat.commands || !['reveal', 'result'].includes(beat.kind)) return;
  if (beat.kind === 'result' && beat.duration !== 0) return;
  const pair = document.createElement('div');
  pair.dataset.testid = 'reveal-pair';
  pair.className = `reveal-pair${beat.duration === 0 || reducedMotion() ? ' static' : ''}`;
  pair.setAttribute('aria-hidden', 'true');
  pair.innerHTML = (['a', 'b'] as const)
    .map((side) => {
      const pick = beat.commands?.[side];
      if (!pick) return '';
      const role = side === beat.attacker ? 'warm' : 'cool';
      return `<span class="reveal-card ${role}"><span class="card-icon" style="${iconStyle(CARD_ICON[pick])}"></span>${escapeHtml(t(`action.${pick}`))}</span>`;
    })
    .join('');
  (root.querySelector('.game-shell') ?? root).append(pair);
}

type BattleBeat = import('../scenes/battle/presentation').BattleBeat;
type PresentedFighter = { hp: number; maxHp: number; name: string; seat: number | null };
const readouts = new WeakMap<
  HTMLElement,
  { refresh(state?: GameState): void; reset(state: GameState): void }
>();

/** Cosmetic HP only. This view never changes controller state or legal actions.
 * The scene owns beat waits; this view owns and fences its one drain frame. */
export function createBattleReadout(root: HTMLElement): {
  showBeat(beat: BattleBeat): void;
  reset(state: GameState): void;
  destroy(): void;
} {
  let fighters: Partial<Record<BattleSide, PresentedFighter>> = {};
  let active = false;
  let destroyed = false;
  let element: HTMLElement | null = null;
  let frame: number | undefined;
  let finishDrain: (() => void) | undefined;
  let revision = 0;
  let identity: string | null = null;
  const stop = (): void => {
    revision++;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    finishDrain = undefined;
  };
  const refresh = (state?: GameState): void => {
    if (destroyed) return;
    if (state && identity !== battleIdentity(state)) {
      reset(state);
      return;
    }
    if (!active) return;
    for (const side of ['a', 'b'] as const) {
      const fighter = fighters[side];
      if (!fighter) continue;
      const card = root.querySelector(`.battle-hp-card.${side === 'a' ? 'left' : 'right'}`);
      const hp = Math.max(0, Math.min(fighter.maxHp, Math.round(fighter.hp)));
      const value = card?.querySelector('.battle-hp-value');
      if (value) value.textContent = `${hp}/${fighter.maxHp}`;
      const meter = card?.querySelector('[role="meter"]');
      meter?.setAttribute('aria-valuenow', String(hp));
      meter?.setAttribute('aria-valuemax', String(fighter.maxHp));
      const fill = meter?.querySelector<HTMLElement>('span');
      if (fill) fill.style.width = `${(hp / Math.max(1, fighter.maxHp)) * 100}%`;
    }
  };
  const reset = (state: GameState): void => {
    stop();
    identity = battleIdentity(state);
    root.querySelector('[data-testid="reveal-pair"]')?.remove();
    element?.remove();
    element = null;
    if (state.phase.kind === 'battle') {
      const battle = state.phase.battle;
      fighters = Object.fromEntries(
        (['a', 'b'] as const).map((side) => {
          const fighter = battle[side];
          const player = state.players.find((entry) => entry.seat === fighter.seat);
          return [
            side,
            {
              hp: fighter.hp,
              maxHp: fighter.stats.maxHp,
              name: player?.prank?.alias ?? player?.name ?? t('battle.opponent'),
              seat: fighter.seat,
            },
          ];
        }),
      );
    } else {
      for (const fighter of Object.values(fighters)) {
        const player = state.players.find((entry) => entry.seat === fighter.seat);
        if (player) {
          fighter.hp = player.hp;
          fighter.maxHp = player.stats.maxHp;
        }
      }
    }
    active = true;
    refresh();
    active = false;
  };
  const name = (side: BattleSide): string => fighters[side]?.name ?? t('battle.opponent');
  const text = (beat: BattleBeat): string => {
    const damage = beat.targets
      .filter((target) => target.amount > 0)
      .map((target) => t('battle.consequence', { name: name(target.side), amount: target.amount }))
      .join(' · ');
    const revealed = (beat.revealed ?? [])
      .map((entry) =>
        t('battle.revealed', { name: name(entry.side), secret: t(`secret.${entry.secretId}`) }),
      )
      .join(' · ');
    if (beat.kind === 'result') {
      const result = beat.winner
        ? t('battle.result.winner', { name: name(beat.winner) })
        : t(`battle.result.${beat.result ?? 'nextHalf'}`);
      return beat.duration === 0
        ? [revealed, damage || (beat.outcome ? t(`battle.outcome.${beat.outcome}`) : ''), result]
            .filter(Boolean)
            .join(' · ')
        : result;
    }
    if (beat.kind === 'reveal') return revealed || t('battle.beat.reveal');
    if (beat.kind === 'damage') return damage || t(`battle.outcome.${beat.outcome ?? 'blocked'}`);
    if (beat.kind === 'drain')
      return beat.targets
        .map((target) =>
          t('battle.hpChange', { name: name(target.side), from: target.fromHp, to: target.toHp }),
        )
        .join(' · ');
    if (beat.kind === 'impact' && beat.outcome && beat.outcome !== 'hit')
      return t(`battle.outcome.${beat.outcome}`);
    return t(`battle.beat.${beat.kind}`);
  };
  const view = {
    refresh,
    reset,
    showBeat(beat: BattleBeat): void {
      if (destroyed) return;
      revealCards(root, beat);
      finishDrain?.();
      stop();
      active = true;
      if (!element || !root.contains(element)) {
        element = document.createElement('div');
        element.className = 'battle-readout';
        element.dataset.testid = 'battle-readout';
        element.setAttribute('role', 'status');
        element.setAttribute('aria-live', 'polite');
        element.setAttribute('aria-atomic', 'true');
        // M2 readout in the reserved centre lane above the command tray.
        // Component-local tokens keep this card inside its file manifest.
        element.style.cssText =
          'position:absolute;left:50%;transform:translateX(-50%);z-index:15;max-width:42%;padding:4px 12px;border:2px solid var(--c-cocoa);border-radius:14px;background:var(--t-panel);color:var(--c-cocoa);font:600 14px/21px Mitr,sans-serif;text-align:center;overflow-wrap:anywhere;pointer-events:none;box-shadow:var(--t-shadow)';
        const shell = root.querySelector<HTMLElement>('.game-shell') ?? root;
        const tray = shell.querySelector('.action-tray')?.getBoundingClientRect();
        element.style.bottom = `${tray ? shell.getBoundingClientRect().bottom - tray.top + 8 : 104}px`;
        shell.append(element);
      }
      element.dataset.beat = beat.kind;
      element.textContent = text(beat);
      if (beat.kind === 'drain' || beat.duration === 0) {
        // A level-up can change the denominator without changing HP. Apply
        // both at the consequence boundary, never during reveal/damage.
        for (const side of ['a', 'b'] as const) {
          const fighter = fighters[side];
          const maximum = beat.maxHp?.[side];
          if (fighter && maximum !== undefined) fighter.maxHp = maximum;
        }
        const owned = revision;
        const start = performance.now();
        const apply = (progress: number): void => {
          for (const target of beat.targets) {
            const fighter = fighters[target.side];
            if (fighter) fighter.hp = target.fromHp + (target.toHp - target.fromHp) * progress;
          }
          refresh();
        };
        if (beat.duration <= 0) apply(1);
        else {
          finishDrain = () => apply(1);
          apply(0);
          const tick = (now: number): void => {
            if (owned !== revision || destroyed) return;
            const progress = Math.min(1, Math.max(0, (now - start) / beat.duration));
            apply(progress);
            frame = progress < 1 ? requestAnimationFrame(tick) : undefined;
          };
          frame = requestAnimationFrame(tick);
        }
      }
      refresh();
    },
    destroy(): void {
      stop();
      destroyed = true;
      element?.remove();
      element = null;
      readouts.delete(root);
      offLang();
    },
  };
  const offLang = onLangChange(() => {
    stop();
    element?.remove();
    element = null;
    active = false;
  });
  readouts.set(root, view);
  return view;
}

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
  opponentPicked = false,
): boolean {
  const shell = root.querySelector<HTMLElement>('.game-shell');
  if (!awaitingView) readoutModes.set(root, onlineMode ? 'online' : humanPicker ? 'human' : 'bot');
  if (state.phase.kind !== 'battle') {
    readyPasses.clear();
    if (shell) {
      publishBattlePicker(shell, null);
      swaps.get(shell)?.cancel();
      swaps.delete(shell);
      shell.classList.remove('battle-mode', 'battle-choosing');
      shell.querySelector('.board-stage')?.classList.remove('battle-panel');
      shell.querySelector('.battle-hud')?.remove();
      shell.querySelector('[data-testid="stance-banner"]')?.remove();
      shell.querySelector('[data-testid="reveal-pair"]')?.remove();
    }
    return false;
  }

  shell?.classList.add('battle-mode');
  shell?.querySelector('.board-stage')?.classList.add('battle-panel');
  const exit = shell?.querySelector<HTMLButtonElement>('.game-topline [data-action="exit"]');
  if (exit) exit.textContent = t('setup.back');
  const battle = state.phase.battle;
  const fighterName = (side: BattleSide): string => {
    const fighter = battle[side];
    const player = fighter.kind === 'player' ? state.players[fighter.seat!] : undefined;
    return player?.prank?.alias ?? player?.name ?? t(`monster.${fighter.monsterId}`);
  };
  const hpCard = (side: BattleSide) => {
    const fighter = battle[side];
    const player = fighter.kind === 'player' ? state.players[fighter.seat!] : undefined;
    const portrait = player
      ? portraitStyle(player.classId)
      : monsterPortraitStyle(fighter.monsterId ?? '');
    const hp = Math.max(0, Math.min(fighter.stats.maxHp, fighter.hp));
    const percent = (hp / Math.max(1, fighter.stats.maxHp)) * 100;
    const position = side === 'a' ? 'left' : 'right';
    return `<div class="battle-hp-card frame ${position}"><span class="battle-portrait" style="${portrait}" aria-hidden="true"></span><strong>${escapeHtml(fighterName(side))}</strong><div class="battle-hp-track" role="meter" aria-label="${escapeHtml(t('board.hp'))}" aria-valuemin="0" aria-valuemax="${fighter.stats.maxHp}" aria-valuenow="${hp}"><span style="width:${percent}%"></span></div><span class="battle-hp-value" data-testid="hp-${position}">${fighter.hp}/${fighter.stats.maxHp}</span></div>`;
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

  // The Worker's redacted pending.attack may be null while it offers legal
  // defense picks. Legality owns the local side; never infer a hidden command.
  const localPick = onlineMode ? actions.find((action) => action.type === 'battlePick') : undefined;
  const side =
    localPick?.type === 'battlePick'
      ? localPick.side
      : onlineMode && opponentPicked
        ? battle.attackerSide === 'a'
          ? 'b'
          : 'a'
        : pendingSide(state);
  const passKey = battlePassKey(state, side);
  const passNeeded =
    battleSeat !== undefined &&
    !onlineMode &&
    needsPassScreen(state, side) &&
    !readyPasses.has(passKey);
  if (passNeeded) readouts.get(root)?.reset(state);
  else readouts.get(root)?.refresh(state);
  const attacking = side === battle.attackerSide;
  const picker = battle[side];
  const player = picker.kind === 'player' ? state.players[picker.seat!] : undefined;
  const choosing =
    humanPicker &&
    !awaitingView &&
    !passNeeded &&
    player?.control === 'human' &&
    actions.some((action) => action.type === 'battlePick' && action.side === side);
  const ownership =
    passNeeded || awaitingView
      ? 'none'
      : choosing
        ? 'local-human'
        : player?.control === 'human'
          ? 'remote-human'
          : 'bot';
  const locked =
    !passNeeded &&
    battle.pending.defense === null &&
    (battle.pending.attack !== null ||
      (onlineMode && opponentPicked) ||
      (localPick?.type === 'battlePick' && !attacking));
  const backCaption = t('battle.cardBack', { name: fighterName(battle.attackerSide) });
  if (shell) {
    let banner = shell.querySelector<HTMLElement>('[data-testid="stance-banner"]');
    if (!banner) {
      banner = document.createElement('div');
      banner.dataset.testid = 'stance-banner';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.setAttribute('aria-atomic', 'true');
      shell.append(banner);
    }
    banner.className = `stance-banner ${attacking ? 'warm' : 'cool'}`;
    const role = t(attacking ? 'battle.turnAttack' : 'battle.turnDefense');
    const caption = awaitingView
      ? t('battle.turnReveal')
      : choosing || passNeeded
        ? `${role} · ${fighterName(side)}`
        : `${role} · ${t('battle.turnWaiting', { name: fighterName(side) })}`;
    banner.innerHTML = `<span class="stance-icon" style="${iconStyle(attacking ? 'sword' : 'shield')}" aria-hidden="true"></span><div><strong>${escapeHtml(caption)}</strong><span>${t('battle.exchange', { exchange: battle.exchange })} · ${t('battle.half', { half: battle.half })}</span>${locked ? `<span class="sr-only">${escapeHtml(backCaption)}</span>` : ''}</div>`;
    shell.classList.toggle('battle-choosing', choosing);
    const halfKey = `${battleIdentity(state)}:${battle.exchange}:${battle.half}:${side}`;
    showSwap(shell, halfKey, choosing);
    publishBattlePicker(shell, {
      side,
      role: attacking ? 'attack' : 'defense',
      ownership,
      battleId: battleIdentity(state)!,
      halfKey,
    });
  }
  const shownActions = passNeeded ? [] : actions;
  const pickerActions = humanPicker
    ? shownActions.filter((action) => action.type === 'battlePick' || action.type === 'useItem')
    : [];
  const buttons = pickerActions
    .map((action, index) => {
      const pick = action.type === 'battlePick' ? action.pick : 'item';
      const label = escapeHtml(actionName(action));
      const className = action.type === 'battlePick' ? 'command-card' : 'item-card';
      const colour = attacking ? 'warm' : 'cool';
      const sword =
        pick === 'counter'
          ? `<span class="counter-sword" style="${iconStyle('sword')}"></span>`
          : '';
      return `<button type="button" class="action-button ${className} ${colour}" data-testid="${battleActionTestId(action)}" data-action-index="${index}"${awaitingView ? ' disabled' : ''}><span class="card-icon" style="${iconStyle(CARD_ICON[pick])}" aria-hidden="true">${sword}</span><span class="card-label">${label}</span><span class="card-description">${escapeHtml(t(`battle.description.${pick}`))}</span></button>`;
    })
    .join('');
  const actionBar = root.querySelector<HTMLElement>('.action-bar');
  if (actionBar) {
    actionBar.setAttribute('aria-label', t('board.actions'));
    // No command identifier or class-specific Secret data crosses this back.
    const chosen = locked
      ? `<span class="chosen-card card-back" data-testid="chosen-card" aria-hidden="true"><span class="card-back-mark">?</span><span class="card-back-caption">${escapeHtml(backCaption)}</span></span>`
      : '';
    const markup = chosen + (buttons || `<span>${t('board.botThinking')}</span>`);
    if (actionBar.innerHTML !== markup) actionBar.innerHTML = markup;
  }
  root.querySelector('.dialog-shade')?.remove();
  if (passNeeded && battleSeat !== undefined) {
    const player = state.players[battleSeat]!;
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="dialog-shade pass-device" data-testid="pass-screen"><section class="game-dialog" role="dialog" aria-modal="true" aria-labelledby="battle-pass-heading"><div class="pass-portrait portrait-${player.classId}" style="${portraitStyle(player.classId)}" role="img" aria-label="${t(`class.${player.classId}`)}"></div><h2 id="battle-pass-heading">${t('battle.passDevice', { name: escapeHtml(player.prank?.alias ?? player.name) })}</h2><button class="primary" data-testid="pass-ready">${t('battle.ready')}</button></section></div>`,
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
    if (action)
      button.onclick = () => {
        if (shell) swaps.get(shell)?.cancel();
        dispatch(action);
      };
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
