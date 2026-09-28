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
import { reclaimSeat, startTakeover, syncIdleDeadlines } from './timers';
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

function gameViews(room: Room): Outbound[] {
  return room.game === null
    ? []
    : room.seats.map((seat) => ({
        to: seat.seat,
        msg: viewForSeat(room, seat.seat),
      }));
}

function result(room: Room | null, out: Outbound[], now: number): RoomStepResult {
  return { room, out, nextAlarmAt: room === null ? null : nextRoomAlarmAt(room, now) };
}

function alarm(room: Room, now: number): RoomStepResult {
  if (now >= room.lastActivityAt + room.config.ttlMs) return result(null, [], now);

  if (room.status === 'finished') {
    const nextRoom: Room = {
      ...room,
      pendingBotWork: false,
      seats: room.seats.map((seat) => ({ ...seat, disconnectDeadline: null, idleDeadline: null })),
    };
    return result(nextRoom, [], now);
  }

  if (
    room.pendingBotWork &&
    room.status === 'playing' &&
    (room.botRetryAt === null || now >= room.botRetryAt)
  ) {
    try {
      return runBotChain(room, now);
    } catch (err) {
      const failures = room.botFailures + 1;
      if (failures <= 2) {
        const delay = [1_000, 5_000][failures - 1]!;
        return result({ ...room, botFailures: failures, botRetryAt: now + delay }, [], now);
      }
      if (err instanceof BotExecutionError) logBotExecutionError(room, err);
      else console.error('[room]', room.code, -1, room.game?.phase.kind, err);
      const stopped = { ...room, pendingBotWork: false, botFailures: 0, botRetryAt: null };
      return result(
        stopped,
        stopped.seats.map((seat) => ({
          to: seat.seat,
          msg: { type: 'error', key: 'online.error.server' },
        })),
        now,
      );
    }
  }

  if (room.status === 'lobby') {
    const seats = room.seats.filter(
      (seat) => seat.disconnectDeadline === null || seat.disconnectDeadline > now,
    );
    if (seats.length !== room.seats.length) {
      if (seats.length === 0) return result(null, [], now);
      const host = seats.some((seat) => seat.seat === room.host)
        ? room.host
        : Math.min(...seats.map((seat) => seat.seat));
      const nextRoom = { ...room, seats, host };
      return result(nextRoom, [lobbyBroadcast(nextRoom)], now);
    }
    return result(room, [], now);
  }

  const changedSeats = room.seats.map((seat) => {
    const idleExpired = seat.idleDeadline !== null && seat.idleDeadline <= now;
    const disconnectExpired = seat.disconnectDeadline !== null && seat.disconnectDeadline <= now;
    if (seat.controller === 'player' && (idleExpired || disconnectExpired))
      return startTakeover(seat);
    if (!idleExpired && !disconnectExpired) return seat;
    return {
      ...seat,
      idleDeadline: idleExpired ? null : seat.idleDeadline,
      disconnectDeadline: disconnectExpired ? null : seat.disconnectDeadline,
    };
  });
  const tookOver = changedSeats.some((seat, index) => seat !== room.seats[index]);
  if (!tookOver) return result(room, [], now);
  const takeoverRoom: Room = { ...room, seats: changedSeats, pendingBotWork: true };
  if (takeoverRoom.botRetryAt !== null && now < takeoverRoom.botRetryAt) {
    return result(
      takeoverRoom,
      takeoverRoom.seats.map((seat) => ({
        to: seat.seat,
        msg: viewForSeat(takeoverRoom, seat.seat),
      })),
      now,
    );
  }
  return alarm(takeoverRoom, now);
}

function connectedRoom(room: Room, seatNumber: number | null, now: number): RoomStepResult {
  const seats = room.seats.map((seat) => {
    if (seat.seat !== seatNumber) return seat;
    const connected = { ...seat, connected: true, disconnectDeadline: null };
    return room.status !== 'lobby' && connected.controller === 'botTakeover'
      ? reclaimSeat(connected)
      : connected;
  });
  const changed = seatNumber === null || seats.some((seat, index) => seat !== room.seats[index]);
  if (!changed) return result(room, [], now);
  let nextRoom: Room = { ...room, seats, lastActivityAt: now };
  if (nextRoom.status === 'playing') nextRoom = syncIdleDeadlines(nextRoom, now);
  return result(
    nextRoom,
    nextRoom.status === 'lobby' ? [lobbyBroadcast(nextRoom)] : gameViews(nextRoom),
    now,
  );
}

function disconnectedRoom(room: Room, seatNumber: number | null, now: number): RoomStepResult {
  if (seatNumber === null || !room.seats.some((seat) => seat.seat === seatNumber))
    return result(room, [], now);
  const seats = room.seats.map((seat) =>
    seat.seat === seatNumber
      ? {
          ...seat,
          connected: false,
          disconnectDeadline:
            room.status === 'lobby' || (room.status === 'playing' && seat.controller === 'player')
              ? now + room.config.idleMs
              : null,
          idleDeadline: room.status === 'playing' ? seat.idleDeadline : null,
        }
      : seat,
  );
  const nextRoom = { ...room, seats, lastActivityAt: now };
  return result(
    nextRoom,
    nextRoom.status === 'lobby' ? [lobbyBroadcast(nextRoom)] : gameViews(nextRoom),
    now,
  );
}

function rejectStale(room: Room, seat: number, conn: string, now: number): RoomStepResult {
  const out: Outbound[] = [
    { to: { conn }, msg: { type: 'error', key: 'online.error.staleAction' } },
  ];
  if (room.game !== null && seat >= 0 && room.seats.some((candidate) => candidate.seat === seat))
    out.push({ to: seat, msg: viewForSeat(room, seat) });
  return result(room, out, now);
}

export function roomStep(room: Room, input: RoomInput, now: number): RoomStepResult {
  if (input.kind === 'alarm') return alarm(room, now);
  if (input.kind === 'connect') return connectedRoom(room, input.seat, now);
  if (input.kind === 'disconnect') return disconnectedRoom(room, input.seat, now);

  if (input.msg.type === 'claim') {
    const claimSeat = input.msg.seat;
    const candidate = room.seats.find((seat) => seat.seat === claimSeat);
    if (
      input.seat !== null ||
      input.newTokenHash === undefined ||
      candidate?.kind !== 'human' ||
      candidate.controller !== 'botTakeover'
    ) {
      return result(
        room,
        [{ to: { conn: input.conn }, msg: { type: 'error', key: 'online.error.cannotClaim' } }],
        now,
      );
    }
    let nextRoom: Room = {
      ...room,
      seats: room.seats.map((seat) =>
        seat.seat === candidate.seat
          ? { ...reclaimSeat(seat), connected: true, tokenHash: input.newTokenHash! }
          : seat,
      ),
      lastActivityAt: now,
    };
    if (nextRoom.status === 'playing') nextRoom = syncIdleDeadlines(nextRoom, now);
    const out: Outbound[] = [
      { to: { conn: input.conn }, msg: { type: 'welcome', seat: candidate.seat } },
    ];
    if (nextRoom.game !== null)
      out.push({ to: { conn: input.conn }, msg: viewForSeat(nextRoom, candidate.seat) });
    return result(nextRoom, out, now);
  }

  if (input.msg.type === 'reclaim') {
    const seat = room.seats.find((candidate) => candidate.seat === input.seat);
    if (seat?.kind !== 'human' || seat.controller !== 'botTakeover') {
      return result(
        room,
        [{ to: { conn: input.conn }, msg: { type: 'error', key: 'online.error.notAvailable' } }],
        now,
      );
    }
    let nextRoom: Room = {
      ...room,
      seats: room.seats.map((candidate) =>
        candidate.seat === seat.seat ? { ...reclaimSeat(candidate), connected: true } : candidate,
      ),
      lastActivityAt: now,
    };
    if (nextRoom.status === 'playing') nextRoom = syncIdleDeadlines(nextRoom, now);
    return result(
      nextRoom,
      nextRoom.game === null ? [lobbyBroadcast(nextRoom)] : gameViews(nextRoom),
      now,
    );
  }

  if (input.msg.type === 'join' || input.msg.type === 'setClass' || input.msg.type === 'start') {
    const lobbyResult = lobbyMessage(
      room,
      input.seat ?? -1,
      input.conn,
      input.msg,
      now,
      input.seed,
      input.newTokenHash,
    );
    if (input.msg.type === 'start' && lobbyResult.room?.status === 'playing') {
      try {
        const played = runBotChain(lobbyResult.room, now);
        return {
          ...played,
          out: [...lobbyResult.out.filter((item) => item.msg.type !== 'view'), ...played.out],
        };
      } catch (err) {
        if (err instanceof BotExecutionError) logBotExecutionError(lobbyResult.room, err);
        else console.error('[room]', room.code, input.seat, 'start', err);
        return result(
          room,
          [
            { to: { conn: input.conn }, msg: { type: 'error', key: 'online.error.server' } },
            lobbyBroadcast(room),
          ],
          now,
        );
      }
    }
    return {
      ...lobbyResult,
      nextAlarmAt: lobbyResult.room === null ? null : nextRoomAlarmAt(lobbyResult.room, now),
    };
  }

  if (input.msg.type === 'action') {
    if (
      room.status !== 'playing' ||
      room.game === null ||
      room.seats.find((seat) => seat.seat === input.seat)?.controller !== 'player'
    )
      return playAction(room, input.seat ?? -1, input.conn, input.msg.action, now);
    if (input.msg.turn !== room.turn) return rejectStale(room, input.seat ?? -1, input.conn, now);
    return playAction(room, input.seat ?? -1, input.conn, input.msg.action, now);
  }
  return result(
    room,
    [{ to: { conn: input.conn }, msg: { type: 'error', key: 'online.error.notAvailable' } }],
    now,
  );
}

export function isClassId(value: string): value is ClassId {
  return ['knight', 'thief', 'mage', 'cleric'].includes(value);
}
