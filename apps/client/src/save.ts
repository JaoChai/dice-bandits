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

const regions = new Set(['meadow', 'desert', 'snow', 'volcano']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStats(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.maxHp === 'number' &&
    typeof value.atk === 'number' &&
    typeof value.def === 'number' &&
    typeof value.spd === 'number' &&
    typeof value.mag === 'number'
  );
}

function isBuffs(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.ironSkin === 'boolean' &&
    typeof value.poison === 'boolean' &&
    typeof value.halveNext === 'boolean' &&
    (value.rage === undefined || typeof value.rage === 'boolean')
  );
}

function isCombatant(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.kind === 'player' || value.kind === 'monster') &&
    (typeof value.seat === 'number' || value.seat === null) &&
    (typeof value.monsterId === 'string' || value.monsterId === null) &&
    typeof value.level === 'number' &&
    typeof value.hp === 'number' &&
    isStats(value.stats) &&
    typeof value.secretUsed === 'boolean' &&
    isBuffs(value.buffs)
  );
}

function isPhase(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  switch (value.kind) {
    case 'awaitRoll':
    case 'endOfTurn':
      return true;
    case 'moving':
      return typeof value.remaining === 'number';
    case 'chooseBranch':
      return typeof value.remaining === 'number' && isNumberArray(value.options);
    case 'duelOffer':
      return typeof value.remaining === 'number' && isNumberArray(value.targets);
    case 'battle': {
      const battle = value.battle;
      return (
        isRecord(battle) &&
        (battle.context === 'monster' || battle.context === 'town' || battle.context === 'pvp') &&
        typeof battle.spaceId === 'number' &&
        isCombatant(battle.a) &&
        isCombatant(battle.b) &&
        typeof battle.exchange === 'number' &&
        (battle.attackerSide === 'a' || battle.attackerSide === 'b') &&
        (battle.half === 1 || battle.half === 2) &&
        isRecord(battle.pending) &&
        (battle.pending.attack === 'attack' ||
          battle.pending.attack === 'strike' ||
          battle.pending.attack === 'secret' ||
          battle.pending.attack === null) &&
        (battle.pending.defense === 'defend' ||
          battle.pending.defense === 'counter' ||
          battle.pending.defense === 'secret' ||
          battle.pending.defense === null)
      );
    }
    case 'pvpReward':
      return typeof value.winner === 'number' && typeof value.loser === 'number';
    case 'levelUp':
      return (
        typeof value.seat === 'number' &&
        isStringArray(value.choices) &&
        (value.then === 'endTurn' || value.then === 'continue')
      );
    case 'shop':
      return isStringArray(value.stock);
    case 'townManage':
    case 'townChallenge':
      return typeof value.spaceId === 'number';
    case 'gameOver':
      return (
        isNumberArray(value.ranking) &&
        isNumberArray(value.winners) &&
        Array.isArray(value.highlights) &&
        value.highlights.every(
          (highlight) =>
            isRecord(highlight) &&
            (highlight.key === 'biggestRobbery' || highlight.key === 'mostKod'
              ? typeof highlight.seat === 'number' && typeof highlight.value === 'number'
              : highlight.key === 'hotTown' &&
                (typeof highlight.spaceId === 'number' || highlight.spaceId === null) &&
                typeof highlight.flips === 'number'),
        )
      );
    default:
      return false;
  }
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
  if (!isPhase(value.phase)) return false;
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
