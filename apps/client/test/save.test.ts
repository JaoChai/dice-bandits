import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseAction, createGame, legalActions, step } from '@dice-bandits/engine';
import { clearSave, loadGame, onSaveToast, saveGame } from '../src/save';

const game = () =>
  createGame({
    seed: 'save-test',
    rounds: 12,
    seats: [
      { name: 'A', classId: 'knight', control: 'human', personality: null },
      { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' },
    ],
  });

const realBattleState = () => {
  let state = createGame({
    seed: 'save-battle-test',
    rounds: 8,
    seats: [
      { name: 'A', classId: 'knight', control: 'bot', personality: 'greedy' },
      { name: 'B', classId: 'thief', control: 'bot', personality: 'vengeful' },
      { name: 'C', classId: 'cleric', control: 'bot', personality: 'cowardly' },
      { name: 'D', classId: 'mage', control: 'bot', personality: 'greedy' },
    ],
  });
  for (let actionCount = 0; actionCount < 5000; actionCount++) {
    if (state.phase.kind === 'battle') return state;
    const action = chooseAction(state, state.turnSeat);
    state = step(state, action).state;
  }
  throw new Error('engine did not reach a battle');
};

afterEach(() => {
  vi.restoreAllMocks();
  clearSave();
  localStorage.clear();
});

describe('save data', () => {
  it('round-trips a game state with a version field', () => {
    const state = game();
    saveGame(state);
    expect(JSON.parse(localStorage.getItem('diceBandits.save') ?? '{}').version).toBe(2);
    expect(loadGame()).toEqual(state);
  });

  it('discards a stored version-1 save (board shape changed in M5a) and removes the key', () => {
    const toast = vi.fn();
    const unsubscribe = onSaveToast(toast);
    localStorage.setItem('diceBandits.save', JSON.stringify({ version: 1, state: game() }));
    expect(loadGame()).toBeNull();
    expect(localStorage.getItem('diceBandits.save')).toBeNull();
    expect(toast).toHaveBeenLastCalledWith('toast.saveDiscarded');
    unsubscribe();
  });

  it('discards parseable saves with structurally invalid state and announces the toast key', () => {
    const toast = vi.fn();
    const unsubscribe = onSaveToast(toast);
    for (const state of [
      { ...game(), phase: null },
      { ...game(), phase: { kind: 42 } },
      { ...game(), players: [null] },
    ]) {
      localStorage.setItem('diceBandits.save', JSON.stringify({ version: 1, state }));
      expect(loadGame()).toBeNull();
    }
    expect(toast).toHaveBeenCalledTimes(3);
    expect(toast).toHaveBeenLastCalledWith('toast.saveDiscarded');
    unsubscribe();
  });

  it('discards saves whose phase payload is malformed and announces the toast key', () => {
    const toast = vi.fn();
    const unsubscribe = onSaveToast(toast);
    const state = game();
    const realBattle = realBattleState();
    if (realBattle.phase.kind !== 'battle') throw new Error('expected battle phase');
    const battle = structuredClone(realBattle.phase);
    const missingAtk = structuredClone(battle);
    delete (missingAtk.battle.a.stats as Partial<typeof missingAtk.battle.a.stats>).atk;
    const missingPoison = structuredClone(battle);
    delete (missingPoison.battle.b.buffs as Partial<typeof missingPoison.battle.b.buffs>).poison;
    const invalidRage = structuredClone(battle);
    (invalidRage.battle.a.buffs as { rage?: unknown }).rage = 'yes';
    const invalidAttack = structuredClone(battle);
    (invalidAttack.battle.pending as { attack: unknown }).attack = 'punch';
    const invalidDefense = structuredClone(battle);
    (invalidDefense.battle.pending as { defense: unknown }).defense = 'dodge';
    const malformedPhases = [
      { kind: 'battle' },
      { kind: 'battle', battle: { a: null } },
      missingAtk,
      missingPoison,
      invalidRage,
      invalidAttack,
      invalidDefense,
      { kind: 'gameOver', winners: [], highlights: [] },
      { kind: 'gameOver', ranking: [], winners: [], highlights: [{}] },
      { kind: 'levelUp', seat: 0, then: 'endTurn' },
      { kind: 'shop', stock: 'x' },
      { kind: 'chooseBranch', remaining: 1, options: ['a'] },
    ];

    for (const phase of malformedPhases) {
      localStorage.setItem(
        'diceBandits.save',
        JSON.stringify({ version: 1, state: { ...state, phase } }),
      );
      expect(loadGame()).toBeNull();
      expect(toast).toHaveBeenLastCalledWith('toast.saveDiscarded');
    }
    expect(toast).toHaveBeenCalledTimes(malformedPhases.length);
    unsubscribe();
  });

  it('accepts real engine battle states with rage true or absent', () => {
    for (const rage of [true, undefined]) {
      const state = realBattleState();
      if (state.phase.kind !== 'battle') throw new Error('expected battle phase');
      const battle = structuredClone(state.phase);
      if (rage === undefined) delete battle.battle.a.buffs.rage;
      else battle.battle.a.buffs.rage = rage;
      saveGame({ ...state, phase: battle });
      expect(loadGame()).toEqual({ ...state, phase: battle });
    }
  });

  it('round-trips real engine states across gameplay phases', () => {
    const covered = new Set<string>();
    for (let seed = 0; seed < 8; seed++) {
      let state = createGame({
        seed: `save-sweep-${seed}`,
        rounds: 8,
        seats: [
          { name: 'A', classId: 'knight', control: 'bot', personality: 'greedy' },
          { name: 'B', classId: 'thief', control: 'bot', personality: 'vengeful' },
          { name: 'C', classId: 'cleric', control: 'bot', personality: 'cowardly' },
          { name: 'D', classId: 'mage', control: 'bot', personality: 'greedy' },
        ],
      });
      for (let actionCount = 0; actionCount < 5000; actionCount++) {
        covered.add(state.phase.kind);
        saveGame(state);
        expect(loadGame(), `seed ${seed}, phase ${state.phase.kind}`).not.toBeNull();
        if (state.phase.kind === 'gameOver') break;

        let seat = state.turnSeat;
        if (state.phase.kind === 'battle') {
          const battle = state.phase.battle;
          const side =
            battle.pending.attack === null
              ? battle.attackerSide
              : battle.attackerSide === 'a'
                ? 'b'
                : 'a';
          const actor = side === 'a' ? battle.a : battle.b;
          if (actor.kind === 'player') seat = actor.seat!;
        } else if (state.phase.kind === 'pvpReward') {
          seat = state.phase.winner;
        }
        const action = chooseAction(state, seat);
        expect(legalActions(state, seat)).toContainEqual(action);
        state = step(state, action).state;
        if (actionCount === 4999) throw new Error(`seed ${seed} did not reach gameOver`);
      }
    }
    expect([...covered]).toEqual(
      expect.arrayContaining([
        'battle',
        'chooseBranch',
        'duelOffer',
        'endOfTurn',
        'gameOver',
        'levelUp',
        'pvpReward',
        'shop',
        'townChallenge',
      ]),
    );
    console.info(`Save validity sweep covered phases: ${[...covered].sort().join(', ')}`);
  });

  it('treats localStorage read, write, and removal failures as non-fatal', () => {
    const state = game();
    const getItemSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(loadGame()).toBeNull();
    getItemSpy.mockRestore();

    const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => saveGame(state)).not.toThrow();
    setItemSpy.mockRestore();

    const removeItemSpy = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => clearSave()).not.toThrow();
    removeItemSpy.mockRestore();
  });

  it('discards incompatible or malformed saves and announces the toast key', () => {
    const toast = vi.fn();
    const unsubscribe = onSaveToast(toast);
    localStorage.setItem('diceBandits.save', JSON.stringify({ version: 99 }));
    expect(loadGame()).toBeNull();
    expect(localStorage.getItem('diceBandits.save')).toBeNull();
    expect(toast).toHaveBeenLastCalledWith('toast.saveDiscarded');
    localStorage.setItem('diceBandits.save', '{broken');
    expect(loadGame()).toBeNull();
    expect(localStorage.getItem('diceBandits.save')).toBeNull();
    expect(toast).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
