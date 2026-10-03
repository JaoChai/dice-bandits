import { createGame, legalActions, type GameState } from '@dice-bandits/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLang, t } from '../src/i18n';
import { renderHud } from '../src/ui/hud';

/**
 * Task 8 (reviewer item 6): battle command cards must be labelled by the real
 * production wiring — renderHud → actionName → battle.card.* — not an
 * injected labeler. The i18n module is wrapped with a recording delegate that
 * keeps real translations, because action.* and battle.card.* currently share
 * identical strings in both languages: only the requested KEY proves which
 * family the production code reads (a revert to `action.${pick}` fails the
 * key assertions even though the label text would not change).
 */

const tCalls: string[] = [];

vi.mock('../src/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/i18n')>();
  return {
    ...actual,
    t: (key: string, params?: Record<string, string | number>) => {
      tCalls.push(key);
      return actual.t(key, params);
    },
  };
});

function battleState(pendingAttack: 'attack' | null = null): GameState {
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
      pending: { attack: pendingAttack, defense: null },
    },
  };
  return state;
}

let roots: HTMLElement[] = [];

function render(state = battleState()) {
  const root = document.createElement('div');
  document.body.append(root);
  roots.push(root);
  const dispatch = vi.fn();
  renderHud(root, state, dispatch);
  // Real local-pvp flow: the pass-device dialog gates the picker; confirming
  // it reveals the command cards (battleUi keeps the pass in a module set).
  root.querySelector<HTMLButtonElement>('[data-testid="pass-ready"]')?.click();
  return { root, dispatch, state };
}

afterEach(() => {
  setLang('en');
  for (const root of roots) root.remove();
  roots = [];
  tCalls.length = 0;
});

describe('cartoon battle command cards (Task 8)', () => {
  it('labels the attack card via battle.card.attack in English and Thai', () => {
    const { root } = render(battleState());
    const label = () =>
      root.querySelector<HTMLButtonElement>('[data-testid="pick-attack"] .card-label')?.textContent;
    expect(label()).toBe(t('battle.card.attack'));
    expect(tCalls).toContain('battle.card.attack');
    expect(tCalls).not.toContain('action.attack');
    setLang('th');
    renderHud(root, battleState(), vi.fn());
    expect(label()).toBe(t('battle.card.attack'));
    expect(t('battle.card.attack')).toBe('โจมตี');
  });

  it('labels every pick from battle.card keys, never the board action keys', () => {
    render(battleState()); // attacker picks: attack / strike / secret
    render(battleState('attack')); // defender picks: defend / counter / secret
    for (const pick of ['attack', 'strike', 'secret', 'defend', 'counter'] as const) {
      expect(tCalls, `battle.card.${pick} requested`).toContain(`battle.card.${pick}`);
      expect(tCalls, `action.${pick} must not be requested`).not.toContain(`action.${pick}`);
    }
  });

  it('renders icon and label on every command card with dispatch intact', () => {
    const { root, dispatch, state } = render(battleState());
    for (const pick of ['attack', 'strike', 'secret'] as const) {
      const card = root.querySelector<HTMLButtonElement>(`[data-testid="pick-${pick}"]`);
      expect(card, `card for ${pick}`).not.toBeNull();
      expect(card!.querySelector('.card-icon')).not.toBeNull();
      expect(card!.querySelector('.card-label')?.textContent).not.toBe('');
    }
    root.querySelector<HTMLButtonElement>('[data-testid="pick-strike"]')!.click();
    const strike = legalActions(state, 0).find(
      (action) => action.type === 'battlePick' && action.pick === 'strike',
    );
    expect(strike).toBeDefined();
    expect(dispatch).toHaveBeenCalledWith(strike);
  });

  it('shows hp/maxHp for both combatants as DOM text', () => {
    const { root } = render(battleState());
    expect(root.querySelector('[data-testid="hp-left"]')?.textContent).toBe('38/48');
    expect(root.querySelector('[data-testid="hp-right"]')?.textContent).toBe('12/38');
  });
});
