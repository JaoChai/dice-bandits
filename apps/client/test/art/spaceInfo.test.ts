import { createGame, type GameState } from '@dice-bandits/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { setLang, t } from '../../src/i18n';
import { openSpaceInfo } from '../../src/ui/spaceInfo';

function gameFor(seed: string): GameState {
  return createGame({
    seed,
    rounds: 12,
    seats: [
      { name: 'P1', classId: 'knight', control: 'human', personality: null },
      { name: 'P2', classId: 'thief', control: 'bot', personality: 'greedy' },
      { name: 'P3', classId: 'mage', control: 'bot', personality: 'vengeful' },
      { name: 'P4', classId: 'cleric', control: 'bot', personality: 'cowardly' },
    ],
  });
}

function popup(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-testid="space-info"]')!;
}

afterEach(() => {
  setLang('en');
  popup()?.remove();
  document.querySelector('.space-info-shade')?.remove();
});

describe('openSpaceInfo', () => {
  it('shows name and one-line info for every space kind in EN and TH', () => {
    const state = gameFor('space-info-kinds');
    const kinds = ['castle', 'town', 'shop', 'chest', 'monster', 'event', 'trap'] as const;
    for (const kind of kinds) {
      const space = state.board.spaces.find((candidate) => candidate.kind === kind)!;
      for (const lang of ['en', 'th'] as const) {
        setLang(lang);
        popup()?.remove();
        openSpaceInfo(document.body, state, space.id);
        const node = popup();
        expect(node, `${kind} popup in ${lang}`).not.toBeNull();
        expect(node.textContent).toContain(t(`space.${kind}.name`));
        expect(node.textContent).toContain(t(`space.${kind}.info`));
      }
    }
    setLang('en');
  });

  it('shows owner seat number and value for an owned town', () => {
    const state = gameFor('space-info-town');
    const townSpaceId = state.towns[0]!.spaceId;
    state.towns[0]!.owner = 2;
    state.towns[0]!.value = 260;
    openSpaceInfo(document.body, state, townSpaceId);
    const text = popup().textContent ?? '';
    expect(text).toContain('3'); // seat 2 displayed 1-based
    expect(text).toContain('260');
  });

  it('closes on Escape', () => {
    const state = gameFor('space-info-esc');
    openSpaceInfo(document.body, state, state.board.spaces[0]!.id);
    expect(popup()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popup()).toBeNull();
  });

  it('closes on an outside tap', () => {
    const state = gameFor('space-info-outside');
    document.body.innerHTML = '<div id="outside">board</div>';
    openSpaceInfo(document.body, state, state.board.spaces[0]!.id);
    expect(popup()).not.toBeNull();
    // The shade sits above the board; clicking it (outside the popup card) closes.
    document.querySelector<HTMLElement>('.space-info-shade')!.click();
    expect(popup()).toBeNull();
  });

  it('replaces an already open popup instead of stacking', () => {
    const state = gameFor('space-info-reopen');
    openSpaceInfo(document.body, state, state.board.spaces[0]!.id);
    openSpaceInfo(document.body, state, state.board.spaces[1]!.id);
    expect(document.querySelectorAll('[data-testid="space-info"]')).toHaveLength(1);
  });
});
