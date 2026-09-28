import type { ClassId, GameState } from '@dice-bandits/engine';

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_SEATS = 4;

export interface RoomSeat {
  seat: number;
  name: string;
  classId: ClassId;
  kind: 'human' | 'bot';
  controller: 'player' | 'botTakeover' | 'bot';
  connected: boolean;
  tokenHash: string | null;
  disconnectDeadline: number | null;
  idleDeadline: number | null;
}

export type PublicSeat = Omit<RoomSeat, 'tokenHash' | 'disconnectDeadline' | 'idleDeadline'>;

export interface RoomConfig {
  idleMs: number;
  ttlMs: number;
  botBatch: number;
}

export interface Room {
  code: string;
  status: 'lobby' | 'playing' | 'finished';
  host: number;
  seats: RoomSeat[];
  game: GameState | null;
  turn: number;
  lastActivityAt: number;
  pendingBotWork: boolean;
  config: RoomConfig;
}

export function nextRoomAlarmAt(room: Room, now?: number): number | null {
  const deadlines = room.seats.flatMap((seat) =>
    seat.disconnectDeadline === null ? [] : [seat.disconnectDeadline],
  );
  if (room.pendingBotWork && now !== undefined) deadlines.push(now);
  return deadlines.length === 0 ? null : Math.min(...deadlines);
}

const DEFAULT_CONFIG: RoomConfig = { idleMs: 60_000, ttlMs: 86_400_000, botBatch: 200 };

export function generateCode(random: () => number): string {
  return Array.from({ length: 5 }, () => {
    const value = random();
    const index = Math.min(CODE_ALPHABET.length - 1, Math.floor(value * CODE_ALPHABET.length));
    return CODE_ALPHABET[index]!;
  }).join('');
}

export function createRoom(
  code: string,
  hostName: string,
  tokenHash: string,
  now: number,
  config: Partial<RoomConfig> = {},
): Room {
  return {
    code,
    status: 'lobby',
    host: 0,
    seats: [
      {
        seat: 0,
        name: hostName.trim(),
        classId: 'knight',
        kind: 'human',
        controller: 'player',
        connected: true,
        tokenHash,
        disconnectDeadline: null,
        idleDeadline: null,
      },
    ],
    game: null,
    turn: 0,
    lastActivityAt: now,
    pendingBotWork: false,
    config: { ...DEFAULT_CONFIG, ...config },
  };
}

export function publicSeat(seat: RoomSeat): PublicSeat {
  return {
    seat: seat.seat,
    name: seat.name,
    classId: seat.classId,
    kind: seat.kind,
    controller: seat.controller,
    connected: seat.connected,
  };
}
