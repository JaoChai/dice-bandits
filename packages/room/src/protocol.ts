import type { Action, ClassId, GameEvent, GameState } from '@dice-bandits/engine';
import type { PublicSeat } from './model';

export type ClientMsg =
  | { type: 'join'; name: string }
  | { type: 'claim'; seat: number }
  | { type: 'setClass'; classId: ClassId }
  | { type: 'start' }
  | { type: 'action'; action: Action; turn: number }
  | { type: 'reclaim' };

export type ServerMsg =
  | { type: 'welcome'; seat: number; token?: string }
  | { type: 'lobby'; code: string; host: number; seats: PublicSeat[] }
  | {
      type: 'view';
      turn: number;
      state: GameState;
      you: number;
      legal: Action[];
      seats: PublicSeat[];
      opponentPicked: boolean;
    }
  | { type: 'events'; turn: number; events: GameEvent[] }
  /** Sent to an unseated visitor of a started game: enough to offer a claim, no game state. */
  | { type: 'seats'; seats: PublicSeat[] }
  | { type: 'error'; key: string };

const CLASS_IDS: readonly ClassId[] = ['knight', 'thief', 'mage', 'cleric'];

export function validName(name: string): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 16 ? trimmed : null;
}

export function parseClientMsg(raw: string): ClientMsg | null {
  if (new TextEncoder().encode(raw).byteLength > 4096) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || !('type' in value)) return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'join': {
      if (typeof message.name !== 'string') return null;
      const name = validName(message.name);
      return name === null ? null : { type: 'join', name };
    }
    case 'claim':
      return Number.isInteger(message.seat) &&
        (message.seat as number) >= 0 &&
        (message.seat as number) < 4
        ? { type: 'claim', seat: message.seat as number }
        : null;
    case 'setClass':
      return typeof message.classId === 'string' && CLASS_IDS.includes(message.classId as ClassId)
        ? { type: 'setClass', classId: message.classId as ClassId }
        : null;
    case 'start':
    case 'reclaim':
      return { type: message.type };
    case 'action':
      return Number.isInteger(message.turn) &&
        (message.turn as number) >= 0 &&
        isAction(message.action)
        ? { type: 'action', action: message.action, turn: message.turn as number }
        : null;
    default:
      return null;
  }
}

function isAction(value: unknown): value is Action {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const actionType = (value as { type: unknown }).type;
  return (
    typeof actionType === 'string' &&
    [
      'roll',
      'useItem',
      'useBanditCard',
      'chooseBranch',
      'duel',
      'battlePick',
      'pvpReward',
      'pickPerk',
      'shopBuy',
      'shopSell',
      'invest',
      'attackTown',
      'leave',
      'endTurn',
    ].includes(actionType)
  );
}
