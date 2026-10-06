import {
  createTipQueue,
  loadTips,
  markSeen,
  onTipsChange,
  topicsFor,
  type TipInput,
  type TipTopic,
} from '../tutor/tips';
import { onLangChange, t } from '../i18n';
import atlas from '../../public/art/tutor/dicey.json';

const poses: Record<TipTopic, keyof typeof atlas.frames> = {
  roll: 'point',
  fork: 'point',
  duel: 'point',
  castle: 'happy',
  town: 'happy',
  shop: 'happy',
  chest: 'happy',
  levelUp: 'happy',
  townManage: 'happy',
  monster: 'surprised',
  event: 'surprised',
  trap: 'surprised',
  battle: 'surprised',
};

/** Text is ready immediately; the optional portrait never gates game flow. */
export function showDiceyTip(
  root: HTMLElement,
  topic: TipTopic,
  onDismiss: () => void,
): () => void {
  const tip = document.createElement('aside');
  tip.className = 'dicey-tip';
  tip.dataset.testid = 'dicey-tip';
  tip.dataset.topic = topic;
  tip.setAttribute('role', 'status');
  tip.setAttribute('aria-live', 'polite');
  tip.innerHTML =
    '<div class="dicey-portrait" aria-hidden="true" hidden></div><img class="dicey-art-loader" alt="" hidden><div class="dicey-bubble"><strong class="dicey-name"></strong><p class="dicey-text"></p><button type="button" class="dicey-ok" data-testid="dicey-tip-ok"></button></div>';
  const portrait = tip.querySelector<HTMLElement>('.dicey-portrait')!;
  const loader = tip.querySelector<HTMLImageElement>('.dicey-art-loader')!;
  const button = tip.querySelector<HTMLButtonElement>('.dicey-ok')!;
  const frame = atlas.frames[poses[topic]];
  const portraitSize = topic === 'roll' ? 40 : 64;
  const scale = portraitSize / frame.w;
  portrait.style.width = `${portraitSize}px`;
  portrait.style.height = `${frame.h * scale}px`;
  portrait.style.backgroundImage = 'url("/art/tutor/dicey.webp")';
  portrait.style.backgroundSize = `${900 * scale}px ${300 * scale}px`;
  portrait.style.backgroundPosition = `${-frame.x * scale}px ${-frame.y * scale}px`;
  let closed = false;
  const position = (): void => {
    if (closed || topic !== 'roll') return;
    const roll = root.querySelector<HTMLElement>('[data-testid="action-roll"]');
    const rect = roll?.getBoundingClientRect();
    const pointer = tip.querySelector('.dicey-pointer');
    if (!rect || !rect.width || !rect.height) {
      pointer?.remove();
      tip.classList.remove('dicey-anchored');
      return;
    }
    tip.classList.add('dicey-anchored');
    if (!pointer) {
      const triangle = document.createElement('span');
      triangle.className = 'dicey-pointer';
      triangle.setAttribute('aria-hidden', 'true');
      tip.append(triangle);
    }
    tip.style.setProperty('--dicey-cta-x', `${rect.left + rect.width / 2}px`);
    const tray = roll?.closest('.action-tray')?.getBoundingClientRect();
    tip.style.left = `${Math.max(8, (tray?.left ?? rect.left) - tip.getBoundingClientRect().width - 14)}px`;
    tip.style.bottom = `${Math.max(8, window.innerHeight - rect.bottom)}px`;
  };
  let frameId = 0;
  const refresh = (): void => {
    tip.setAttribute('aria-label', t('dicey.name'));
    tip.querySelector('.dicey-name')!.textContent = t('dicey.name');
    tip.querySelector('.dicey-text')!.textContent = t(`dicey.tip.${topic}`);
    button.textContent = t('dicey.ok');
    position();
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(position);
  };
  refresh();
  const unsubscribe = onLangChange(refresh);
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(position);
  resize?.observe(root);
  const mutations = new MutationObserver(position);
  mutations.observe(root, { childList: true, subtree: true });
  window.addEventListener('resize', position);
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    unsubscribe();
    resize?.disconnect();
    mutations.disconnect();
    window.removeEventListener('resize', position);
    cancelAnimationFrame(frameId);
    loader.onload = null;
    loader.onerror = null;
    tip.remove();
  };
  button.addEventListener('click', () => {
    cleanup();
    onDismiss();
  });
  loader.onload = () => {
    portrait.hidden = false;
  };
  loader.onerror = () => {
    portrait.hidden = true;
    console.warn('Dicey artwork unavailable; showing text-only tip.');
    loader.onerror = null;
  };
  // Dialog shades are siblings of the z-index:1 game shell. A child cannot
  // escape that stacking context, even with a higher local z-index.
  root.append(tip);
  position();
  loader.src = '/art/tutor/dicey.webp';
  return cleanup;
}

/** Owns view-only queue/lifecycle. No controller, action or transport references. */
export function createDiceyGuide(root: HTMLElement) {
  let queue = createTipQueue();
  let lastInput: TipInput | undefined;
  let visible: TipTopic | undefined;
  let removeTip: (() => void) | undefined;
  let destroyed = false;
  const dismiss = (): void => {
    removeTip?.();
    removeTip = undefined;
    if (visible) markSeen(visible);
    visible = undefined;
  };
  const showNext = (): void => {
    if (destroyed || visible) return;
    const topic = queue.next();
    if (!topic) return;
    visible = topic;
    removeTip = showDiceyTip(root, topic, () => {
      dismiss();
      showNext();
    });
  };
  const humanTurnFor = ({ next, isLocalHuman }: TipInput): string | null => {
    const actor = next.phase.kind === 'levelUp' ? next.phase.seat : next.turnSeat;
    const localBattle =
      next.phase.kind === 'battle' &&
      [next.phase.battle.a, next.phase.battle.b].some(
        (fighter) =>
          fighter.kind === 'player' && fighter.seat !== null && isLocalHuman(fighter.seat),
      );
    return isLocalHuman(actor) || localBattle ? `${next.round}:${next.turnSeat}` : null;
  };
  const enqueue = (input: TipInput): void => {
    queue.enqueue(topicsFor(input), humanTurnFor(input));
    showNext();
  };
  const onAction = (event: Event): void => {
    if (
      event.target instanceof Element &&
      event.target.closest('button[data-action-index], button[data-choice]')
    )
      dismiss();
  };
  root.addEventListener('click', onAction, true);
  const unsubscribe = onTipsChange((change) => {
    // Reset must not re-mark the old visible tip after clearing seen.
    if (change === 'reset') {
      removeTip?.();
      removeTip = undefined;
      visible = undefined;
      queue = createTipQueue();
    } else if (!loadTips().enabled) dismiss();
    if (lastInput) enqueue({ ...lastInput, events: [] });
  });
  return {
    update(input: TipInput): void {
      if (destroyed) return;
      // A status refresh can omit the landing events that produced the visible
      // tip. Only a new state or loss of eligibility invalidates that tip.
      if (
        lastInput &&
        (lastInput.next !== input.next || !loadTips().enabled || humanTurnFor(input) === null)
      )
        dismiss();
      lastInput = input;
      enqueue(input);
    },
    dismiss,
    destroy(): void {
      destroyed = true;
      dismiss();
      unsubscribe();
      root.removeEventListener('click', onAction, true);
    },
  };
}
