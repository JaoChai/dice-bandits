import {
  chooseAction,
  createGame,
  legalActions,
  step,
  type Action,
  type GameEvent,
} from '@dice-bandits/engine';
import type { PracticeSession } from '../tutor/practice';
import type { TutorialScript } from '../tutor/script';
import { getLang, onLangChange, setLang, t } from '../i18n';
import atlas from '../../public/art/tutor/dicey.json';

type Topic = TutorialScript['lessons'][number]['topic'];
const topics: Topic[] = ['roll', 'move', 'fork', 'chest', 'battle', 'shop', 'town', 'steal'];
type DialogKind = 'invite' | 'loading' | 'error' | 'empty' | 'complete' | 'exit';

function portrait(pose: keyof typeof atlas.frames, width: number): string {
  const frame = atlas.frames[pose];
  const scale = width / frame.w;
  return `<div class="practice-art" aria-hidden="true" style="width:${width}px;height:${frame.h * scale}px;background-size:${900 * scale}px ${300 * scale}px;background-position:${-frame.x * scale}px ${-frame.y * scale}px"></div>`;
}
function lessonGrid(count: number): string {
  return `<ol class="practice-lessons">${topics.map((topic, i) => `<li class="practice-topic ${i < count ? 'learned' : ''}"><span aria-hidden="true">${i < count ? '✓' : i + 1}</span>${t(`practice.topic.${topic}`)}</li>`).join('')}</ol>`;
}
function button(id: string, key: string, primary = false): string {
  return `<button type="button" class="practice-button ${primary ? 'practice-primary' : ''}" data-testid="practice-${id}">${t(`practice.${key}`)}</button>`;
}

/** A modal owns only its focus/inert changes; never a game or a storage setting. */
function mountDialog(
  root: HTMLElement,
  kind: DialogKind,
  callbacks: Record<string, () => void>,
  onEscape: () => void,
): () => void {
  const previous = document.activeElement;
  const previousId = previous instanceof HTMLElement ? previous.dataset.testid : undefined;
  const background = [...root.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
  const inert = background.map((el) => el.inert);
  background.forEach((el) => {
    el.inert = true;
  });
  const host = document.createElement('div');
  host.className = 'practice-scrim';
  host.dataset.testid = 'practice-dialog';
  root.append(host);
  let closed = false;
  const render = (): void => {
    const focused = (document.activeElement as HTMLElement | null)?.dataset.testid;
    const actions =
      kind === 'invite'
        ? button('begin', 'begin', true) + button('back', 'later')
        : kind === 'complete'
          ? button('setup', 'setup', true) + button('replay', 'replay')
          : kind === 'exit'
            ? button('stay', 'stay', true) + button('leave', 'leave')
            : kind === 'error'
              ? button('retry', 'retry', true) + button('back', 'back')
              : button('back', 'back', kind === 'empty');
    host.innerHTML = `<section class="practice-invitation" role="dialog" aria-modal="true" aria-labelledby="practice-dialog-title" aria-describedby="practice-dialog-description"><div class="practice-invite-art">${portrait(kind === 'error' ? 'surprised' : 'happy', 140)}</div><div class="practice-invite-content"><span class="practice-eyebrow">${t(kind === 'complete' ? 'practice.complete.tag' : 'practice.invite.tag')}</span><h1 id="practice-dialog-title">${t(`practice.${kind}.title`)}</h1><p id="practice-dialog-description">${t(`practice.${kind}.body`)}</p>${kind === 'invite' || kind === 'complete' ? lessonGrid(kind === 'complete' ? 8 : 0) : ''}<div class="practice-modal-actions">${actions}</div>${kind === 'invite' ? `<p class="practice-duration">${t('practice.duration')}</p>` : ''}</div></section>`;
    for (const [id, callback] of Object.entries(callbacks)) {
      host.querySelector(`[data-testid="practice-${id}"]`)?.addEventListener('click', callback);
    }
    const target = focused ? host.querySelector<HTMLElement>(`[data-testid="${focused}"]`) : null;
    (target ?? host.querySelector<HTMLElement>('button'))?.focus();
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      onEscape();
    } else if (event.key === 'Tab') {
      const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault();
      buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  };
  const focus = (event: FocusEvent): void => {
    if (event.target instanceof Node && !host.contains(event.target))
      host.querySelector<HTMLElement>('button')?.focus();
  };
  render();
  const offLang = onLangChange(render);
  document.addEventListener('keydown', key, true);
  document.addEventListener('focusin', focus);
  return () => {
    if (closed) return;
    closed = true;
    offLang();
    document.removeEventListener('keydown', key, true);
    document.removeEventListener('focusin', focus);
    host.remove();
    background.forEach((el, i) => {
      el.inert = inert[i]!;
    });
    const restored =
      previous instanceof HTMLElement && previous.isConnected
        ? previous
        : previousId
          ? root.querySelector<HTMLElement>(`[data-testid="${previousId}"]`)
          : null;
    restored?.focus();
  };
}

/** Load/validate before constructing any controller; cancelled loads cannot start a game. */
export function preparePractice(
  root: HTMLElement,
  onBegin: (script: TutorialScript) => void,
  onBack: () => void,
  load: () => Promise<TutorialScript | null> = async () =>
    (await import('../tutor/script')).TUTORIAL_SCRIPT,
): { readonly ready: Promise<void>; destroy(): void } {
  let destroyed = false;
  let generation = 0;
  let closeDialog: (() => void) | undefined;
  let ready: Promise<void>;
  root.classList.add('practice-preparing');
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    generation++;
    closeDialog?.();
    root.classList.remove('practice-preparing');
  };
  const back = (): void => {
    destroy();
    onBack();
  };
  const show = (kind: DialogKind, script?: TutorialScript): void => {
    closeDialog?.();
    closeDialog = mountDialog(
      root,
      kind,
      {
        back,
        retry: () => {
          ready = start();
        },
        begin: () => {
          if (!script || destroyed) return;
          destroy();
          onBegin(script);
        },
      },
      back,
    );
  };
  const start = async (): Promise<void> => {
    const ownGeneration = ++generation;
    show('loading');
    try {
      const script = await load();
      if (destroyed || ownGeneration !== generation) return;
      if (!script || script.lessons?.length === 0) {
        show('empty');
        return;
      }
      // Preflight with the ordinary engine only; no saving controller is made.
      if (
        script.id !== 'm8-route-v1' ||
        script.lessons.map((lesson) => lesson.topic).join() !== topics.join()
      )
        throw new Error('Unavailable route');
      let state = createGame(script.config);
      if (
        state.players.length !== 2 ||
        state.players[0]?.control !== 'human' ||
        state.players[1]?.control !== 'bot' ||
        !script.replay.length
      )
        throw new Error('Unavailable seats');
      for (const [index, entry] of script.replay.entries()) {
        const same = (action: Action): boolean =>
          JSON.stringify(action) === JSON.stringify(entry.action);
        if (!legalActions(state, entry.seat).some(same)) throw new Error('Illegal route');
        if (state.players[entry.seat]?.control === 'bot' && !same(chooseAction(state, entry.seat)))
          throw new Error('Divergent bot');
        for (const lesson of script.lessons.filter((lesson) => lesson.replayIndex === index)) {
          if (
            state.players[entry.seat]?.control !== 'human' ||
            lesson.beforePhase !== state.phase.kind ||
            !same(lesson.suggested)
          )
            throw new Error('Invalid lesson');
        }
        state = step(state, entry.action).state;
      }
      if (script.lessons.some((lesson) => !script.replay[lesson.replayIndex]))
        throw new Error('Incomplete route');
      show('invite', structuredClone(script));
    } catch {
      if (!destroyed && ownGeneration === generation) show('error');
    }
  };
  ready = start();
  return {
    get ready() {
      return ready;
    },
    destroy,
  };
}

function actionSelector(action: Action, session: PracticeSession): string {
  if (action.type === 'pvpReward') {
    const index = legalActions(session.controller.state, 0)
      .filter((candidate) => candidate.type === 'pvpReward')
      .findIndex((candidate) =>
        Object.entries(action).every(([key, value]) => candidate[key as keyof Action] === value),
      );
    return `.reward-dialog [data-choice="${index}"]`;
  }
  if (action.type === 'pickPerk') return `[data-testid="perk-${action.perk}"]`;
  if (action.type === 'shopBuy' || action.type === 'shopSell')
    return `[data-testid="shop-${action.type}-${action.item}"]`;
  if (action.type === 'leave' && session.controller.state.phase.kind === 'shop')
    return '[data-testid="shop-leave-leave"]';
  if (action.type === 'battlePick') return `[data-testid="pick-${action.pick}"]`;
  const suffix =
    action.type === 'chooseBranch'
      ? `-${action.to}`
      : action.type === 'duel' && action.target !== null
        ? `-${action.target}`
        : '';
  return `[data-testid="action-${action.type}${suffix}"]`;
}

export function mountPracticeUi(
  root: HTMLElement,
  session: PracticeSession,
  options?: { learned?: () => number },
): { update(events?: GameEvent[]): void; destroy(): void } {
  root.classList.add('practice-root');
  const shell = root.querySelector<HTMLElement>('.game-shell');
  const initialInert = shell?.inert ?? false;
  const header = document.createElement('header');
  header.className = 'practice-topbar';
  const coach = document.createElement('aside');
  coach.className = 'practice-coach';
  coach.dataset.testid = 'practice-coach';
  coach.setAttribute('aria-live', 'polite');
  coach.setAttribute('aria-atomic', 'true');
  root.append(header, coach);
  let destroyed = false;
  let closeDialog: (() => void) | undefined;
  let dialogKind: DialogKind | undefined;
  let outcome: GameEvent[] = [];
  let instructionKey = '';
  let highlighted: HTMLElement | undefined;
  let priorDescription: string | null = null;
  const emit = (action: string): void => {
    root.dispatchEvent(new CustomEvent(`dice-bandits:practice-${action}`, { bubbles: true }));
  };
  const clearHighlight = (): void => {
    if (!highlighted) return;
    highlighted.classList.remove('practice-highlight');
    if (priorDescription === null) highlighted.removeAttribute('aria-describedby');
    else highlighted.setAttribute('aria-describedby', priorDescription);
    highlighted = undefined;
  };
  const close = (): void => {
    closeDialog?.();
    closeDialog = undefined;
    dialogKind = undefined;
  };
  const show = (kind: DialogKind): void => {
    if (dialogKind === kind) return;
    close();
    dialogKind = kind;
    closeDialog = mountDialog(
      root,
      kind,
      {
        stay: close,
        leave: () => emit('exit'),
        back: () => emit('exit'),
        retry: () => emit('replay'),
        replay: () => emit('replay'),
        setup: () => emit('setup'),
      },
      kind === 'exit' ? close : () => emit('exit'),
    );
  };
  const requestExit = (): void => {
    if (!destroyed) show('exit');
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !dialogKind) {
      event.preventDefault();
      requestExit();
    } else if (event.key === 'Tab' && !dialogKind) {
      const phase = root.querySelector('.dialog-shade');
      if (!phase) return;
      const choices = [...phase.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!choices.length) return;
      event.preventDefault();
      const index = choices.indexOf(document.activeElement as HTMLButtonElement);
      choices[(index + (event.shiftKey ? -1 : 1) + choices.length) % choices.length]?.focus();
    }
  };
  const update = (events?: GameEvent[]): void => {
    if (destroyed) return;
    if (events?.length) outcome = events;
    if (shell && !dialogKind) shell.inert = initialInert || !!root.querySelector('.dialog-shade');
    const count = options?.learned?.() ?? (session.completed ? 8 : topics.indexOf(session.topic));
    const focused = (document.activeElement as HTMLElement | null)?.dataset.testid;
    header.innerHTML = `<div class="practice-brand"><span class="practice-tag">${t('practice.tag')}</span><strong>${t('practice.with')}</strong></div><div class="practice-progress"><span>${t('practice.learned')} <b>${count}/8</b></span><div class="practice-track" role="progressbar" aria-label="${t('practice.learned')}" aria-valuenow="${count}" aria-valuemin="0" aria-valuemax="8"><span style="width:${(count / 8) * 100}%"></span></div></div><nav class="practice-languages" aria-label="${t('practice.language')}"><button type="button" data-testid="practice-th" aria-pressed="${getLang() === 'th'}">TH</button><button type="button" data-testid="practice-en" aria-pressed="${getLang() === 'en'}">EN</button></nav>${button('exit', 'exit')}`;
    header.querySelector('[data-testid="practice-exit"]')?.addEventListener('click', requestExit);
    header
      .querySelector('[data-testid="practice-th"]')
      ?.addEventListener('click', () => setLang('th'));
    header
      .querySelector('[data-testid="practice-en"]')
      ?.addEventListener('click', () => setLang('en'));
    if (focused) header.querySelector<HTMLElement>(`[data-testid="${focused}"]`)?.focus();
    const previousHighlight = highlighted;
    clearHighlight();
    const allowed = session.allowedActions();
    const action = allowed[0];
    if (session.error) {
      show('error');
      return;
    }
    if (session.completed) {
      coach.hidden = true;
      show('complete');
      return;
    }
    coach.hidden = false;
    let lesson: string = action?.type === 'roll' ? 'roll' : session.topic;
    const state = session.controller.state;
    const warp =
      !action && outcome.find((event) => event.type === 'Teleported' && event.seat === 0);
    if (warp) lesson = 'warp';
    else if (
      !action &&
      state.board.spaces[state.players[0]!.pos]?.kind === 'chest' &&
      outcome.some((event) => event.type === 'GoldGained' && event.seat === 0)
    )
      lesson = 'chest';
    else if (!action) lesson = 'waiting';
    else if (action.type === 'battlePick' && state.phase.kind === 'battle') {
      lesson =
        state.phase.battle.context === 'town' && session.topic === 'town'
          ? 'town'
          : state.phase.battle.attackerSide === action.side
            ? `attack.${action.pick}`
            : `defence.${action.pick}`;
    } else if (action.type !== 'roll') lesson = `action.${action.type}`;
    const titleKey = `practice.guide.${lesson}.title`;
    const bodyKey = `practice.guide.${lesson}.body`;
    const control = action
      ? root.querySelector<HTMLElement>(actionSelector(action, session))
      : null;
    const title =
      t(titleKey) === titleKey ? (control?.textContent ?? t('practice.highlight')) : t(titleKey);
    const body = t(bodyKey) === bodyKey ? t('practice.highlight') : t(bodyKey);
    if (instructionKey !== lesson + getLang() + count) {
      instructionKey = lesson + getLang() + count;
      coach.innerHTML = `<div class="practice-coach-heading">${portrait('point', 116)}<span class="practice-eyebrow">${t('dicey.name')}</span></div><section class="practice-coach-card" id="practice-instruction"><span class="practice-step">${t('practice.lesson')} ${Math.min(count + 1, 8)} / 8</span><h1></h1><p class="practice-line"></p>${action ? `<div class="practice-hint"><span aria-hidden="true">←</span>${t('practice.highlight')}</div>` : ''}<p class="practice-note">${t(lesson === 'roll' && count === 0 ? 'practice.roll.note' : lesson.startsWith('defence.') ? 'practice.defence.note' : lesson.startsWith('attack.') ? 'practice.attack.note' : lesson === 'warp' ? 'practice.warp.note' : 'practice.safe')}</p></section><p class="practice-isolation">${t('practice.partner')}</p>`;
      coach.querySelector('h1')!.textContent = title;
      coach.querySelector('.practice-line')!.textContent = body;
    }
    if (action) {
      highlighted = root.querySelector<HTMLElement>(actionSelector(action, session)) ?? undefined;
      if (highlighted) {
        priorDescription = highlighted.getAttribute('aria-describedby');
        highlighted.classList.add('practice-highlight');
        highlighted.setAttribute('aria-describedby', 'practice-instruction');
        const phase = highlighted.closest('.game-dialog');
        if (
          !phase &&
          highlighted !== previousHighlight &&
          !highlighted.matches(':disabled') &&
          !header.contains(document.activeElement)
        )
          highlighted.focus();
        if (phase && !highlighted.matches(':disabled')) {
          highlighted.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
          if (!phase.contains(document.activeElement)) highlighted.focus();
        }
      }
    }
  };
  const offLang = onLangChange(() => update());
  const menuExit = (event: Event): void => {
    event.stopImmediatePropagation();
    requestExit();
  };
  const tipsClick = (event: Event): void => {
    if (
      event.target instanceof Element &&
      event.target.closest('[data-testid="menu-dicey-tips"], [data-testid="menu-dicey-reset"]')
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const tipControls = new Map<HTMLButtonElement, boolean>();
  const disableTips = (): void => {
    root
      .querySelectorAll<HTMLButtonElement>(
        '[data-testid="menu-dicey-tips"], [data-testid="menu-dicey-reset"]',
      )
      .forEach((control) => {
        if (!tipControls.has(control)) tipControls.set(control, control.disabled);
        if (!control.disabled) control.disabled = true;
      });
  };
  const menuObserver = new MutationObserver(disableTips);
  menuObserver.observe(root, { childList: true, subtree: true });
  disableTips();
  root.addEventListener('dice-bandits:menu-exit', menuExit, true);
  root.addEventListener('click', tipsClick, true);
  document.addEventListener('keydown', key);
  update();
  return {
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      close();
      clearHighlight();
      offLang();
      menuObserver.disconnect();
      for (const [control, disabled] of tipControls) control.disabled = disabled;
      tipControls.clear();
      root.removeEventListener('dice-bandits:menu-exit', menuExit, true);
      root.removeEventListener('click', tipsClick, true);
      document.removeEventListener('keydown', key);
      header.remove();
      coach.remove();
      root.classList.remove('practice-root');
      if (shell) shell.inert = initialInert;
    },
  };
}
