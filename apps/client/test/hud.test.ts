import {
  createGame,
  legalActions,
  step,
  type GameConfig,
  type GameState,
} from '@dice-bandits/engine';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('bounded inventory chooser', () => {
  // Breaks caught: mirrored target actions, lossy action mapping, stale modal/inert state.
  it('collapses legal items, closes without dispatch, and dispatches each original choice once', () => {
    const state = createGame(config);
    state.players[0]!.items = ['dash', 'warp', 'trapCard', 'smokeBomb', 'luckyCoin', 'mapScroll'];
    const actions = legalActions(state, 0);
    const items = actions.filter((action) => action.type === 'useItem');
    const root = document.createElement('div');
    document.body.append(root);
    const sent: unknown[] = [];
    const render = (busy = false) =>
      renderHud(root, state, (action) => sent.push(action), {
        presentationBusy: busy,
      });
    render();
    const tray = root.querySelector<HTMLElement>('.action-tray')!;
    expect(tray.querySelectorAll('button')).toHaveLength(2);
    expect(tray.querySelectorAll('[data-action-index]')).toHaveLength(1);
    const open = () =>
      root.querySelector<HTMLButtonElement>('[data-testid="action-items"]')!.click();
    const snapshot = JSON.stringify(state);
    open();
    expect(tray.hasAttribute('inert')).toBe(true);
    expect(root.querySelectorAll('.item-dialog [data-choice]')).toHaveLength(items.length);
    expect(root.querySelector('.item-dialog')?.getAttribute('aria-label')).toBeTruthy();
    root.querySelector<HTMLButtonElement>('[data-testid="item-close"]')!.click();
    expect(sent).toEqual([]);
    expect(tray.hasAttribute('inert')).toBe(false);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('action-items');
    for (let i = 0; i < items.length; i++) {
      open();
      root.querySelector<HTMLButtonElement>(`.item-dialog [data-choice="${i}"]`)!.click();
      expect(sent).toEqual(items.slice(0, i + 1));
      expect(root.querySelector('.item-dialog')).toBeNull();
      expect(tray.hasAttribute('inert')).toBe(false);
    }
    open();
    render(true);
    expect(root.querySelector('.item-dialog')).toBeNull();
    expect(tray.hasAttribute('inert')).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('[data-testid="action-items"]')!.disabled).toBe(
      true,
    );
    expect(JSON.stringify(state)).toBe(snapshot);
    root.remove();
  });
});

describe('single modal choice surface', () => {
  // Breaks caught: mirrored choices, blank remote/bot modals, busy dispatch,
  // stale hidden tray after a modal and Leave scrolling out of reach.
  it.each(['shop', 'levelUp', 'pvpReward'] as const)(
    'owns the only %s choices for local and eligible online seats',
    (kind) => {
      const state = createGame(config);
      state.phase =
        kind === 'shop'
          ? { kind, stock: ['potion'] }
          : kind === 'levelUp'
            ? { kind, seat: 0, choices: ['quickFeet'], then: 'endTurn' }
            : { kind, winner: 0, loser: 1 };
      const actions = legalActions(state, 0);
      expect(actions.length).toBeGreaterThan(0);
      for (const online of [false, true]) {
        const root = document.createElement('div');
        const sent: unknown[] = [];
        const options = online
          ? {
              legal: actions,
              online: {
                you: 0,
                seats: [],
                opponentPicked: false,
                socketStatus: 'open' as const,
                awaitingView: false,
                reclaim: () => {},
              },
            }
          : undefined;
        renderHud(root, state, (action) => sent.push(action), options);
        renderHud(root, state, (action) => sent.push(action), options);
        const tray = root.querySelector<HTMLElement>('.action-tray')!;
        expect(tray.hidden).toBe(true);
        expect(tray.hasAttribute('inert')).toBe(true);
        expect(tray.querySelectorAll('button')).toHaveLength(0);
        expect(root.querySelectorAll('[role="dialog"]')).toHaveLength(1);
        expect(root.querySelectorAll('[data-choice]')).toHaveLength(actions.length);
        if (kind === 'shop') {
          expect(root.querySelector('.phase-choices [data-testid="shop-leave-leave"]')).toBeNull();
          expect(
            root.querySelector('.phase-dialog > [data-testid="shop-leave-leave"]'),
          ).not.toBeNull();
        }
        renderHud(root, state, (action) => sent.push(action), {
          ...options,
          presentationBusy: true,
        });
        for (const button of root.querySelectorAll<HTMLButtonElement>('[data-choice]')) {
          expect(button.disabled).toBe(true);
          button.click();
        }
        expect(sent).toEqual([]);
        state.phase = { kind: 'townManage', spaceId: state.towns[0]!.spaceId };
        state.towns[0]!.owner = 0;
        renderHud(root, state, (action) => sent.push(action));
        expect(root.querySelector('.dialog-shade')).toBeNull();
        expect(tray.hidden).toBe(false);
        expect(tray.hasAttribute('inert')).toBe(false);
        expect(tray.querySelector('[data-testid="action-leave"]')).not.toBeNull();
        // Restore the modal fixture for the other mode.
        state.phase =
          kind === 'shop'
            ? { kind, stock: ['potion'] }
            : kind === 'levelUp'
              ? { kind, seat: 0, choices: ['quickFeet'], then: 'endTurn' }
              : { kind, winner: 0, loser: 1 };
      }
    },
  );
  it('does not mount blank bot/remote dialogs or fresh choices during an awaiting view', () => {
    const state = createGame(config);
    state.phase = { kind: 'shop', stock: ['potion'] };
    const root = document.createElement('div');
    state.players[0]!.control = 'bot';
    renderHud(root, state, () => {});
    expect(root.querySelector('.dialog-shade')).toBeNull();
    state.players[0]!.control = 'human';
    for (const awaitingView of [false, true]) {
      renderHud(root, state, () => {}, {
        legal: [],
        online: {
          you: 1,
          seats: [],
          opponentPicked: false,
          socketStatus: 'open',
          awaitingView,
          reclaim: () => {},
        },
      });
      expect(root.querySelector('.dialog-shade')).toBeNull();
    }
    renderHud(root, state, () => {}, { presentationBusy: true });
    expect(root.querySelector('.dialog-shade')).toBeNull();
    expect(root.querySelectorAll('[data-choice]:enabled')).toHaveLength(0);
  });
});

describe('compact board HUD', () => {
  it('keeps exactly one copy of every status and control inside one top bar', () => {
    const root = document.createElement('div');
    const state = createGame(config);
    renderHud(root, state, () => undefined);
    renderHud(root, state, () => undefined);
    expect(root.querySelectorAll('.game-topline')).toHaveLength(1);
    for (const id of [
      'round-ribbon',
      'turn-ribbon',
      'event-banner',
      'world-chip',
      'map-toggle',
      'audio-toggle',
      'menu-button',
    ]) {
      expect(root.querySelectorAll(`[data-testid="${id}"]`), id).toHaveLength(1);
      expect(root.querySelector(`.game-topline [data-testid="${id}"]`), id).not.toBeNull();
    }
  });

  it('opens each ordered summary without dispatching and shows all former player fields', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    state.players[0]!.prank = { alias: '<Alias>', untilRound: 2 };
    state.players[0]!.hp = 7;
    state.players[0]!.banditCards = ['cursedLegs'];
    state.players[1]!.banditCards = [];
    const dispatch = vi.fn();
    renderHud(root, state, dispatch);
    const summaries = [...root.querySelectorAll<HTMLButtonElement>('[data-seat-open]')];
    expect(summaries).toHaveLength(2);
    expect(summaries.map((button) => button.dataset.seatOpen)).toEqual(['0', '1']);
    for (const button of summaries) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    }
    summaries[0]!.click();
    const panel = root.querySelector('[data-testid="seat-detail-panel"]')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.textContent).toContain('<Alias>');
    expect(panel.querySelector('alias')).toBeNull();
    expect(panel.textContent).toContain(t('class.knight'));
    expect(panel.textContent).toContain(t('board.level'));
    expect(panel.textContent).toContain(t('board.towns'));
    expect(panel.textContent).toContain(t('card.cursedLegs'));
    expect(panel.textContent).toContain(`7/${state.players[0]!.stats.maxHp}`);
    expect(panel.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('7');
    root.querySelector<HTMLButtonElement>('[data-testid="seat-detail-close"]')!.click();
    summaries[1]!.click();
    expect(root.querySelector('[data-testid="seat-cards-1"]')?.textContent).toContain('0');
    expect(root.querySelector('[data-testid="seat-detail-panel"]')?.textContent).toContain(
      t('setup.bot'),
    );
    root.querySelector<HTMLButtonElement>('[data-testid="seat-detail-close"]')!.click();
    expect(dispatch).not.toHaveBeenCalled();
    root.remove();
  });

  it('traps detail focus and restores it on Escape and close across rerenders', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    renderHud(root, state, () => undefined);
    const open = () => root.querySelector<HTMLButtonElement>('[data-seat-open="0"]')!.click();
    open();
    const close = root.querySelector<HTMLButtonElement>('[data-testid="seat-detail-close"]')!;
    expect(document.activeElement).toBe(close);
    close.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(close);
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelector('[data-testid="seat-detail-panel"]')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('[data-seat-open="0"]'));
    open();
    renderHud(root, state, () => undefined);
    expect(root.querySelector('[data-testid="seat-detail-panel"]')).toBeNull();
    open();
    root.querySelector<HTMLButtonElement>('[data-testid="seat-detail-close"]')!.click();
    expect(document.activeElement).toBe(root.querySelector('[data-seat-open="0"]'));
    root.remove();
  });

  it('keeps online takeover explicit and offers reclaim only for the owning seat', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    const reclaim = vi.fn();
    const dispatch = vi.fn();
    renderHud(root, state, dispatch, {
      legal: [],
      online: {
        you: 0,
        seats: state.players.map((player) => ({
          seat: player.seat,
          name: player.name,
          classId: player.classId,
          kind: 'human',
          controller: 'botTakeover',
          connected: false,
        })),
        opponentPicked: false,
        socketStatus: 'open',
        awaitingView: false,
        reclaim,
      },
    });
    expect(
      root.querySelector('[data-seat-open="0"] [data-testid="seat-takeover-0"]')?.textContent,
    ).toBe(t('setup.bot'));
    expect(root.querySelector('[data-seat-open="0"]')?.getAttribute('aria-label')).toContain(
      t('online.takeover'),
    );
    root.querySelector<HTMLButtonElement>('[data-seat-open="1"]')!.click();
    expect(root.querySelector('[data-testid="seat-detail-panel"]')?.textContent).toContain(
      t('online.takeover'),
    );
    expect(root.querySelector('[data-testid="seat-detail-reclaim"]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-testid="seat-detail-close"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-seat-open="0"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-testid="seat-detail-reclaim"]')!.click();
    expect(reclaim).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('[data-testid="seat-detail-close"]')!.click();
    root.remove();
  });
});

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
    for (const player of state.players) {
      root.querySelector<HTMLButtonElement>(`[data-seat-open="${player.seat}"]`)!.click();
      const panel = root.querySelector('[data-testid="seat-detail-panel"]')!;
      expect(panel.textContent).toContain(`${t('board.level')} ${player.level}`);
      expect(panel.textContent).toContain(`0 ${t('board.towns')}`);
      expect(panel.querySelector('[aria-label]')).not.toBeNull();
      root.querySelector<HTMLButtonElement>('[data-testid="seat-detail-close"]')!.click();
    }
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
    // Language buttons live inside the board menu (spec §9): open it first.
    root.querySelector<HTMLButtonElement>('[data-testid="menu-button"]')!.click();
    root.querySelector<HTMLButtonElement>('.menu-panel [data-lang="th"]')!.click();
    expect(root.querySelector('[data-testid="action-roll"]')?.textContent).toBe('ทอยเต๋า');
    // The panel stays open across a language switch (in-place refresh); the
    // microtask-free refresh means the re-render's attributes are already final.
    root.querySelector<HTMLButtonElement>('.menu-panel [data-lang="en"]')?.click();
    // After switching to English the panel reflects it: en selected, th not.
    expect(root.querySelector('.menu-panel [data-lang="en"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(root.querySelector('.menu-panel [data-lang="th"]')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
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
    root.querySelector<HTMLButtonElement>('[data-testid="menu-button"]')!.click();
    // Five renders re-armed the menu five times; one click must apply exactly
    // one switch and refresh the open panel in place (same element, new labels).
    const panelBefore = root.querySelector('.menu-panel')!;
    root.querySelector<HTMLButtonElement>('.menu-panel [data-lang="en"]')!.click();
    expect(getLang()).toBe('en');
    expect(root.querySelector('.menu-panel')).toBe(panelBefore);
    expect(root.querySelectorAll('[data-testid="menu-button"]')).toHaveLength(1);
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
    root.querySelector<HTMLButtonElement>('[data-testid="menu-button"]')!.click();
    root.querySelector<HTMLButtonElement>('.menu-panel [data-lang="en"]')!.click();

    expect(root.querySelector('[data-testid="round-ribbon"]')?.textContent).toBe(
      t('board.round', { round: latestState.round, total: latestState.config.rounds }),
    );
    root.remove();
  });

  it('uses localized language labels in the toggle', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    renderHud(root, state, () => undefined);
    // The toggle lives inside the board menu (spec §9): open it first.
    root.querySelector<HTMLButtonElement>('[data-testid="menu-button"]')!.click();

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
    root.querySelector<HTMLButtonElement>('[data-seat-open="0"]')!.click();
    const stats = root.querySelector('[data-testid="seat-detail-panel"]');

    expect(stats?.textContent).toContain(`${t('board.level')} ${state.players[0]!.level}`);
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
    root.querySelector<HTMLButtonElement>('[data-seat-open="0"]')!.click();
    const status = root.querySelector<HTMLElement>('.seat-status');
    expect(status?.textContent).toBe('1 🃏');
    expect(status?.getAttribute('aria-label')).toBeTruthy();
    expect(status?.getAttribute('title')).toBe(status?.getAttribute('aria-label'));
    root.remove();
  });

  it('shows the card count on every seat even when a player holds no cards (spec §9)', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    state.players[0]!.banditCards = [];
    renderHud(root, state, () => undefined);
    const counts = state.players.map((player) => {
      root.querySelector<HTMLButtonElement>(`[data-seat-open="${player.seat}"]`)!.click();
      const text = root.querySelector<HTMLElement>(
        `[data-testid="seat-cards-${player.seat}"]`,
      )?.textContent;
      root.querySelector<HTMLButtonElement>('[data-testid="seat-detail-close"]')!.click();
      return text;
    });
    expect(counts).toHaveLength(state.players.length);
    expect(counts).toContain('0 🃏');
    root.remove();
  });

  it('includes target id in targeted item action test ids', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    state.players[0]!.items = ['mapScroll'];
    renderHud(root, state, () => undefined);
    root.querySelector<HTMLButtonElement>('[data-testid="action-items"]')!.click();
    const ids = [...root.querySelectorAll<HTMLButtonElement>('.item-dialog .action-button')].map(
      (button) => button.dataset.testid,
    );
    expect(ids).toContain('action-useItem-mapScroll-1');
    root.remove();
  });
});

describe('cartoon HUD (Task 9)', () => {
  const fourSeats = {
    ...config,
    seats: [0, 1, 2, 3].map((seat) => ({
      name: `Player ${seat}`,
      classId: ['knight', 'thief', 'mage', 'cleric'][seat]! as
        'knight' | 'thief' | 'mage' | 'cleric',
      control: 'human' as const,
      personality: null,
    })),
  };

  it('shows the same field set on every corner card (portrait, gold, HP, level, towns, card count)', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(fourSeats);
    state.players.forEach((player) => {
      player.banditCards = ['cursedLegs'];
    });
    renderHud(root, state, () => undefined);

    const cards = [...root.querySelectorAll<HTMLElement>('.seat-card')];
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.querySelector('.seat-portrait'), 'portrait').not.toBeNull();
      expect(card.textContent).toContain(t('board.gold'));
      card.querySelector<HTMLButtonElement>('[data-seat-open]')!.click();
      const panel = root.querySelector('[data-testid="seat-detail-panel"]')!;
      expect(panel.textContent).toContain(t('board.gold'));
      expect(panel.textContent).toContain(t('board.level'));
      expect(panel.textContent).toContain(t('board.towns'));
      expect(panel.querySelector('.hp-track'), 'HP track').not.toBeNull();
      expect(panel.querySelector('.seat-status')?.textContent).toContain('1 🃏');
      root.querySelector<HTMLButtonElement>('[data-testid="seat-detail-close"]')!.click();
    }
    root.remove();
  });

  it('marks the active seat card with is-active', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    renderHud(root, state, () => undefined);
    const activeCards = root.querySelectorAll<HTMLElement>('.seat-card.is-active');
    expect(activeCards).toHaveLength(1);
    expect(activeCards[0]!.classList.contains('corner-tl')).toBe(true);
    expect(root.querySelectorAll('.seat-card.active')).toHaveLength(0);
    root.remove();
  });

  it('styles the .is-active glow (spec §7 active-turn indicator)', () => {
    // CSS never applies in the vitest DOM (styleSheets stays empty), so this
    // is a stylesheet assertion like spaceInfoShade.test.ts.
    const css = readFileSync(join(import.meta.dirname, '../src/ui/styles.css'), 'utf8');
    const active = css.match(/\.seat-card\.is-active\s*\{[^}]*\}/)?.[0] ?? '';
    expect(active, '.seat-card.is-active must have a glow rule').not.toBe('');
    const hasGlow =
      /outline[^:]*:\s*(?!none)/.test(active.replace(/outline-offset[^;]+;/g, '')) ||
      /box-shadow:\s*(?!none)/.test(active);
    expect(hasGlow, `is-active rule must glow, got: ${active}`).toBe(true);
  });

  it('delivers menu-exit to the app mount exactly once per exit click', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    renderHud(root, state, () => undefined);
    const exits: number[] = [];
    root.addEventListener('dice-bandits:menu-exit', () => exits.push(1));
    root.querySelector<HTMLButtonElement>('[data-testid="menu-button"]')!.click();
    root.querySelector<HTMLButtonElement>('.menu-panel [data-action="exit"]')!.click();
    expect(exits, 'one exit click must fire dice-bandits:menu-exit exactly once').toHaveLength(1);
    root.remove();
  });

  it('renders the round ribbon text "Round 3/12" in English and "รอบ 3/12" in Thai', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    state.round = 3;
    setLang('en');
    renderHud(root, state, () => undefined);
    const ribbon = root.querySelector<HTMLElement>('[data-testid="round-ribbon"]')!;
    expect(ribbon.textContent).toBe('Round 3/12');
    setLang('th');
    renderHud(root, state, () => undefined);
    expect(root.querySelector<HTMLElement>('[data-testid="round-ribbon"]')!.textContent).toBe(
      'รอบ 3/12',
    );
    root.remove();
    setLang('en');
  });

  it('renders the turn ribbon as "<name>\'s turn" (spec §7)', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    setLang('en');
    renderHud(root, state, () => undefined);
    const turnName = state.players[state.turnSeat]!.name;
    const ribbon = root.querySelector<HTMLElement>('[data-testid="turn-ribbon"]')!;
    expect(ribbon.textContent).toBe(t('turn.ribbon', { name: turnName }));
    setLang('th');
    renderHud(root, state, () => undefined);
    expect(root.querySelector<HTMLElement>('[data-testid="turn-ribbon"]')!.textContent).toBe(
      t('turn.ribbon', { name: turnName }),
    );
    root.remove();
    setLang('en');
  });

  it('shows the round and world-rule chip visibly on the board (spec §9)', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    renderHud(root, state, () => undefined);
    const ribbon = root.querySelector<HTMLElement>('[data-testid="round-ribbon"]')!;
    expect(ribbon.textContent).toContain(t('board.round', { round: state.round, total: 12 }));
    const chip = root.querySelector<HTMLButtonElement>('[data-testid="world-chip"]')!;
    expect(chip.textContent).toBe(t(`worldRule.${state.worldRule}`));
    root.remove();
  });

  it('opens the world-rule info popup from the chip and closes it on Escape', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = createGame(config);
    renderHud(root, state, () => undefined);
    const chip = root.querySelector<HTMLElement>('[data-testid="world-chip"]')!;
    expect(document.querySelector('[data-testid="world-info"]')).toBeNull();
    chip.click();
    const popup = document.querySelector<HTMLElement>('[data-testid="world-info"]');
    expect(popup).not.toBeNull();
    expect(popup!.textContent).toContain(t(`worldRule.${state.worldRule}`));
    expect(popup!.textContent).toContain(t(`worldRule.${state.worldRule}.info`));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('[data-testid="world-info"]')).toBeNull();
    root.remove();
  });
});
