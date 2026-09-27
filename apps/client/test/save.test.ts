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
