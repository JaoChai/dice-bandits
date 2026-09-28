import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '@dice-bandits/engine';
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

afterEach(() => {
  vi.restoreAllMocks();
  clearSave();
  localStorage.clear();
});

describe('save data', () => {
  it('round-trips a game state with a version field', () => {
    const state = game();
    saveGame(state);
    expect(JSON.parse(localStorage.getItem('diceBandits.save') ?? '{}').version).toBe(1);
    expect(loadGame()).toEqual(state);
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
