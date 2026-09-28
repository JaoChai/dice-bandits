import type { ClassId } from '@dice-bandits/engine';
import { lobbyMessage } from './lobby';
import type { Room, RoomSeat } from './model';
import { publicSeat } from './model';
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

function nextAlarmAt(room: Room): number | null {
  const deadlines = room.seats.flatMap((seat) =>
    seat.disconnectDeadline === null ? [] : [seat.disconnectDeadline],
  );
  return deadlines.length === 0 ? null : Math.min(...deadlines);
}

function lobbyBroadcast(room: Room): Outbound {
  return {
    to: 'all',
    msg: { type: 'lobby', code: room.code, host: room.host, seats: room.seats.map(publicSeat) },
  };
}

function alarm(room: Room, now: number): RoomStepResult {
  if (room.status !== 'lobby') return { room, out: [], nextAlarmAt: nextAlarmAt(room) };
  const seats = room.seats.filter(
    (seat) => seat.disconnectDeadline === null || seat.disconnectDeadline > now,
  );
  if (seats.length === room.seats.length) return { room, out: [], nextAlarmAt: nextAlarmAt(room) };
  if (seats.length === 0) return { room: null, out: [], nextAlarmAt: null };
  const host = seats.some((seat) => seat.seat === room.host)
    ? room.host
    : Math.min(...seats.map((seat) => seat.seat));
  const nextRoom = { ...room, seats, host, lastActivityAt: now };
  return { room: nextRoom, out: [lobbyBroadcast(nextRoom)], nextAlarmAt: nextAlarmAt(nextRoom) };
}

function connectedRoom(room: Room, seatNumber: number | null, now: number): RoomStepResult {
  if (seatNumber === null) return { room, out: [], nextAlarmAt: nextAlarmAt(room) };
  const seat = room.seats.find((candidate) => candidate.seat === seatNumber);
  if (seat === undefined) return { room, out: [], nextAlarmAt: nextAlarmAt(room) };
  const seats = room.seats.map((candidate) =>
    candidate.seat === seatNumber
      ? { ...candidate, connected: true, disconnectDeadline: null }
      : candidate,
  );
  const nextRoom = { ...room, seats, lastActivityAt: now };
  return {
    room: nextRoom,
    out: room.status === 'lobby' ? [lobbyBroadcast(nextRoom)] : [],
    nextAlarmAt: nextAlarmAt(nextRoom),
  };
}

function disconnectedRoom(room: Room, seatNumber: number | null, now: number): RoomStepResult {
  if (seatNumber === null || room.status !== 'lobby')
    return { room, out: [], nextAlarmAt: nextAlarmAt(room) };
  const target = room.seats.find((candidate) => candidate.seat === seatNumber);
  if (target === undefined) return { room, out: [], nextAlarmAt: nextAlarmAt(room) };
  const seats: RoomSeat[] = room.seats.map((seat) =>
    seat.seat === seatNumber
      ? { ...seat, connected: false, connId: null, disconnectDeadline: now + room.config.idleMs }
      : seat,
  );
  const nextRoom = { ...room, seats, lastActivityAt: now };
  return {
    room: nextRoom,
    out: room.status === 'lobby' ? [lobbyBroadcast(nextRoom)] : [],
    nextAlarmAt: nextAlarmAt(nextRoom),
  };
}

export function roomStep(room: Room, input: RoomInput, now: number): RoomStepResult {
  if (input.kind === 'alarm') return alarm(room, now);
  if (input.kind === 'connect') return connectedRoom(room, input.seat, now);
  if (input.kind === 'disconnect') return disconnectedRoom(room, input.seat, now);
  if (input.msg.type === 'join' || input.msg.type === 'setClass' || input.msg.type === 'start') {
    return lobbyMessage(
      room,
      input.seat ?? -1,
      input.conn,
      input.msg,
      now,
      input.seed,
      input.newTokenHash,
    );
  }
  return {
    room,
    out: [{ to: { conn: input.conn }, msg: { type: 'error', key: 'online.error.notAvailable' } }],
    nextAlarmAt: nextAlarmAt(room),
  };
}

export function isClassId(value: string): value is ClassId {
  return ['knight', 'thief', 'mage', 'cleric'].includes(value);
}
