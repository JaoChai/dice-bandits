import { createGame, step, type Action, type GameEvent } from '@dice-bandits/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../src/i18n';
beforeEach(() => setLang('th'));
import { createBattlePost } from '../src/ui/battlePost';
import { postResult } from '../src/ui/battlePostModel';
import { animatePostRewards } from '../src/ui/battlePostRewards';

const make = () =>
  createGame({
    seed: 'b1',
    rounds: 12,
    seats: [
      { name: 'Ada', classId: 'knight', control: 'human', personality: null },
      { name: 'Ben', classId: 'thief', control: 'human', personality: null },
    ],
  });
function reward(): {
  previous: import('@dice-bandits/engine').GameState;
  next: import('@dice-bandits/engine').GameState;
  events: GameEvent[];
} {
  let previous = make();
  previous.phase = { kind: 'duelOffer', remaining: 1, targets: [1] };
  previous = step(previous, { type: 'duel', target: 1 }).state;
  const next = structuredClone(previous);
  next.players[0]!.gold += 32;
  next.players[0]!.xp = 20;
  next.players[0]!.level = 2;
  next.phase = { kind: 'levelUp', seat: 0, choices: ['hpUp', 'atkUp', 'looter'], then: 'endTurn' };
  return {
    previous,
    next,
    events: [
      { type: 'BattleEnded', seat: 0, params: { result: 'aWin' } },
      { type: 'GoldGained', seat: 0, params: { amount: 32 } },
      { type: 'XpGained', seat: 0, params: { amount: 20 } },
      { type: 'LevelUp', seat: 0, params: { level: 2 } },
    ] satisfies GameEvent[],
  };
}

describe('B1 reward sequence', () => {
  afterEach(() => vi.useRealTimers());
  it('shows the actual capped level without inventing a next XP threshold', () => {
    const { previous, next, events } = reward();
    previous.players[0]!.level = 15;
    next.players[0]!.level = 15;
    const root = document.createElement('div');
    const finish = animatePostRewards(root, postResult(previous, next, events)!, 0);
    expect(root.querySelector('.post-xp-amount')?.textContent).toBe('Lv. 15');
    expect(root.querySelector<HTMLElement>('.post-xp-track')?.hidden).toBe(true);
    finish();
  });

  it('uses the old level, gold and actual next XP threshold', () => {
    const input = reward();
    expect(postResult(input.previous, input.next, input.events)).toMatchObject({
      fromGold: 300,
      toGold: 332,
      fromLevel: 1,
      level: 2,
      xpGoal: 10,
      nextXpGoal: 11,
    });
  });
  it('pops a viewport banner and counts gold from old total while XP fills then resets', async () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const view = createBattlePost(root);
    const play = view.play({ ...reward(), mode: 'human', viewer: 0, speed: 1, reduced: false });
    expect(root.querySelector('.battle-post')?.getAttribute('data-beat')).toBe('victory');
    expect(root.querySelector('.post-title')?.classList.contains('post-victory-banner')).toBe(true);
    expect(root.querySelectorAll('.post-confetti')).toHaveLength(12);
    await vi.advanceTimersByTimeAsync(680);
    expect(root.querySelector('[data-testid="post-gold-total"]')?.textContent).toBe('300');
    expect(root.querySelector('.post-xp-track > span')?.getAttribute('style')).toContain(
      'scaleX(0)',
    );
    expect(root.querySelectorAll('.post-reward-coin')).toHaveLength(7);
    await vi.advanceTimersByTimeAsync(450);
    const gold = Number(root.querySelector('[data-testid="post-gold-total"]')?.textContent);
    expect(gold).toBeGreaterThan(300);
    expect(gold).toBeLessThan(332);
    expect(root.querySelector('.post-xp')?.getAttribute('data-xp-stage')).toBe('flash');
    await vi.advanceTimersByTimeAsync(450);
    expect(await play).toBe(true);
    expect(root.querySelector('[data-testid="post-gold-total"]')?.textContent).toBe('332');
    expect(root.querySelector('.post-xp-amount')?.textContent).toContain('Lv. 2');
    expect(root.querySelector('.post-xp-amount')?.textContent).toBe('LV UP · Lv. 2');
    expect(root.querySelector('.post-xp-track')?.getAttribute('aria-valuenow')).toBe('1');
    expect(root.querySelector('.post-xp-track')?.getAttribute('aria-valuemax')).toBe('1');
    expect(root.querySelector('.post-xp')?.textContent).toContain('LV UP');
    view.destroy();
  });
});

describe('B1 bag and ownership', () => {
  function bag() {
    const state = make();
    state.phase = { kind: 'pvpReward', winner: 0, loser: 1 };
    state.players[1]!.items = ['steelSword', 'potion'];
    state.players[1]!.weapon = 'steelSword';
    return state;
  }
  it('puts four categories in 2x2 including one expandable prank card', () => {
    const root = document.createElement('div');
    const view = createBattlePost(root);
    view.mountChoices(bag(), { viewer: 0, dispatch() {}, reduced: true });
    const grid = root.querySelector<HTMLElement>('.post-choice-panel > .post-cards')!;
    expect(grid.children).toHaveLength(4);
    expect(grid.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    expect(root.querySelectorAll('[data-testid="post-prank-expand"]')).toHaveLength(1);
    expect(root.querySelector('[data-equipped="true"]')?.textContent).toContain('สวมอยู่');
    (root.querySelector('[data-testid="post-prank-expand"]') as HTMLButtonElement).click();
    expect(root.querySelectorAll('[data-post-choice="prank"]')).toHaveLength(12);
    view.destroy();
  });
  it('renders loser cards as grey noninteractive content and the authoritative taken card', async () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const view = createBattlePost(root);
    view.mountChoices(bag(), {
      viewer: 1,
      dispatch() {
        throw new Error('loser dispatch');
      },
      reduced: false,
    });
    expect(root.querySelector('.battle-post')?.classList.contains('post-readonly')).toBe(true);
    expect(
      root.querySelector('.post-choice-panel button, .post-choice-panel summary, [data-choice]'),
    ).toBeNull();
    expect(root.querySelector('[data-testid="post-waiting"]')?.textContent).toBe('รอ Ada เลือก…');
    expect(root.querySelector('.post-title')?.textContent).toBe('รอ Ada เลือก…');
    expect(root.querySelector('.post-title')?.classList.contains('post-waiting-banner')).toBe(true);
    expect(root.querySelectorAll('[data-testid="post-waiting"]')).toHaveLength(1);
    const finish = view.finish(
      [{ type: 'ItemLooted', seat: 0, params: { item: 'steelSword' } }],
      false,
      'online',
    );
    expect(
      root
        .querySelector('[data-testid="post-loot-steelSword"]')
        ?.classList.contains('post-selected'),
    ).toBe(true);
    expect(root.querySelector('[data-testid="post-loot-steelSword"]')?.textContent).toContain(
      'Ada เอา',
    );
    expect(root.querySelector('[data-testid="post-loot-steelSword"]')?.textContent).toContain('ไป');
    await vi.advanceTimersByTimeAsync(600);
    await finish;
    expect(root.querySelector('.battle-post')).toBeNull();
    vi.useRealTimers();
  });
  it('recovers a detached overlay in the current language without reopening a submitted choice', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const sent: Action[] = [];
    const view = createBattlePost(root);
    const options = { viewer: 0, dispatch: (action: Action) => sent.push(action), reduced: true };
    const state = bag();
    view.mountChoices(state, options);
    root.querySelector('.battle-post')!.remove();
    view.mountChoices(state, options);
    expect(root.querySelector('.battle-post')?.isConnected).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-testid="post-loot-steelSword"]')!.click();
    setLang('en');
    view.mountChoices(state, options);
    expect(root.querySelector('.post-title')?.textContent).toBe('Take one reward');
    expect(root.querySelectorAll('[data-post-choice]:not(:disabled)')).toHaveLength(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    root.querySelector('.battle-post')!.remove();
    setLang('th');
    view.mountChoices(state, options);
    expect(root.querySelectorAll('[data-post-choice]:not(:disabled)')).toHaveLength(0);
    expect(sent).toHaveLength(1);
    view.destroy();
    root.remove();
  });

  it('invalidates a stale hot-seat callback after another owner mounts', () => {
    const root = document.createElement('div');
    const view = createBattlePost(root);
    const sent: Action[] = [];
    view.mountChoices(bag(), { viewer: 0, dispatch: (a) => sent.push(a), reduced: true });
    const stale = root.querySelector<HTMLButtonElement>('[data-testid="post-loot-steelSword"]')!;
    view.mountChoices(bag(), { viewer: 1, dispatch: (a) => sent.push(a), reduced: true });
    stale.click();
    expect(sent).toEqual([]);
    view.destroy();
  });
  it('a new authoritative legal list cancels a pending online selection', async () => {
    const root = document.createElement('div');
    const view = createBattlePost(root);
    const sent: Action[] = [];
    let complete!: () => void;
    vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(
      () =>
        ({
          finished: new Promise<void>((r) => {
            complete = r;
          }),
          cancel() {},
        }) as unknown as Animation,
    );
    view.mountChoices(bag(), { viewer: 0, dispatch: (a) => sent.push(a), reduced: false });
    root.querySelector<HTMLButtonElement>('[data-testid="post-loot-steelSword"]')!.click();
    view.mountChoices(bag(), {
      viewer: 0,
      dispatch: (a) => sent.push(a),
      reduced: false,
      legal: [],
    });
    complete();
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual([]);
    view.destroy();
    vi.restoreAllMocks();
  });
});
