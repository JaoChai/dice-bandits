import { createGame, type Action, type GameState } from '@dice-bandits/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLang, t } from '../src/i18n';
import { renderBattleUi } from '../src/ui/battleUi';

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
  { type: 'useItem', item: 'potion', target: null },
];

function render(state = battleState(), awaitingView = false) {
  const root = document.createElement('div');
  root.innerHTML =
    '<section class="game-shell"><header class="game-topline"><button data-action="exit">Back to title</button></header><nav class="action-bar"></nav></section>';
  const dispatch = vi.fn();
  renderBattleUi(
    root,
    state,
    actions,
    0,
    dispatch,
    (action) =>
      action.type === 'battlePick'
        ? t(`action.${action.pick}`)
        : `${t('action.item')} · ${t('item.potion')}`,
    true,
    true,
    awaitingView,
  );
  return { root, dispatch };
}

afterEach(() => setLang('en'));

describe('renderBattleUi', () => {
  it('marks the board stage as the contained battle panel only during battle', () => {
    const state = battleState();
    const root = document.createElement('div');
    root.innerHTML =
      '<section class="game-shell"><div class="board-stage"></div><nav class="action-bar"></nav></section>';
    const args = [root, state, actions, 0, vi.fn(), () => 'pick', true, true] as const;
    renderBattleUi(...args);
    expect(root.querySelector('.board-stage')?.classList.contains('battle-panel')).toBe(true);
    state.phase = createGame({
      seed: 'panel-reset',
      rounds: 12,
      seats: [
        { name: 'Hero', classId: 'knight', control: 'human', personality: null },
        { name: 'Rival', classId: 'thief', control: 'bot', personality: null },
      ],
    }).phase;
    renderBattleUi(...args);
    expect(root.querySelector('.board-stage')?.classList.contains('battle-panel')).toBe(false);
  });

  it('shows exact HP from both combatants as DOM text, not canvas glyphs', () => {
    const state = battleState();
    if (state.phase.kind !== 'battle') throw new Error('expected battle');
    state.phase.battle.a.hp = 36;
    const { root } = render(state);
    expect(root.querySelector('[data-testid="hp-left"]')?.textContent).toBe(
      `36/${state.phase.battle.a.stats.maxHp}`,
    );
    expect(root.querySelector('[data-testid="hp-right"]')?.textContent).toBe(
      `12/${state.phase.battle.b.stats.maxHp}`,
    );
  });

  it('renders three translated pick cards with icons and retained pick IDs', () => {
    setLang('th');
    const { root, dispatch } = render();
    const cards = root.querySelectorAll<HTMLButtonElement>('.command-card');
    expect(cards).toHaveLength(3);
    for (const [index, pick] of ['attack', 'strike', 'secret'].entries()) {
      expect(cards[index]?.dataset.testid).toBe(`pick-${pick}`);
      expect(cards[index]?.querySelector('.card-icon')).not.toBeNull();
      expect(cards[index]?.querySelector('.card-label')?.textContent).toBe(t(`action.${pick}`));
    }
    cards[0]?.click();
    expect(dispatch).toHaveBeenCalledWith(actions[0]);
  });

  it('marks the chosen card with a cursor and never preselects the other side secret', () => {
    const state = battleState();
    if (state.phase.kind !== 'battle') throw new Error('expected battle');
    state.phase.battle.pending.attack = 'attack';
    const { root } = render(state);
    expect(root.querySelector('[data-testid="chosen-card"]')).not.toBeNull();
    expect(root.querySelector('.command-card.selected')).toBeNull();
    state.phase.battle.pending.attack = 'secret';
    const defender = document.createElement('div');
    defender.innerHTML = '<section class="game-shell"><nav class="action-bar"></nav></section>';
    renderBattleUi(
      defender,
      state,
      [
        { type: 'battlePick', side: 'b', pick: 'defend' },
        { type: 'battlePick', side: 'b', pick: 'counter' },
        { type: 'battlePick', side: 'b', pick: 'secret' },
      ],
      1,
      vi.fn(),
      (action) => (action.type === 'battlePick' ? t(`action.${action.pick}`) : ''),
      true,
      true,
    );
    expect(defender.querySelectorAll('.command-card.selected')).toHaveLength(0);
  });

  it('updates the battle exit control when switching to Thai', () => {
    setLang('th');
    const { root } = render();
    expect(root.querySelector('[data-action="exit"]')?.textContent).toBe(t('setup.back'));
  });

  it('renders smaller item cards with retained IDs and disables all cards while awaiting a view', () => {
    const { root, dispatch } = render(battleState(), true);
    const item = root.querySelector<HTMLButtonElement>('[data-testid="action-useItem-potion"]');
    expect(item?.classList.contains('item-card')).toBe(true);
    expect(item?.querySelector('.card-icon')).not.toBeNull();
    expect(root.querySelectorAll<HTMLButtonElement>('.command-card:disabled')).toHaveLength(3);
    expect(item?.disabled).toBe(true);
    item?.click();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
