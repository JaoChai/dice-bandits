import type { Action, GameEvent, GameState } from '@dice-bandits/engine';
import { animatePostRewards } from './battlePostRewards';
import { iconStyle } from './artFrames';
import { getLang, t } from '../i18n';
import {
  postChoices,
  postResult,
  postText,
  type PostChoice,
  type PostResult,
} from './battlePostModel';

export type PostScene = {
  postVictory: (result: PostResult, duration: number) => void;
  postRewards: (result: PostResult, duration: number) => void;
  postChoice: (levelUp: boolean, reduced: boolean) => void;
  settlePostEffects: () => void;
};
export type PostChoiceOptions = {
  viewer: number;
  dispatch: (action: Action) => void;
  reduced: boolean;
  disabled?: boolean;
  legal?: Action[];
};
export type PostPlayOptions = {
  previous: GameState;
  next: GameState;
  events: GameEvent[];
  mode: 'human' | 'bot' | 'online';
  speed: number;
  reduced: boolean;
  viewer: number;
  scene?: PostScene;
};
const escape = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const icon = (name: PostChoice['icon']): string =>
  `<span class="post-icon" style="${iconStyle(name)}" aria-hidden="true"></span>`;

/** Owns cancellable cosmetics and DOM, never engine state or bot decisions. */
export function createBattlePost(root: HTMLElement) {
  let overlay: HTMLElement | undefined;
  let scene: PostScene | undefined;
  let active = false;
  let revision = 0;
  let signature = '';
  let actionSignature = '';
  let selectedAction: Action | undefined;
  let choiceActor = '';
  let skipped = false;
  let settle: (() => void) | undefined;
  let result: PostResult | null = null;
  const ensure = (): HTMLElement => {
    if (!overlay) {
      overlay = document.createElement('section');
      overlay.className = 'battle-post';
      overlay.dataset.testid = 'battle-post';
      overlay.setAttribute('aria-label', postText('reward'));
      overlay.innerHTML = `<header class="post-heading"><span class="post-kicker"></span><h1 class="post-title"></h1><p class="post-subtitle" role="status" aria-live="polite"></p></header><div class="post-rewards" hidden></div><div class="post-choice-panel" hidden></div><button type="button" class="post-skip" hidden>${postText('skip')}</button>`;
      overlay.addEventListener('pointerdown', () => settle?.());
      overlay.addEventListener('keydown', (event) => {
        if (settle && ['Enter', ' ', 'Escape'].includes(event.key)) {
          event.preventDefault();
          settle();
        }
      });
    }
    const parent = root.querySelector('.game-shell') ?? root;
    if (overlay.parentElement !== parent) parent.append(overlay);
    overlay.setAttribute('aria-label', postText('reward'));
    overlay.querySelector('.post-skip')!.textContent = postText('skip');
    active = true;
    root.querySelector('.game-shell')?.classList.add('post-active');
    return overlay;
  };
  const emit = (type: string, detail: unknown): void => {
    root.dispatchEvent(new CustomEvent(`dice-bandits:post-${type}`, { detail, bubbles: true }));
  };
  const waitBeat = async (
    kind: string,
    duration: number,
    mode: string,
    final: () => void,
  ): Promise<void> => {
    const node = ensure();
    node.dataset.beat = kind;
    const start = performance.now();
    const skip = node.querySelector<HTMLButtonElement>('.post-skip')!;
    skip.hidden = duration <= 0;
    if (duration > 0) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => done(false), duration);
        const done = (skipped: boolean): void => {
          if (settle !== finish) return;
          window.clearTimeout(timer);
          settle = undefined;
          final();
          emit('beat', { kind, mode, duration: performance.now() - start, skipped });
          resolve();
        };
        const finish = (): void => {
          skipped = true;
          done(true);
        };
        settle = finish;
      });
    } else {
      final();
      emit('beat', { kind, mode, duration: performance.now() - start, skipped: false });
    }
    skip.hidden = true;
  };
  const destroy = (): void => {
    revision++;
    settle?.();
    scene?.settlePostEffects();
    overlay
      ?.querySelectorAll('*')
      .forEach((node) => node.getAnimations?.().forEach((animation) => animation.cancel()));
    overlay?.remove();
    overlay = undefined;
    active = false;
    signature = '';
    actionSignature = '';
    selectedAction = undefined;
    result = null;
    scene = undefined;
    root.querySelector('.game-shell')?.classList.remove('post-active');
  };
  const mountChoices = (state: GameState, options: PostChoiceOptions): void => {
    const choices = postChoices(state);
    if (!choices.length) return;
    const key = JSON.stringify([
      state.phase,
      choices.map((choice) => choice.action),
      options.viewer,
      options.disabled,
      options.legal,
    ]);
    const localizedKey = JSON.stringify([key, getLang(), choices]);
    if (localizedKey === signature && root.contains(overlay ?? null)) return;
    signature = localizedKey;
    // Only authoritative ownership/legal changes invalidate a pending pick.
    // Locale refresh or reattachment must neither cancel nor reopen it.
    if (key !== actionSignature) {
      actionSignature = key;
      selectedAction = undefined;
      revision++;
    }
    const token = revision;
    const node = ensure();
    node.querySelector('.post-title')!.classList.remove('post-victory-banner');
    node.querySelectorAll('.post-confetti').forEach((item) => item.remove());
    node.dataset.beat = 'choice';
    node.classList.toggle('post-static', options.reduced);
    const level = state.phase.kind === 'levelUp';
    // Preserve the existing tutorial's reward-action lookup without changing
    // its coaching, replay, or UI. This is still the in-scene card surface.
    node.classList.toggle('reward-dialog', !level);
    const actor =
      state.phase.kind === 'levelUp'
        ? state.phase.seat
        : state.phase.kind === 'pvpReward'
          ? state.phase.winner
          : -1;
    choiceActor = state.players[actor]!.name;
    const owner = options.viewer === actor && state.players[actor]?.control === 'human';
    node.classList.toggle('post-readonly', !owner);
    node.querySelector('.post-kicker')!.textContent = level
      ? `${postText('level')} · ${state.players[actor]!.level}`
      : `${postText('bag')} ${state.phase.kind === 'pvpReward' ? state.players[state.phase.loser]!.name : ''}`;
    const heading = node.querySelector<HTMLElement>('.post-title')!;
    heading.textContent = owner
      ? level
        ? postText('perks')
        : postText('loot')
      : `${postText('waitPrefix')}${choiceActor}${postText('waitSuffix')}`;
    heading.classList.toggle('post-waiting-banner', !owner);
    if (!owner) heading.dataset.testid = 'post-waiting';
    else delete heading.dataset.testid;
    const status = node.querySelector<HTMLElement>('.post-subtitle')!;
    status.hidden = !owner;
    if (owner) status.dataset.testid = 'post-waiting';
    else delete status.dataset.testid;
    status.textContent = level ? postText('choose') : `${choiceActor} · ${postText('loot')}`;
    const panel = node.querySelector<HTMLElement>('.post-choice-panel')!;
    panel.hidden = false;
    panel.classList.toggle('is-levelup', level);
    panel.replaceChildren();
    scene?.postChoice(level, options.reduced);
    const grid = document.createElement('div');
    grid.className = 'post-cards';
    panel.append(grid);
    const select = async (choice: PostChoice, card: HTMLElement): Promise<void> => {
      if (
        token !== revision ||
        selectedAction !== undefined ||
        !owner ||
        options.disabled ||
        (card as HTMLButtonElement).disabled
      )
        return;
      selectedAction = choice.action;
      panel.querySelectorAll<HTMLButtonElement>('button').forEach((item) => {
        item.disabled = true;
      });
      card.classList.add('post-selected');
      status.textContent = `${postText('taken')} · ${choice.name}`;
      if (!options.reduced && card.animate) {
        const animation = card.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(.94)' }, { transform: 'scale(1)' }],
          { duration: 260 },
        );
        await animation.finished.catch(() => {});
      }
      if (token !== revision) return;
      emit('action', { action: choice.action, viewer: options.viewer, at: performance.now() });
      options.dispatch(choice.action);
    };
    const cardFor = (choice: PostChoice): HTMLElement => {
      const card = document.createElement(owner ? 'button' : 'div');
      card.className = 'post-card';
      if (!owner) card.setAttribute('aria-disabled', 'true');
      card.dataset.postChoice = choice.group;
      card.dataset.equipped = String(choice.equipped);
      card.dataset.action = JSON.stringify(choice.action);
      card.dataset.testid =
        choice.action.type === 'pickPerk'
          ? `perk-${choice.action.perk}`
          : choice.action.type === 'pvpReward'
            ? `post-${choice.action.reward}-${choice.action.item ?? choice.action.townId ?? choice.action.alias ?? 'gold'}`
            : '';
      card.innerHTML = `${icon(choice.icon)}<strong>${escape(choice.name)}</strong><span class="post-card-detail${choice.equipped ? ' post-equipped' : ''}">${escape(choice.detail)}</span>`;
      if (card instanceof HTMLButtonElement) {
        card.type = 'button';
        card.dataset.choice = String(choices.indexOf(choice));
        card.disabled =
          selectedAction !== undefined ||
          options.disabled === true ||
          (options.legal !== undefined &&
            !options.legal.some(
              (action) => JSON.stringify(action) === JSON.stringify(choice.action),
            ));
        card.addEventListener('click', () => {
          void select(choice, card);
        });
      }
      return card;
    };
    const normal = choices.filter((choice) => choice.group !== 'prank');
    const pranks = choices.filter((choice) => choice.group === 'prank');
    const arrange = (count: number) => {
      grid.classList.toggle('post-pager', count > 6);
      grid.style.gridTemplateColumns = `repeat(${count === 4 ? 2 : count === 6 ? 3 : Math.min(count, 6)}, minmax(0, 1fr))`;
    };
    const showBag = () => {
      grid.replaceChildren(...normal.map(cardFor));
      if (pranks.length) {
        const card = document.createElement(owner ? 'button' : 'div');
        card.className = 'post-card post-prank-category';
        if (!owner) card.setAttribute('aria-disabled', 'true');
        card.innerHTML = `${icon('skull')}<strong>${postText('browse')}</strong><span class="post-card-detail">${postText('prank')}</span>`;
        if (card instanceof HTMLButtonElement) {
          card.type = 'button';
          card.dataset.testid = 'post-prank-expand';
          card.disabled = selectedAction !== undefined || options.disabled === true;
          card.addEventListener('click', () => {
            if (token !== revision || selectedAction !== undefined) return;
            grid.replaceChildren(...pranks.map(cardFor));
            arrange(pranks.length);
            const back = document.createElement('button');
            back.className = 'post-bag-back';
            back.textContent = postText('backBag');
            back.addEventListener('click', () => {
              back.remove();
              showBag();
            });
            panel.prepend(back);
          });
        } else {
          // Semantic read-only aliases; no summary, tabindex or event handlers.
          const aliases = document.createElement('span');
          aliases.className = 'post-alias-list';
          aliases.append(...pranks.map(cardFor));
          card.append(aliases);
        }
        grid.append(card);
      }
      arrange(grid.children.length);
    };
    showBag();
    if (selectedAction) {
      const selected = choices.find(
        (choice) => JSON.stringify(choice.action) === JSON.stringify(selectedAction),
      );
      const card = Array.from(grid.querySelectorAll<HTMLElement>('[data-action]')).find(
        (item) => item.dataset.action === JSON.stringify(selectedAction),
      );
      (card ?? grid.querySelector('.post-prank-category'))?.classList.add('post-selected');
      if (selected) status.textContent = `${postText('taken')} · ${selected.name}`;
    }
    if (owner)
      grid
        .querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus({ preventScroll: true });
  };
  return {
    get active(): boolean {
      return active;
    },
    mountChoices,
    destroy,
    async play(options: PostPlayOptions): Promise<boolean> {
      const nextResult = postResult(options.previous, options.next, options.events);
      if (!nextResult) return false;
      destroy();
      skipped = false;
      result = nextResult;
      scene = options.scene;
      const token = revision;
      const node = ensure();
      node.classList.toggle('post-static', options.reduced);
      const winnerIsPlayer = result.seat !== null;
      const title = !result.winner
        ? postText('draw')
        : winnerIsPlayer && (options.viewer === result.seat || options.mode === 'bot')
          ? postText('win')
          : postText('lose');
      node.querySelector('.post-kicker')!.textContent = postText('reward');
      const heading = node.querySelector<HTMLElement>('.post-title')!;
      heading.textContent = title;
      heading.classList.add('post-victory-banner');
      for (let index = 0; index < 12 && !options.reduced && options.speed > 0; index++) {
        const star = document.createElement('span');
        star.className = 'post-icon post-confetti';
        star.setAttribute('aria-hidden', 'true');
        star.style.cssText = `${iconStyle('star')};--star-x:${Math.cos((index * Math.PI) / 6) * 40}vw;--star-y:${Math.sin((index * Math.PI) / 6) * 30}vh;--star-delay:${(index % 3) * 30}ms`;
        node.append(star);
      }
      node.querySelector('.post-subtitle')!.textContent = result.winner
        ? `${result.winnerName} · ${postText('win')}`
        : postText('draw');
      const scale = options.reduced ? 0 : Math.max(0, Math.min(1, options.speed));
      const victoryMs =
        (options.mode === 'human' ? 680 : options.mode === 'online' ? 80 : 120) * scale;
      scene?.postVictory(result, victoryMs);
      await waitBeat('victory', victoryMs, options.mode, () => scene?.settlePostEffects());
      if (token !== revision) return false;
      if (result.gold || result.xp) {
        const rewards = node.querySelector<HTMLElement>('.post-rewards')!;
        rewards.hidden = false;
        const duration = skipped ? 0 : (options.mode === 'human' ? 900 : 300) * scale;
        const finishRewards = animatePostRewards(rewards, result, duration);
        scene?.postRewards(result, duration);
        await waitBeat('reward', duration, options.mode, () => {
          finishRewards();
          scene?.settlePostEffects();
        });
      }
      if (token !== revision) return false;
      return result.pending;
    },
    async finish(
      events: GameEvent[],
      reduced: boolean,
      mode: 'human' | 'bot' | 'online',
    ): Promise<void> {
      if (!active) return;
      revision++;
      settle?.();
      const token = revision;
      const event = events.find((item) =>
        ['ItemLooted', 'GoldStolen', 'TownFlipped', 'PerkChosen', 'Pranked'].includes(item.type),
      );
      if (event && overlay) {
        const cards = Array.from(overlay.querySelectorAll<HTMLElement>('[data-action]'));
        const card = cards.find((item) => {
          const action = JSON.parse(item.dataset.action!) as Action;
          return action.type === 'pickPerk'
            ? action.perk === event.params.perk
            : action.type === 'pvpReward' &&
                (event.type === 'ItemLooted'
                  ? action.item === event.params.item
                  : event.type === 'GoldStolen'
                    ? action.reward === 'rob'
                    : event.type === 'TownFlipped'
                      ? action.townId === event.params.spaceId
                      : event.type === 'Pranked' && action.alias === event.params.alias);
        });
        const label =
          card?.querySelector('strong')?.textContent ??
          (event.params.item
            ? t(`item.${event.params.item}`)
            : event.params.perk
              ? t(`perk.${event.params.perk}`)
              : event.params.alias
                ? t(String(event.params.alias))
                : String(event.params.amount ?? event.params.spaceId ?? ''));
        const receipt = `${result?.winnerName || choiceActor}${postText('takePrefix')}${label}${postText('takeSuffix')}`;
        const target = card ?? overlay.querySelector('.post-prank-category');
        target?.classList.add('post-selected');
        const taken = document.createElement('span');
        taken.className = 'post-taken';
        taken.textContent = receipt;
        target?.append(taken);
        overlay.querySelector('.post-subtitle')!.textContent = receipt;
        if (overlay.classList.contains('post-readonly')) {
          overlay.querySelector('.post-title')!.textContent = receipt;
          overlay.querySelector('.post-title')!.classList.remove('post-waiting-banner');
        }
      }
      await waitBeat(
        'receipt',
        reduced ? 0 : mode === 'human' ? 280 : mode === 'online' ? 180 : 120,
        mode,
        () => {},
      );
      if (token === revision) destroy();
    },
  };
}
