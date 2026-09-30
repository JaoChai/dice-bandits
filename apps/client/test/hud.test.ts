import {
  createGame,
  legalActions,
  step,
  type GameConfig,
  type GameState,
} from '@dice-bandits/engine';
import { describe, expect, it, vi } from 'vitest';
import { getLang, setLang, t } from '../src/i18n';
import { renderHud } from '../src/ui/hud';
import { renderEventToast } from '../src/ui/dialogs';

const config: GameConfig = {
  seed: 'hud-test',
  rounds: 12,
  seats: [
    { name: 'Human', classId: 'knight', control: 'human', personality: null },
    { name: 'Bot', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
};

function pvpBattleWithSeatZeroPicking(): GameState {
  let state = createGame({
    seed: 'hud-pvp-seat-zero',
    rounds: 12,
    seats: [0, 1].map((seat) => ({
      name: `Human ${seat}`,
      classId: seat === 0 ? 'knight' : 'thief',
      control: 'human' as const,
      personality: null,
    })),
  });
  state.phase = { kind: 'duelOffer', remaining: 1, targets: [1] };
  state.turnSeat = 0;
  state = step(state, { type: 'duel', target: 1 }).state;
  if (state.phase.kind !== 'battle') throw new Error('expected PvP battle');

  const firstPicker = state.players.find((player) =>
    legalActions(state, player.seat).some((action) => action.type === 'battlePick'),
  );
  if (!firstPicker) throw new Error('expected first PvP picker');
  const firstPick = legalActions(state, firstPicker.seat).find(
    (action) => action.type === 'battlePick',
  );
  if (!firstPick) throw new Error('expected legal battle pick');
  state = step(state, firstPick).state;
  const nextPicker = state.players.find((player) =>
    legalActions(state, player.seat).some((action) => action.type === 'battlePick'),
  );
  if (nextPicker?.seat !== 0) throw new Error('expected seat 0 to pick second');
  return state;
}

describe('renderHud', () => {
  it('positions each seat card in its seat-order corner with readable labeled stats', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame({
      ...config,
      seats: [0, 1, 2, 3].map((seat) => ({
        name: `Player ${seat}`,
        classId: ['knight', 'thief', 'mage', 'cleric'][seat]! as
          'knight' | 'thief' | 'mage' | 'cleric',
        control: 'human' as const,
        personality: null,
      })),
    });
    renderHud(root, state, () => undefined);

    expect(
      [...root.querySelectorAll('.seat-card')].map((card) =>
        ['corner-tl', 'corner-tr', 'corner-bl', 'corner-br'].find((corner) =>
          card.classList.contains(corner),
        ),
      ),
    ).toEqual(['corner-tl', 'corner-tr', 'corner-bl', 'corner-br']);
    const stats = root.querySelectorAll('.seat-card .seat-stats span');
    expect(stats.length).toBeGreaterThanOrEqual(12);
    expect([...stats].every((span) => Number(span.getAttribute('aria-label')?.length) > 0)).toBe(
      true,
    );
    root.remove();
  });

  it('wraps action buttons in the centered action tray', () => {
    const root = document.createElement('div');
    document.body.append(root);
    renderHud(root, createGame(config), () => undefined);

    expect(root.querySelector('[data-testid="action-tray"] .action-button')).not.toBeNull();
    expect(root.querySelector('.action-bar')).not.toBeNull();
    root.remove();
  });

  it('keeps full event text in the banner and expands it on tap', () => {
    const root = document.createElement('div');
    document.body.append(root);
    renderHud(root, createGame(config), () => undefined);
    const banner = root.querySelector<HTMLElement>('[data-testid="event-banner"]')!;
    renderEventToast(root, [{ type: 'FrenzyStarted', seat: null, params: {} }]);

    expect(banner.querySelector('.event-text')?.textContent).toBe(t('event.FrenzyStarted'));
    expect(banner.getAttribute('title')).toBe(t('event.FrenzyStarted'));
    expect(banner.textContent).not.toContain('…');
    banner.click();
    expect(banner.classList.contains('expanded')).toBe(true);
    root.remove();
  });

  it('toggles the event banner once per keyboard press across HUD rerenders', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    const dispatch = () => undefined;
    renderHud(root, state, dispatch);
    const banner = root.querySelector<HTMLElement>('[data-testid="event-banner"]')!;
    const press = (key: string) =>
      banner.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

    press('Enter');
    expect(banner.classList.contains('expanded')).toBe(true);
    press(' ');
    expect(banner.classList.contains('expanded')).toBe(false);
    for (let render = 0; render < 4; render += 1) renderHud(root, state, dispatch);
    expect(root.querySelector('[data-testid="event-banner"]')).toBe(banner);
    press('Enter');
    expect(banner.classList.contains('expanded')).toBe(true);
    press(' ');
    expect(banner.classList.contains('expanded')).toBe(false);
    root.remove();
  });

  it('shows the frenzy notice in the event banner rather than canvas decoration', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    state.round = 10;
    renderHud(root, state, () => undefined);

    expect(root.querySelector('[data-testid="event-banner"]')?.textContent).toContain(
      t('event.FrenzyStarted'),
    );
    root.remove();
  });

  it('switches in-game action labels when the language control is used', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    setLang('en');
    renderHud(root, state, () => undefined);

    expect(root.querySelector('[data-testid="action-roll"]')?.textContent).toBe('Roll');
    root.querySelector<HTMLButtonElement>('[data-lang="th"]')?.click();
    expect(root.querySelector('[data-testid="action-roll"]')?.textContent).toBe('ทอยเต๋า');
    expect(root.querySelector('[data-lang="en"]')?.getAttribute('aria-pressed')).toBe('false');
    root.remove();
    setLang('en');
  });

  it('binds the language toggle once across repeated HUD renders', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    const dispatch = vi.fn();
    setLang('th');
    for (let render = 0; render < 5; render += 1) renderHud(root, state, dispatch);
    const nav = root.querySelector('.game-topline nav')!;
    const setAttribute = vi.spyOn(nav, 'setAttribute');

    root.querySelector<HTMLButtonElement>('[data-lang="en"]')!.click();

    expect(getLang()).toBe('en');
    expect(setAttribute).toHaveBeenCalledTimes(1);
    root.remove();
  });

  it('uses the latest state when a language toggle rerenders the HUD', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const initialState = createGame(config);
    const latestState = createGame(config);
    latestState.round = 7;
    setLang('th');
    renderHud(root, initialState, () => undefined);
    renderHud(root, latestState, () => undefined);
    const nav = root.querySelector('.game-topline nav')!;
    const setAttribute = vi.spyOn(nav, 'setAttribute');
    root.querySelector<HTMLButtonElement>('[data-lang="en"]')!.click();

    expect(root.querySelector('.round-label')?.textContent).toBe(
      t('board.round', { round: latestState.round, total: latestState.config.rounds }),
    );
    expect(setAttribute).toHaveBeenCalledTimes(1);
    root.remove();
  });

  it('uses localized language labels in the toggle', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    renderHud(root, state, () => undefined);

    expect(root.querySelector('[data-lang="th"]')?.textContent).toBe(t('lang.th'));
    expect(root.querySelector('[data-lang="en"]')?.textContent).toBe(t('lang.en'));
    root.remove();
  });

  it('shows the pass screen and hides picks when seat 0 is the next human PvP picker', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = pvpBattleWithSeatZeroPicking();

    renderHud(root, state, () => undefined);

    expect(root.querySelector('[data-testid="pass-ready"]')).not.toBeNull();
    expect(root.querySelectorAll('[data-testid^="pick-"]')).toHaveLength(0);
    root.remove();
  });

  it('renders and dispatches battle-item actions for the human battle picker', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = pvpBattleWithSeatZeroPicking();
    state.players[0]!.items.push('potion');
    const expectedAction = legalActions(state, 0).find(
      (action) => action.type === 'useItem' && action.item === 'potion',
    );
    if (!expectedAction) throw new Error('expected battle-item use action after adding potion');
    const dispatched: (typeof expectedAction)[] = [];

    renderHud(root, state, (action) => {
      if (action.type === 'useItem') dispatched.push(action);
    });

    expect(root.querySelector('[data-testid="pass-ready"]')).not.toBeNull();
    expect(root.querySelector('[data-testid^="action-useItem-potion"]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-testid="pass-ready"]')?.click();
    const itemButton = root.querySelector<HTMLButtonElement>(
      '[data-testid^="action-useItem-potion"]',
    );
    expect(itemButton).not.toBeNull();
    itemButton?.click();
    expect(dispatched).toEqual([expectedAction]);
    root.remove();
  });

  it('localizes the compact level label in Thai', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    setLang('th');
    renderHud(root, state, () => undefined);
    const stats = root.querySelector('.seat-card .seat-stats span:nth-child(2)');

    expect(stats?.textContent).toContain(`${t('board.levelShort')} ${state.players[0]!.level}`);
    root.remove();
    setLang('en');
  });

  it('keeps the mounted Phaser board canvas connected across state updates', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    renderHud(root, state, () => undefined);
    const canvas = document.createElement('canvas');
    root.querySelector('#phaser-board')!.append(canvas);

    renderHud(root, state, () => undefined);

    expect(root.querySelector('#phaser-board canvas')).toBe(canvas);
    expect(canvas.isConnected).toBe(true);
    root.remove();
  });

  it('renders bandit-card status as a compact chip with an accessible full label', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    state.players[0]!.banditCards = ['cursedLegs'];
    renderHud(root, state, () => undefined);
    const status = root.querySelector<HTMLElement>('.seat-status');
    expect(status?.textContent).toBe('1 🃏');
    expect(status?.getAttribute('aria-label')).toBeTruthy();
    expect(status?.getAttribute('title')).toBe(status?.getAttribute('aria-label'));
    root.remove();
  });

  it('includes target id in targeted item action test ids', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    state.players[0]!.items = ['mapScroll'];
    renderHud(root, state, () => undefined);
    const ids = [...root.querySelectorAll<HTMLButtonElement>('.action-button')].map(
      (button) => button.dataset.testid,
    );
    expect(ids).toContain('action-useItem-mapScroll-1');
    root.remove();
  });
});
