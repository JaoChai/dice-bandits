import { chooseAction, legalActions, step } from '@dice-bandits/engine';
import type { Action, GameEvent } from '@dice-bandits/engine';
import type { Outbound } from './roomStep';
import type { Room } from './model';
import { nextRoomAlarmAt, publicSeat } from './model';
import type { ServerMsg } from './protocol';
import { redactBattlePickEvents, redactGameState } from './redact';
import { syncIdleDeadlines } from './timers';

export interface PlayResult {
  room: Room;
  out: Outbound[];
  nextAlarmAt: number | null;
}

type RejectedPlay = PlayResult & { rejected: true };

export class BotExecutionError extends Error {
  constructor(
    readonly seat: number,
    readonly phase: string,
    readonly cause: unknown,
  ) {
    super('bot action failed');
  }
}

export function logBotExecutionError(room: Room, error: BotExecutionError): void {
  console.error('[room]', room.code, error.seat, error.phase, error.cause);
}

export function viewForSeat(room: Room, seat: number): ServerMsg {
  const game = room.game!;
  const redacted = redactGameState(game, seat);
  return {
    type: 'view',
    turn: room.turn,
    state: redacted.state,
    you: seat,
    legal: legalActions(game, seat),
    seats: room.seats.map(publicSeat),
    opponentPicked: redacted.opponentPicked,
  };
}

export function seatsForVisitor(room: Room): ServerMsg {
  return { type: 'seats', seats: room.seats.map(publicSeat) };
}

function views(room: Room): Outbound[] {
  return room.seats.map((seat) => ({ to: seat.seat, msg: viewForSeat(room, seat.seat) }));
}

function availableBotSeat(room: Room): number | null {
  if (room.game === null || room.status === 'finished') return null;
  return (
    room.seats.find(
      (seat) => seat.controller !== 'player' && legalActions(room.game!, seat.seat).length > 0,
    )?.seat ?? null
  );
}

function finishIfOver(room: Room): Room {
  return room.game?.phase.kind === 'gameOver' ? { ...room, status: 'finished' } : room;
}

function outbound(room: Room, events: GameEvent[]): Outbound[] {
  const result: Outbound[] = room.seats.map((seat) => ({
    to: seat.seat,
    msg: {
      type: 'events',
      turn: room.turn,
      events: redactBattlePickEvents(events, room.game!, seat.seat),
    },
  }));
  result.push(...views(room));
  return result;
}

export function runBotChain(
  room: Room,
  now: number,
  initialEvents: GameEvent[] = [],
  resetIdleSeats: readonly number[] = [],
): PlayResult {
  let nextRoom = room;
  const events = [...initialEvents];
  let steps = 0;
  while (steps < nextRoom.config.botBatch) {
    const seat = availableBotSeat(nextRoom);
    if (seat === null) break;
    const phase = nextRoom.game!.phase.kind;
    try {
      const action = chooseAction(nextRoom.game!, seat);
      const result = step(nextRoom.game!, action);
      nextRoom = { ...nextRoom, game: result.state, turn: nextRoom.turn + 1 };
      events.push(...result.events);
      steps += 1;
      nextRoom = finishIfOver(nextRoom);
      if (nextRoom.status === 'finished') break;
    } catch (err) {
      throw new BotExecutionError(seat, phase, err);
    }
  }
  const pendingBotWork = nextRoom.status !== 'finished' && availableBotSeat(nextRoom) !== null;
  nextRoom = { ...nextRoom, pendingBotWork, botFailures: 0, botRetryAt: null };
  nextRoom = syncIdleDeadlines(nextRoom, now, resetIdleSeats);
  return {
    room: nextRoom,
    out: outbound(nextRoom, events),
    nextAlarmAt: nextRoomAlarmAt(nextRoom, now),
  };
}

function structurallyEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => structurallyEqual(value, b[index]))
    );
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => key in bRecord && structurallyEqual(aRecord[key], bRecord[key]))
  );
}

function reject(room: Room, seat: number, conn: string, key: string, now: number): RejectedPlay {
  const out: Outbound[] = [{ to: { conn }, msg: { type: 'error', key: `online.error.${key}` } }];
  if (room.game !== null && seat >= 0 && room.seats.some((item) => item.seat === seat))
    out.push({ to: seat, msg: viewForSeat(room, seat) });
  return { room, out, nextAlarmAt: nextRoomAlarmAt(room, now), rejected: true };
}

export function playAction(
  room: Room,
  seat: number,
  conn: string,
  action: Action,
  now: number,
): PlayResult | RejectedPlay {
  if (room.status !== 'playing' || room.game === null || room.seats[seat]?.controller !== 'player')
    return reject(room, seat, conn, 'notYourTurn', now);
  const legal = legalActions(room.game, seat);
  if (legal.length === 0) return reject(room, seat, conn, 'notYourTurn', now);
  if (!legal.some((candidate) => structurallyEqual(candidate, action)))
    return reject(room, seat, conn, 'illegalAction', now);
  try {
    const result = step(room.game, action);
    const afterStep = finishIfOver({
      ...room,
      game: result.state,
      turn: room.turn + 1,
      lastActivityAt: now,
      pendingBotWork: false,
    });
    return runBotChain(afterStep, now, result.events, [seat]);
  } catch (err) {
    if (err instanceof BotExecutionError) logBotExecutionError(room, err);
    else console.error('[room]', room.code, seat, room.game.phase.kind, err);
    return {
      room,
      out: [
        { to: { conn }, msg: { type: 'error', key: 'online.error.server' } },
        { to: seat, msg: viewForSeat(room, seat) },
      ],
      nextAlarmAt: nextRoomAlarmAt(room, now),
    };
  }
}
