import {
  createGame,
  legalActions,
  step,
  type GameConfig,
  type GameState,
} from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import { setLang, t } from '../src/i18n';
import { renderHud } from '../src/ui/hud';

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
    const stats = root.querySelector('.seat-card span[title]');

    expect(stats?.textContent).toContain(`${t('board.levelShort')}${state.players[0]!.level}`);
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
