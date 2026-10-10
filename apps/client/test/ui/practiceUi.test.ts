import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '@dice-bandits/engine';
import { setLang } from '../../src/i18n';
import { showSetup, showTitle } from '../../src/ui/screens';
import { openIntroComic } from '../../src/ui/introComic';
import { createPractice, type PracticeSession } from '../../src/tutor/practice';
import { TUTORIAL_SCRIPT } from '../../src/tutor/script';
import { renderHud } from '../../src/ui/hud';

let root: HTMLElement;
const sessions: PracticeSession[] = [];
const cleanups: Array<() => void> = [];
const click = (id: string): void => {
  const button = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  expect(button, id).not.toBeNull();
  button!.click();
};
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('dice-bandits:intro-seen', '1');
  setLang('en');
  document.body.innerHTML = '<div id="app"></div>';
  root = document.querySelector('#app')!;
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  sessions.splice(0).forEach((session) => session.destroy());
  document.querySelector<HTMLButtonElement>('[data-testid="intro-skip"]')?.click();
  vi.useRealTimers();
  localStorage.clear();
});

// Mutations caught: wiring practice to new/continue/online; offering on skip/replay;
// replacing real action buttons; cursor-based rather than milestone completion;
// missing modal focus/inert teardown; constructing a session for a broken route.
describe('practice entry and comic', () => {
  it('isolates practice from new, Continue and online callbacks', () => {
    const state = createGame(TUTORIAL_SCRIPT.config);
    const sentinel = ` ${JSON.stringify({ version: 2, state })}\n`;
    localStorage.setItem('diceBandits.save', sentinel);
    let practice = 0;
    let newGames = 0;
    let online = 0;
    let continued: unknown;
    root.addEventListener('dice-bandits:continue', (event) => {
      continued = (event as CustomEvent).detail;
    });
    showTitle(
      () => {
        newGames += 1;
      },
      {
        onPractice: () => {
          practice += 1;
        },
        create: () => {
          online += 1;
        },
      },
    );
    click('title-practice');
    expect(practice).toBe(1);
    expect(newGames).toBe(0);
    expect(online).toBe(0);
    root.querySelector<HTMLButtonElement>('[data-action="continue"]')!.click();
    expect(continued).toEqual(state);
    expect(localStorage.getItem('diceBandits.save')).toBe(sentinel);
    root.querySelector<HTMLButtonElement>('[data-action="new"]')!.click();
    click('online-create');
    expect([newGames, online, practice]).toEqual([1, 1, 1]);
  });

  // Catches setup Back dropping the owning title's practice/Continue context.
  it('keeps practice and Continue available after repeated New game/setup/Back navigation', () => {
    const state = createGame(TUTORIAL_SCRIPT.config);
    const sentinel = ` ${JSON.stringify({ version: 2, state })}\n`;
    localStorage.setItem('diceBandits.save', sentinel);
    let practices = 0;
    let games = 0;
    let continued: unknown;
    root.addEventListener('dice-bandits:continue', (event) => {
      continued = (event as CustomEvent).detail;
    });
    const title = (): void =>
      showTitle(setup, {
        onPractice: () => {
          practices += 1;
        },
      });
    const setup = (): void =>
      showSetup(() => {
        games += 1;
      }, title);
    title();
    for (let i = 0; i < 2; i++) {
      root.querySelector<HTMLButtonElement>('[data-action="new"]')!.click();
      expect(root.querySelector('[data-testid="screen-setup"]')).not.toBeNull();
      setLang(i === 0 ? 'th' : 'en');
      root.querySelector<HTMLButtonElement>(`[data-lang="${i === 0 ? 'th' : 'en'}"]`)!.click();
      root.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
      expect(root.querySelectorAll('[data-testid="title-practice"]')).toHaveLength(1);
      click('title-practice');
      root.querySelector<HTMLButtonElement>('[data-action="continue"]')!.click();
      expect(continued).toEqual(state);
      expect(localStorage.getItem('diceBandits.save')).toBe(sentinel);
    }
    expect([practices, games]).toEqual([2, 0]);
  });

  it('retains the legacy setup Back and New game contract without a title owner', () => {
    showSetup(() => undefined);
    root.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    expect(root.querySelector('[data-testid="screen-title"]')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-action="new"]')!.click();
    expect(root.querySelector('[data-testid="screen-setup"]')).not.toBeNull();
  });

  it('offers practice only for an unseen comic completed at its final panel', () => {
    localStorage.removeItem('dice-bandits:intro-seen');
    let offers = 0;
    const story = document.createElement('button');
    root.append(story);
    story.focus();
    openIntroComic({
      onClose: () => undefined,
      onPracticeOffer: () => {
        offers += 1;
      },
    });
    for (let i = 0; i < 3; i++) click('intro-next');
    click('intro-done');
    expect(offers).toBe(1);
    expect(document.activeElement).toBe(story);
    expect(localStorage.getItem('dice-bandits:intro-seen')).toBe('1');
    openIntroComic({
      onClose: () => undefined,
      onPracticeOffer: () => {
        offers += 1;
      },
    });
    for (let i = 0; i < 3; i++) click('intro-next');
    click('intro-done');
    expect(offers).toBe(1);
    localStorage.removeItem('dice-bandits:intro-seen');
    openIntroComic({
      onClose: () => undefined,
      onPracticeOffer: () => {
        offers += 1;
      },
    });
    click('intro-skip');
    expect(offers).toBe(1);
  });
});

describe('practice preparation', () => {
  it('shows loading, validates before begin, and invites without creating or saving a game', async () => {
    const { preparePractice } = await import('../../src/ui/practiceUi');
    let resolve!: (value: typeof TUTORIAL_SCRIPT) => void;
    let began = 0;
    const snapshot = { ...localStorage };
    const view = preparePractice(
      root,
      () => {
        began += 1;
      },
      () => undefined,
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    cleanups.push(view.destroy);
    expect(root.textContent).toContain('Preparing your practice');
    resolve(TUTORIAL_SCRIPT);
    await view.ready;
    expect(root.textContent).toContain('Practice with Dicey ~4 min');
    expect(root.querySelectorAll('.practice-topic')).toHaveLength(8);
    expect(began).toBe(0);
    click('practice-begin');
    expect(began).toBe(1);
    expect({ ...localStorage }).toEqual(snapshot);
  });

  it('offers retry/back for invalid routes, empty for no route, and ignores stale loads', async () => {
    const { preparePractice } = await import('../../src/ui/practiceUi');
    let began = 0;
    let backed = 0;
    let loads = 0;
    const broken = structuredClone(TUTORIAL_SCRIPT);
    broken.replay[0]!.action = { type: 'endTurn' };
    const snapshot = localStorage.getItem('diceBandits.save');
    const view = preparePractice(
      root,
      () => {
        began += 1;
      },
      () => {
        backed += 1;
      },
      async () => {
        loads += 1;
        return loads === 1 ? broken : null;
      },
    );
    cleanups.push(view.destroy);
    await view.ready;
    expect(root.textContent).toContain('Practice is unavailable');
    click('practice-retry');
    await view.ready;
    expect(root.textContent).toContain('No practice lessons yet');
    click('practice-back');
    expect([began, backed, loads]).toEqual([0, 1, 2]);
    expect(localStorage.getItem('diceBandits.save')).toBe(snapshot);
    let resolve!: (value: typeof TUTORIAL_SCRIPT) => void;
    const retired = preparePractice(
      root,
      () => {
        began += 1;
      },
      () => undefined,
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    retired.destroy();
    root.textContent = 'Title';
    resolve(TUTORIAL_SCRIPT);
    await retired.ready;
    expect(root.textContent).toBe('Title');
  });
});

describe('real practice UI', () => {
  it('highlights the existing roll once, updates languages, and restores exit focus', async () => {
    const { mountPracticeUi } = await import('../../src/ui/practiceUi');
    const session = createPractice(TUTORIAL_SCRIPT, () => undefined);
    sessions.push(session);
    renderHud(root, session.controller.state, () => undefined);
    const view = mountPracticeUi(root, session);
    cleanups.push(view.destroy);
    view.update();
    view.update();
    expect(document.querySelectorAll('[data-testid="practice-coach"]')).toHaveLength(1);
    expect(document.querySelector('[data-testid="dicey-tip"]')).toBeNull();
    const roll = root.querySelector('[data-testid="action-roll"]');
    expect(root.querySelector('.practice-highlight')).toBe(roll);
    expect(document.activeElement).toBe(roll);
    expect(root.textContent).toContain('Start with a roll');
    setLang('th');
    expect(root.textContent).toContain('เริ่มด้วยการทอย');
    (roll as HTMLElement).focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelector<HTMLElement>('.game-shell')!.inert).toBe(true);
    expect((document.activeElement as HTMLElement).dataset.testid).toBe('practice-stay');
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
    expect((document.activeElement as HTMLElement).dataset.testid).toBe('practice-leave');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelector<HTMLElement>('.game-shell')!.inert).toBe(false);
    expect(document.activeElement).toBe(roll);
    view.destroy();
    expect(root.classList.contains('practice-root')).toBe(false);
    expect(root.querySelector('.practice-highlight')).toBeNull();
  });

  it('routes the game menu exit through confirmation and prevents competing tips writes', async () => {
    const { mountPracticeUi } = await import('../../src/ui/practiceUi');
    const session = createPractice(TUTORIAL_SCRIPT, () => undefined);
    sessions.push(session);
    renderHud(root, session.controller.state, () => undefined);
    const view = mountPracticeUi(root, session);
    cleanups.push(view.destroy);
    let exited = 0;
    root.addEventListener('dice-bandits:menu-exit', () => {
      exited += 1;
    });
    root.dispatchEvent(new CustomEvent('dice-bandits:menu-exit', { bubbles: true }));
    expect(exited).toBe(0);
    expect(root.querySelector('[data-testid="practice-stay"]')).not.toBeNull();
    click('practice-stay');
    const menu = root.querySelector<HTMLButtonElement>('[data-testid="menu-button"]')!;
    expect(menu).not.toBeNull();
    menu.click();
    await Promise.resolve();
    const snapshot = { ...localStorage };
    click('menu-dicey-reset');
    click('menu-dicey-tips');
    expect({ ...localStorage }).toEqual(snapshot);
    view.destroy();
    expect(root.querySelector<HTMLButtonElement>('[data-testid="menu-dicey-tips"]')!.disabled).toBe(
      false,
    );
  });

  it('shows real warp, attack/defence legal controls, then completion with setup/replay events', async () => {
    const { mountPracticeUi } = await import('../../src/ui/practiceUi');
    const learned = new Set<string>();
    const session = createPractice(TUTORIAL_SCRIPT, (topic) => learned.add(topic), {
      present: async (events, state) => {
        renderHud(root, state, () => undefined);
        view.update(events);
        if (events.some((event) => event.type === 'Teleported' && event.seat === 0)) {
          expect(root.textContent).toContain('Warp to space 7');
          expect(root.querySelector('.practice-highlight')).toBeNull();
        }
        if (
          events.some((event) => event.type === 'GoldGained' && event.seat === 0) &&
          state.board.spaces[state.players[0]!.pos]?.kind === 'chest'
        ) {
          expect(root.textContent).toContain('Chest opened');
          expect(root.textContent).toContain('The chest gave you 74 gold.');
        }
      },
    });
    sessions.push(session);
    renderHud(root, session.controller.state, () => undefined);
    const view = mountPracticeUi(root, session, { learned: () => learned.size });
    cleanups.push(view.destroy);
    let sawAttack = false;
    let sawDefence = false;
    for (const entry of TUTORIAL_SCRIPT.replay.filter((entry) => entry.seat === 0)) {
      renderHud(root, session.controller.state, () => undefined);
      view.update();
      expect(
        root.querySelector('.practice-highlight'),
        `highlight for ${entry.action.type}`,
      ).not.toBeNull();
      if (session.controller.state.phase.kind === 'levelUp') {
        const choices = [...root.querySelectorAll<HTMLButtonElement>('.game-dialog button')];
        choices[0]!.focus();
        const tab = new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        document.dispatchEvent(tab);
        expect(tab.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(choices.at(-1));
      }
      if (
        session.controller.state.phase.kind === 'battle' &&
        session.controller.state.phase.battle.context === 'town' &&
        entry.action.type === 'battlePick' &&
        session.topic === 'town'
      ) {
        expect(root.textContent).toContain('Claim a town');
      }
      if (entry.action.type === 'battlePick') {
        if (!sawAttack) {
          expect(root.textContent).toContain('Use your secret');
          expect(root.querySelectorAll('[data-testid^="pick-"]')).toHaveLength(3);
          expect(root.querySelector('[data-testid="pick-defend"]')).toBeNull();
          expect(root.querySelector('.practice-highlight')?.getAttribute('data-testid')).toBe(
            'pick-secret',
          );
          sawAttack = true;
        }
        if (root.querySelector('[data-testid="pick-defend"]') && !sawDefence) {
          expect(root.textContent).toContain('Defend is a defence choice.');
          expect(root.querySelector('.practice-highlight')?.getAttribute('data-testid')).toBe(
            'pick-secret',
          );
          sawDefence = true;
        }
      }
      const pending = session.dispatch(entry.action);
      await vi.runAllTimersAsync();
      await pending;
      expect(session.error).toBeNull();
    }
    view.update();
    expect([sawAttack, sawDefence, learned.size]).toEqual([true, true, 8]);
    expect(root.textContent).toContain('Gold robbery complete!');
    expect(root.textContent).toContain('You robbed 15 gold');
    let setups = 0;
    let replays = 0;
    root.addEventListener('dice-bandits:practice-setup', () => {
      setups += 1;
      view.destroy();
      session.destroy();
      showSetup(
        () => undefined,
        () =>
          showTitle(() => undefined, {
            onPractice: () => {
              replays += 1;
            },
          }),
      );
    });
    root.addEventListener('dice-bandits:practice-replay', () => {
      replays += 1;
    });
    click('practice-replay');
    click('practice-setup');
    expect([setups, replays]).toEqual([1, 1]);
    expect(root.querySelector('[data-testid="screen-setup"]')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    expect(root.querySelectorAll('[data-testid="title-practice"]')).toHaveLength(1);
    click('title-practice');
    expect(replays).toBe(2);
  });
});
