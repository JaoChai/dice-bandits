import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, step, type Action, type GameState } from '@dice-bandits/engine';
import { setLang, t } from '../../src/i18n';
import { renderHud } from '../../src/ui/hud';
import type { PracticeSession } from '../../src/tutor/practice';
import { TUTORIAL_SCRIPT } from '../../src/tutor/script';

let root: HTMLElement;
const cleanups: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('dice-bandits:intro-seen', '1');
  setLang('th');
  document.body.innerHTML = '<div id="app"></div>';
  root = document.querySelector('#app')!;
});

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
  localStorage.clear();
});

/** The real fork moment: replay entries 0..3 leave the learner choosing a branch. */
function forkState(): GameState {
  let state = createGame(TUTORIAL_SCRIPT.config);
  for (const entry of TUTORIAL_SCRIPT.replay.slice(0, 4)) state = step(state, entry.action).state;
  return state;
}

type Stub = PracticeSession & { dispatched: Action[]; allowedActions: () => Action[] };

function stubSession(state: GameState): Stub {
  const session = {
    controller: { state },
    topic: 'fork',
    completed: false,
    error: null,
    allowedActions: () => [{ type: 'chooseBranch', to: 34 }],
    dispatch: async (action: Action) => {
      session.dispatched.push(action);
      return true;
    },
    restart: () => undefined,
    destroy: () => undefined,
    dispatched: [] as Action[],
  };
  return session as unknown as Stub;
}

async function mountFork(): Promise<{
  view: { update(): void; destroy(): void };
  session: Stub;
}> {
  const { mountPracticeUi } = await import('../../src/ui/practiceUi');
  const state = forkState();
  renderHud(root, state, () => undefined);
  const session = stubSession(state);
  const view = mountPracticeUi(root, session);
  cleanups.push(view.destroy);
  view.update();
  return { view, session };
}

describe('practice muted controls', () => {
  it('marks every non-allowed action control while the human turn waits', async () => {
    await mountFork();
    const allowed = root.querySelector('[data-testid="action-chooseBranch-34"]');
    const other = root.querySelector('[data-testid="action-chooseBranch-11"]');
    expect(allowed).not.toBeNull();
    expect(other).not.toBeNull();
    expect(allowed!.classList.contains('practice-highlight')).toBe(true);
    expect(allowed!.getAttribute('aria-disabled')).toBeNull();
    expect(other!.classList.contains('practice-highlight')).toBe(false);
    expect(other!.classList.contains('practice-muted')).toBe(true);
    expect(other!.getAttribute('aria-disabled')).toBe('true');
    // Muting is per-control: the tray container must never carry it, or the
    // allowed button inherits aria-disabled from its ancestor.
    const tray = root.querySelector('[data-testid="action-tray"]');
    expect(tray).not.toBeNull();
    expect(tray!.classList.contains('practice-muted')).toBe(false);
    expect(tray!.getAttribute('aria-disabled')).toBeNull();
    expect(
      root.querySelector('[data-testid="practice-exit"]')!.classList.contains('practice-muted'),
    ).toBe(false);
  });

  it('nudges on a muted tap without moving focus or the lesson, then fades', async () => {
    const { session } = await mountFork();
    const focused = document.activeElement;
    const other = root.querySelector<HTMLElement>('[data-testid="action-chooseBranch-11"]')!;
    other.click();
    const nudge = root.querySelector('[data-testid="practice-nudge"]');
    expect(nudge).not.toBeNull();
    expect((nudge as HTMLElement).hidden).toBe(false);
    expect((nudge as HTMLElement).textContent).toBe(t('practice.nudge'));
    expect((nudge as HTMLElement).getAttribute('aria-live')).toBe('polite');
    expect(document.activeElement).toBe(focused);
    expect(session.dispatched).toEqual([]);
    expect(
      root
        .querySelector('[data-testid="action-chooseBranch-34"]')!
        .classList.contains('practice-highlight'),
    ).toBe(true);
    expect(
      (root.querySelector('[data-testid="practice-coach"] h1') as HTMLElement).textContent,
    ).toBe(t('practice.guide.action.chooseBranch.title'));
    vi.advanceTimersByTime(2500);
    expect((nudge as HTMLElement).hidden).toBe(true);
  });

  it('clears the muting as soon as the lesson moves on', async () => {
    const { view, session } = await mountFork();
    expect(root.querySelectorAll('.practice-muted').length).toBeGreaterThan(0);
    session.allowedActions = () => [];
    view.update();
    expect(root.querySelectorAll('.practice-muted')).toHaveLength(0);
    expect(
      root.querySelectorAll(
        '[data-testid^="action-"][aria-disabled="true"], [data-testid^="pick-"][aria-disabled="true"], [data-testid^="perk-"][aria-disabled="true"], [data-testid^="shop-"][aria-disabled="true"]',
      ),
    ).toHaveLength(0);
  });

  it('leaves zero practice muting behind on destroy', async () => {
    const { view } = await mountFork();
    expect(root.querySelectorAll('.practice-muted').length).toBeGreaterThan(0);
    view.destroy();
    expect(root.querySelectorAll('.practice-muted')).toHaveLength(0);
    expect(root.querySelectorAll('[aria-disabled="true"]')).toHaveLength(0);
  });

  it('never mutes anything outside practice', () => {
    renderHud(root, forkState(), () => undefined);
    expect(root.querySelectorAll('.practice-muted')).toHaveLength(0);
    expect(root.querySelectorAll('[aria-disabled="true"]')).toHaveLength(0);
  });
});
