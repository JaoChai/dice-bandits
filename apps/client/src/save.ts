import type { GameState } from '@dice-bandits/engine';

const SAVE_KEY = 'diceBandits.save';
const SAVE_VERSION = 1;
const toastListeners = new Set<(key: string) => void>();

export function onSaveToast(listener: (key: string) => void): () => void {
  toastListeners.add(listener);
  return () => toastListeners.delete(listener);
}

export function saveGame(state: GameState): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, state }));
}

export function loadGame(): GameState | null {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw === null) return null;
  try {
    const save: unknown = JSON.parse(raw);
    if (
      typeof save !== 'object' ||
      save === null ||
      !('version' in save) ||
      save.version !== SAVE_VERSION ||
      !('state' in save) ||
      !isGameState(save.state)
    ) {
      discardSave();
      return null;
    }
    return save.state;
  } catch {
    discardSave();
    return null;
  }
}

export function clearSave(): void {
  localStorage.removeItem(SAVE_KEY);
}

function discardSave(): void {
  clearSave();
  for (const listener of toastListeners) listener('toast.saveDiscarded');
}

function isGameState(value: unknown): value is GameState {
  if (typeof value !== 'object' || value === null) return false;
  return 'version' in value && value.version === 1 && 'config' in value && 'players' in value;
}
