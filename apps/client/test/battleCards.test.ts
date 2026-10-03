import { createGame, type Action, type GameState } from '@dice-bandits/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLang, t } from '../src/i18n';
import { renderBattleUi } from '../src/ui/battleUi';

/**
 * Task 8 RED: cartoon command cards. Every battle card renders an icon AND a
 * label translated from the `battle.card.*` i18n keys (not the board action
 * words), while keeping the existing `data-testid`s and dispatch behaviour.
 */

function battleState(): GameState {
  const state = createGame({
    seed: 'battle-ui',
    rounds: 12,
    seats: [
      { name: 'Hero', classId: 'knight', control: 'human', personality: null },
      { name: 'Rival', classId: 'thief', control: 'human', personality: null },
    ],
  });
  const a = state.players[0]!;
  const b = state.players[1]!;
  state.phase = {
    kind: 'battle',
    battle: {
      context: 'pvp',
      spaceId: a.pos,
      a: {
        kind: 'player',
        seat: 0,
        monsterId: null,
        level: a.level,
        hp: 38,
        stats: a.stats,
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
      b: {
        kind: 'player',
        seat: 1,
        monsterId: null,
        level: b.level,
        hp: 12,
        stats: b.stats,
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
      exchange: 1,
      half: 1,
      attackerSide: 'a',
      pending: { attack: null, defense: null },
    },
  };
  return state;
}

const actions: Action[] = [
  { type: 'battlePick', side: 'a', pick: 'attack' },
  { type: 'battlePick', side: 'a', pick: 'strike' },
  { type: 'battlePick', side: 'a', pick: 'secret' },
  { type: 'battlePick', side: 'b', pick: 'defend' },
  { type: 'battlePick', side: 'b', pick: 'counter' },
  { type: 'useItem', item: 'potion', target: null },
];

const picks = actions.filter(
  (action): action is Extract<Action, { type: 'battlePick' }> => action.type === 'battlePick',
);

function render(state = battleState()) {
  const root = document.createElement('div');
  root.innerHTML =
    '<section class="game-shell"><header class="game-topline"><button data-action="exit">Back to title</button></header><nav class="action-bar"></nav></section>';
  const dispatch = vi.fn();
  renderBattleUi(root, state, actions, 0, dispatch, (action) =>
    action.type === 'battlePick' ? t(`battle.card.${action.pick}`) : t('action.item'),
    true,
    true,
  );
  return { root, dispatch };
}

afterEach(() => setLang('en'));

describe('cartoon battle command cards (Task 8)', () => {
  it('labels the attack card from battle.card.attack in English and Thai', () => {
    const { root } = render();
    const card = root.querySelector<HTMLButtonElement>('[data-testid="pick-attack"]')!;
    expect(card.querySelector('.card-label')?.textContent).toBe('Attack');
    setLang('th');
    const rerendered = render();
    expect(
      rerendered.root.querySelector<HTMLButtonElement>('[data-testid="pick-attack"]')!.textContent,
    ).toContain('โจมตี');
  });

  it('labels the strike card from battle.card.strike', () => {
    const { root } = render();
    expect(root.querySelector('[data-testid="pick-strike"] .card-label')?.textContent).toBe(
      t('battle.card.strike'),
    );
  });

  it('labels the secret card from battle.card.secret', () => {
    const { root } = render();
    expect(root.querySelector('[data-testid="pick-secret"] .card-label')?.textContent).toBe(
      t('battle.card.secret'),
    );
  });

  it('labels the defend and counter cards from their battle.card keys', () => {
    const { root } = render();
    expect(root.querySelector('[data-testid="pick-defend"] .card-label')?.textContent).toBe(
      t('battle.card.defend'),
    );
    expect(root.querySelector('[data-testid="pick-counter"] .card-label')?.textContent).toBe(
      t('battle.card.counter'),
    );
  });

  it('renders icon and label on every command card with retained test ids', () => {
    const { root, dispatch } = render();
    for (const [index, action] of picks.entries()) {
      const card = root.querySelector<HTMLButtonElement>(`[data-testid="pick-${action.pick}"]`);
      expect(card, `card for ${action.pick}`).not.toBeNull();
      expect(card!.querySelector('.card-icon')).not.toBeNull();
      expect(card!.querySelector('.card-label')?.textContent).not.toBe('');
      expect(card!.dataset.actionIndex).toBe(String(index));
    }
    root.querySelector<HTMLButtonElement>('[data-testid="pick-strike"]')!.click();
    expect(dispatch).toHaveBeenCalledWith(picks[1]);
  });

  it('keeps the item card and its dispatch behaviour intact', () => {
    const { root, dispatch } = render();
    const item = root.querySelector<HTMLButtonElement>('[data-testid="action-useItem-potion"]');
    expect(item).not.toBeNull();
    expect(item!.querySelector('.card-icon')).not.toBeNull();
    expect(item!.querySelector('.card-label')?.textContent).not.toBe('');
    item!.click();
    expect(dispatch).toHaveBeenCalledWith(actions.at(-1));
  });

  it('shows hp/maxHp for both combatants as DOM text', () => {
    const { root } = render();
    expect(root.querySelector('[data-testid="hp-left"]')?.textContent).toBe('38/48');
    expect(root.querySelector('[data-testid="hp-right"]')?.textContent).toBe('12/38');
  });
});
