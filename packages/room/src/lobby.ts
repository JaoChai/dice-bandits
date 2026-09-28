import { createGame, legalActions } from '@dice-bandits/engine';
import type { ClassId, Personality, SeatConfig } from '@dice-bandits/engine';
import { publicSeat } from './model';
import type { Room } from './model';
import type { ServerMsg } from './protocol';

const CLASSES: readonly ClassId[] = ['knight', 'thief', 'mage', 'cleric'];
const PERSONALITIES: readonly Personality[] = ['greedy', 'vengeful', 'cowardly'];

export type RoomOutput = { to: 'all' | number | { conn: string }; msg: ServerMsg };
export interface LobbyResult {
  room: Room | null;
  out: RoomOutput[];
  nextAlarmAt: number | null;
}

function lobby(room: Room): RoomOutput {
  return {
    to: 'all',
    msg: { type: 'lobby', code: room.code, host: room.host, seats: room.seats.map(publicSeat) },
  };
}

function error(conn: string, key: string): RoomOutput {
  return { to: { conn }, msg: { type: 'error', key: `online.error.${key}` } };
}

function alarmAt(room: Room): number | null {
  const deadlines = room.seats.flatMap((seat) =>
    seat.disconnectDeadline === null ? [] : [seat.disconnectDeadline],
  );
  return deadlines.length === 0 ? null : Math.min(...deadlines);
}

export function lobbyMessage(
  room: Room,
  seat: number,
  conn: string,
  message:
    { type: 'join'; name: string } | { type: 'setClass'; classId: ClassId } | { type: 'start' },
  now: number,
  seed?: string,
  newTokenHash?: string,
): LobbyResult {
  const out: RoomOutput[] = [];
  if (message.type === 'join') {
    const name = message.name.trim();
    const nextSeat = Array.from({ length: 4 }, (_, index) => index).find(
      (index) => !room.seats.some((item) => item.seat === index),
    );
    if (room.status !== 'lobby' || nextSeat === undefined || !name || newTokenHash === undefined) {
      out.push(error(conn, 'roomFull'));
      return { room, out, nextAlarmAt: alarmAt(room) };
    }
    const seat = nextSeat;
    const joined: Room['seats'][number] = {
      seat,
      name,
      classId:
        CLASSES.find((classId) => !room.seats.some((item) => item.classId === classId)) ?? 'knight',
      kind: 'human',
      controller: 'player',
      connected: true,
      tokenHash: newTokenHash,
      disconnectDeadline: null,
      idleDeadline: null,
    };
    const nextRoom = { ...room, seats: [...room.seats, joined], lastActivityAt: now };
    out.push({ to: { conn }, msg: { type: 'welcome', seat } }, lobby(nextRoom));
    return { room: nextRoom, out, nextAlarmAt: alarmAt(nextRoom) };
  }

  if (message.type === 'setClass') {
    const ownSeat = room.seats.find((item) => item.seat === seat);
    if (room.status !== 'lobby' || ownSeat === undefined || ownSeat.kind !== 'human') {
      out.push(error(conn, 'invalidSeat'));
      return { room, out, nextAlarmAt: alarmAt(room) };
    }
    const nextRoom = {
      ...room,
      seats: room.seats.map((item) =>
        item.seat === seat ? { ...item, classId: message.classId } : item,
      ),
      lastActivityAt: now,
    };
    out.push(lobby(nextRoom));
    return { room: nextRoom, out, nextAlarmAt: alarmAt(nextRoom) };
  }

  if (seat !== room.host) {
    out.push(error(conn, 'notHost'));
    return { room, out, nextAlarmAt: alarmAt(room) };
  }
  if (room.status !== 'lobby' || seed === undefined) {
    out.push(error(conn, room.status !== 'lobby' ? 'gameStarted' : 'invalidRequest'));
    return { room, out, nextAlarmAt: alarmAt(room) };
  }
  const occupied = new Set(room.seats.map((item) => item.classId));
  const botSeats: SeatConfig[] = [];
  for (let seatNumber = 0; seatNumber < 4; seatNumber += 1) {
    const existing = room.seats.find((item) => item.seat === seatNumber);
    if (existing) {
      botSeats.push({
        name: existing.name,
        classId: existing.classId,
        control: 'human',
        personality: null,
      });
      continue;
    }
    const classId =
      CLASSES.find((id) => !occupied.has(id)) ?? CLASSES[seatNumber % CLASSES.length]!;
    occupied.add(classId);
    const index = botSeats.filter((item) => item.control === 'bot').length;
    botSeats.push({
      name: `Bot ${seatNumber + 1}`,
      classId,
      control: 'bot',
      personality: PERSONALITIES[index % PERSONALITIES.length]!,
    });
  }
  const game = createGame({ seed, seats: botSeats, rounds: 12 });
  const nextSeats = botSeats.map((botSeat, seatNumber): Room['seats'][number] => {
    const existing = room.seats.find((item) => item.seat === seatNumber);
    return (
      existing ?? {
        seat: seatNumber,
        name: botSeat.name,
        classId: botSeat.classId,
        kind: 'bot',
        controller: 'bot',
        connected: false,
        tokenHash: null,
        disconnectDeadline: null,
        idleDeadline: null,
      }
    );
  });
  const nextRoom = {
    ...room,
    status: 'playing' as const,
    seats: nextSeats,
    game,
    turn: 0,
    lastActivityAt: now,
  };
  for (let seatNumber = 0; seatNumber < 4; seatNumber += 1) {
    out.push({
      to: seatNumber,
      msg: {
        type: 'view',
        turn: 0,
        state: game,
        you: seatNumber,
        legal: legalActions(game, seatNumber),
        seats: nextRoom.seats.map(publicSeat),
      },
    });
  }
  return { room: nextRoom, out, nextAlarmAt: alarmAt(nextRoom) };
}
