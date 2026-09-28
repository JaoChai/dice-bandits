import { createGame, type GameConfig } from '@dice-bandits/engine';
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

describe('renderHud', () => {
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
