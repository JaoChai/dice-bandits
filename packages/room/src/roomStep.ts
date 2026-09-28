import type { ClassId } from '@dice-bandits/engine';
import { lobbyMessage } from './lobby';
import type { Room } from './model';
import { nextRoomAlarmAt, publicSeat } from './model';
import {
  BotExecutionError,
  logBotExecutionError,
  playAction,
  runBotChain,
  viewForSeat,
} from './play';
import type { ClientMsg, ServerMsg } from './protocol';

export type RoomInput =
  | {
      kind: 'msg';
      seat: number | null;
      conn: string;
      msg: ClientMsg;
      newTokenHash?: string;
      seed?: string;
    }
  | { kind: 'connect'; seat: number | null; conn: string }
  | { kind: 'disconnect'; seat: number | null; conn: string }
  | { kind: 'alarm' };
export interface Outbound {
  to: number | 'all' | { conn: string };
  msg: ServerMsg;
}
export interface RoomStepResult {
  room: Room | null;
  out: Outbound[];
  nextAlarmAt: number | null;
}

function lobbyBroadcast(room: Room): Outbound {
  return {
    to: 'all',
    msg: { type: 'lobby', code: room.code, host: room.host, seats: room.seats.map(publicSeat) },
  };
}

function alarm(room: Room, now: number): RoomStepResult {
  if (room.pendingBotWork && room.status === 'playing') {
    try {
      return runBotChain(room, now);
    } catch (err) {
      if (err instanceof BotExecutionError) logBotExecutionError(room, err);
      else console.error('[room]', room.code, -1, room.game?.phase.kind, err);
      return { room, out: [], nextAlarmAt: now };
    }
  }
  if (room.status !== 'lobby') return { room, out: [], nextAlarmAt: nextRoomAlarmAt(room, now) };
  const seats = room.seats.filter(
    (seat) => seat.disconnectDeadline === null || seat.disconnectDeadline > now,
  );
  if (seats.length === room.seats.length)
    return { room, out: [], nextAlarmAt: nextRoomAlarmAt(room, now) };
  if (seats.length === 0) return { room: null, out: [], nextAlarmAt: null };
  const host = seats.some((seat) => seat.seat === room.host)
    ? room.host
    : Math.min(...seats.map((seat) => seat.seat));
  const nextRoom = { ...room, seats, host, lastActivityAt: now };
  return {
    room: nextRoom,
    out: [lobbyBroadcast(nextRoom)],
    nextAlarmAt: nextRoomAlarmAt(nextRoom, now),
  };
}

function connectedRoom(room: Room, seatNumber: number | null, now: number): RoomStepResult {
  if (seatNumber === null || !room.seats.some((seat) => seat.seat === seatNumber))
    return { room, out: [], nextAlarmAt: nextRoomAlarmAt(room, now) };
  const seats = room.seats.map((seat) =>
    seat.seat === seatNumber ? { ...seat, connected: true, disconnectDeadline: null } : seat,
  );
  const nextRoom = { ...room, seats, lastActivityAt: now };
  return {
    room: nextRoom,
    out: room.status === 'lobby' ? [lobbyBroadcast(nextRoom)] : [],
    nextAlarmAt: nextRoomAlarmAt(nextRoom, now),
  };
}

function disconnectedRoom(room: Room, seatNumber: number | null, now: number): RoomStepResult {
  if (
    seatNumber === null ||
    room.status !== 'lobby' ||
    !room.seats.some((seat) => seat.seat === seatNumber)
  )
    return { room, out: [], nextAlarmAt: nextRoomAlarmAt(room, now) };
  const seats = room.seats.map((seat) =>
    seat.seat === seatNumber
      ? { ...seat, connected: false, disconnectDeadline: now + room.config.idleMs }
      : seat,
  );
  const nextRoom = { ...room, seats, lastActivityAt: now };
  return {
    room: nextRoom,
    out: [lobbyBroadcast(nextRoom)],
    nextAlarmAt: nextRoomAlarmAt(nextRoom, now),
  };
}

function rejectStale(room: Room, seat: number, conn: string, now: number): RoomStepResult {
  const out: Outbound[] = [
    {
      to: { conn },
      msg: { type: 'error', key: 'online.error.staleAction' },
    },
  ];
  if (room.game !== null && seat >= 0 && room.seats.some((candidate) => candidate.seat === seat)) {
    out.push({ to: seat, msg: viewForSeat(room, seat) });
  }
  return { room, out, nextAlarmAt: nextRoomAlarmAt(room, now) };
}

export function roomStep(room: Room, input: RoomInput, now: number): RoomStepResult {
  if (input.kind === 'alarm') return alarm(room, now);
  if (input.kind === 'connect') return connectedRoom(room, input.seat, now);
  if (input.kind === 'disconnect') return disconnectedRoom(room, input.seat, now);
  if (input.msg.type === 'join' || input.msg.type === 'setClass' || input.msg.type === 'start') {
    const result = lobbyMessage(
      room,
      input.seat ?? -1,
      input.conn,
      input.msg,
      now,
      input.seed,
      input.newTokenHash,
    );
    if (input.msg.type === 'start' && result.room?.status === 'playing') {
      try {
        const played = runBotChain(result.room, now);
        return {
          ...played,
          out: [...result.out.filter((item) => item.msg.type !== 'view'), ...played.out],
        };
      } catch (err) {
        if (err instanceof BotExecutionError) logBotExecutionError(result.room, err);
        else console.error('[room]', room.code, input.seat, 'start', err);
        return {
          room,
          out: [
            { to: { conn: input.conn }, msg: { type: 'error', key: 'online.error.server' } },
            lobbyBroadcast(room),
          ],
          nextAlarmAt: nextRoomAlarmAt(room, now),
        };
      }
    }
    return result;
  }
  if (input.msg.type === 'action') {
    if (
      room.status !== 'playing' ||
      room.game === null ||
      room.seats[input.seat ?? -1]?.controller !== 'player'
    ) {
      return playAction(room, input.seat ?? -1, input.conn, input.msg.action, now);
    }
    if (input.msg.turn !== room.turn) return rejectStale(room, input.seat ?? -1, input.conn, now);
    return playAction(room, input.seat ?? -1, input.conn, input.msg.action, now);
  }
  return {
    room,
    out: [{ to: { conn: input.conn }, msg: { type: 'error', key: 'online.error.notAvailable' } }],
    nextAlarmAt: nextRoomAlarmAt(room, now),
  };
}

export function isClassId(value: string): value is ClassId {
  return ['knight', 'thief', 'mage', 'cleric'].includes(value);
}
