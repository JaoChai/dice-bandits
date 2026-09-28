import type { GameState } from '@dice-bandits/engine';

const SAVE_KEY = 'diceBandits.save';
const SAVE_VERSION = 1;
const toastListeners = new Set<(key: string) => void>();

export function onSaveToast(listener: (key: string) => void): () => void {
  toastListeners.add(listener);
  return () => toastListeners.delete(listener);
}

export function saveGame(state: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, state }));
  } catch {
    // Persistence is optional; keep the current game playable when storage is unavailable.
  }
}

export function loadGame(): GameState | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
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
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Ignore storage failures so recovery and play can continue.
  }
}

function discardSave(): void {
  clearSave();
  for (const listener of toastListeners) listener('toast.saveDiscarded');
}

const phaseKinds = new Set([
  'awaitRoll',
  'moving',
  'chooseBranch',
  'duelOffer',
  'battle',
  'pvpReward',
  'levelUp',
  'shop',
  'townManage',
  'townChallenge',
  'endOfTurn',
  'gameOver',
]);
const regions = new Set(['meadow', 'desert', 'snow', 'volcano']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isGameState(value: unknown): value is GameState {
  if (!isRecord(value) || value.version !== 1) return false;
  if (
    !isRecord(value.config) ||
    !Array.isArray(value.config.seats) ||
    typeof value.config.rounds !== 'number'
  )
    return false;
  if (
    !Array.isArray(value.players) ||
    !Array.isArray(value.board && isRecord(value.board) ? value.board.spaces : null)
  )
    return false;
  if (
    !Array.isArray(value.towns) ||
    !Array.isArray(value.rng) ||
    typeof value.worldRule !== 'string'
  )
    return false;
  if (typeof value.round !== 'number' || typeof value.turnSeat !== 'number') return false;
  if (
    !isRecord(value.phase) ||
    typeof value.phase.kind !== 'string' ||
    !phaseKinds.has(value.phase.kind)
  )
    return false;
  if (!value.config.seats.every((seat) => isRecord(seat))) return false;
  if (
    !value.players.every(
      (player) =>
        isRecord(player) &&
        typeof player.seat === 'number' &&
        typeof player.gold === 'number' &&
        typeof player.level === 'number' &&
        Array.isArray(player.items) &&
        (player.control === 'human' || player.control === 'bot'),
    )
  )
    return false;
  const board = value.board;
  if (!isRecord(board) || !Array.isArray(board.spaces)) return false;
  return board.spaces.every(
    (space) => isRecord(space) && typeof space.id === 'number' && regions.has(String(space.region)),
  );
}
