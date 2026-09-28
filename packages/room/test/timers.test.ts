import { legalActions } from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import { createRoom, nextRoomAlarmAt } from '../src/model';
import { roomStep } from '../src/roomStep';
import type { Room } from '../src/model';
import type { RoomInput } from '../src/roomStep';

const msg = (
  seat: number | null,
  conn: string,
  message: Extract<RoomInput, { kind: 'msg' }>['msg'],
  extras: Partial<Extract<RoomInput, { kind: 'msg' }>> = {},
): RoomInput => ({ kind: 'msg', seat, conn, msg: message, ...extras });

function playingRoom(config: Partial<Room['config']> = {}): Room {
  return roomStep(
    createRoom('ABCDE', 'Ada', 'old-hash', 100, config),
    msg(0, 'host', { type: 'start' }, { seed: 'task-5-fixed-seed' }),
    110,
  ).room!;
}

function expectNoStaleAlarm(result: ReturnType<typeof roomStep>, now: number): void {
  if (result.nextAlarmAt === null || result.nextAlarmAt > now) return;
  expect(result.nextAlarmAt).toBe(now);
  expect(result.room?.pendingBotWork && result.room.botRetryAt === null).toBe(true);
}

function errorKey(result: ReturnType<typeof roomStep>): string | undefined {
  const error = result.out.find((item) => item.msg.type === 'error');
  return error?.msg.type === 'error' ? error.msg.key : undefined;
}

describe('room timers and control transfer', () => {
  it('sets idle deadlines only for player seats with legal actions and refreshes after accepted actions', () => {
    let room = playingRoom({ idleMs: 100 });
    const firstActing = room.game!.turnSeat;
    expect(room.seats[firstActing]!.idleDeadline).toBe(210);
    expect(room.seats.find((seat) => seat.seat !== firstActing)!.idleDeadline).toBeNull();

    const legal = legalActions(room.game!, firstActing);
    const acted = roomStep(
      room,
      msg(firstActing, 'seat', { type: 'action', action: legal[0]!, turn: room.turn }),
      150,
    );
    room = acted.room!;
    expect(room.lastActivityAt).toBe(150);
    expect(room.seats[firstActing]!.idleDeadline).toBe(
      legalActions(room.game!, firstActing).length > 0 ? 250 : null,
    );
    const nextActor =
      room.game!.phase.kind === 'pvpReward' ? room.game!.phase.winner : room.game!.turnSeat;
    if (
      room.seats[nextActor]!.controller === 'player' &&
      legalActions(room.game!, nextActor).length > 0
    )
      expect(room.seats[nextActor]!.idleDeadline).toBe(250);
  });

  it('takes over an idle acting seat at its deadline and the bot plays its pending action', () => {
    const room = playingRoom({ idleMs: 100 });
    const seat = room.game!.turnSeat;
    const deadline = room.seats[seat]!.idleDeadline!;
    const result = roomStep(room, { kind: 'alarm' }, deadline);
    expect(result.room!.seats[seat]!.controller).toBe('botTakeover');
    expect(result.room!.turn).toBeGreaterThan(room.turn);
    expect(
      result.out.some(
        (item) => item.msg.type === 'view' && item.msg.seats[seat]!.controller === 'botTakeover',
      ),
    ).toBe(true);
  });

  it('takes over a playing seat when its disconnect deadline expires and runs the bot', () => {
    const room = playingRoom({ idleMs: 100 });
    const seat = room.game!.turnSeat;
    const disconnected = roomStep(
      room,
      { kind: 'disconnect', seat, conn: `seat-${seat}` },
      300,
    ).room!;
    const deadline = disconnected.seats[seat]!.disconnectDeadline!;
    const result = roomStep(disconnected, { kind: 'alarm' }, deadline);
    expect(result.room!.seats[seat]!.controller).toBe('botTakeover');
    expect(result.room!.seats[seat]!.connected).toBe(false);
    expect(result.room!.turn).toBeGreaterThan(disconnected.turn);
    expect(
      result.out.some(
        (item) => item.msg.type === 'view' && item.msg.seats[seat]!.controller === 'botTakeover',
      ),
    ).toBe(true);
  });

  it('honors an expired disconnect deadline before resuming pending bot work', () => {
    const room = playingRoom({ idleMs: 100 });
    const seat = room.game!.turnSeat;
    const pending = {
      ...room,
      pendingBotWork: true,
      seats: room.seats.map((item) =>
        item.seat === seat ? { ...item, disconnectDeadline: 400 } : item,
      ),
    };

    const result = roomStep(pending, { kind: 'alarm' }, 400);

    expect(result.room!.seats[seat]!.controller).toBe('botTakeover');
    expect(
      result.out.some(
        (item) => item.msg.type === 'view' && item.msg.seats[seat]!.controller === 'botTakeover',
      ),
    ).toBe(true);
  });

  it('starts a fresh idle timer when the seat reclaims mid-game', () => {
    const room = playingRoom({ idleMs: 100 });
    const seat = room.game!.turnSeat;
    const taken = {
      ...room,
      seats: room.seats.map((s) =>
        s.seat === seat ? { ...s, controller: 'botTakeover' as const, idleDeadline: null } : s,
      ),
    };
    const result = roomStep(taken, msg(seat, 'own-conn', { type: 'reclaim' }), 500);
    expect(result.room!.seats[seat]!.controller).toBe('player');
    expect(result.room!.seats[seat]!.idleDeadline).toBe(600);
    expect(result.room!.lastActivityAt).toBe(500);
  });

  it('disconnects and reconnects a playing seat before deadline, automatically reclaiming takeover', () => {
    let room = playingRoom({ idleMs: 100 });
    const seat = 0;
    room = roomStep(room, { kind: 'disconnect', seat, conn: 'last' }, 300).room!;
    expect(room.seats[seat]!.disconnectDeadline).toBe(400);
    expect(room.seats[seat]!.connected).toBe(false);
    room = {
      ...room,
      seats: room.seats.map((s) =>
        s.seat === seat ? { ...s, controller: 'botTakeover' as const } : s,
      ),
    };
    const reconnected = roomStep(room, { kind: 'connect', seat, conn: 'return' }, 350);
    expect(reconnected.room!.seats[seat]!.controller).toBe('player');
    expect(reconnected.room!.seats[seat]!.disconnectDeadline).toBeNull();
    expect(reconnected.room!.seats[seat]!.connected).toBe(true);
    expect(reconnected.room!.lastActivityAt).toBe(350);
  });

  it('claims a bot-takeover human seat with a new token hash and invalidates the old hash', () => {
    const room = playingRoom();
    const taken = {
      ...room,
      seats: room.seats.map((s) =>
        s.seat === 0 ? { ...s, controller: 'botTakeover' as const } : s,
      ),
    };
    const claimed = roomStep(
      taken,
      msg(null, 'visitor', { type: 'claim', seat: 0 }, { newTokenHash: 'new-hash' }),
      600,
    );
    expect(claimed.room!.seats[0]!.tokenHash).toBe('new-hash');
    expect(claimed.room!.seats[0]!.controller).toBe('player');
    expect(claimed.room!.seats[0]!.connected).toBe(true);
    expect(claimed.out).toContainEqual({
      to: { conn: 'visitor' },
      msg: { type: 'welcome', seat: 0 },
    });
    expect(claimed.room!.seats[0]!.tokenHash).not.toBe('old-hash');
  });

  it.each([
    [
      'bot-kind seat',
      (room: Room) =>
        room.seats.map((s) =>
          s.seat === 0 ? { ...s, kind: 'bot' as const, controller: 'botTakeover' as const } : s,
        ),
    ],
    ['player-controlled seat', (room: Room) => room.seats],
  ])('rejects claim of a %s', (_label, change) => {
    const room = playingRoom();
    const candidate = { ...room, seats: change(room) };
    const result = roomStep(
      candidate,
      msg(null, 'visitor', { type: 'claim', seat: 0 }, { newTokenHash: 'new' }),
      700,
    );
    expect(errorKey(result)).toBe('online.error.cannotClaim');
    expect(result.room).toEqual(candidate);
  });

  it('schedules the earliest pending bot, idle, disconnect, and expiry deadline', () => {
    let room = playingRoom({ idleMs: 100, ttlMs: 1000 });
    room = {
      ...room,
      lastActivityAt: 500,
      pendingBotWork: false,
      seats: room.seats.map((seat, index) => ({
        ...seat,
        idleDeadline: index === 0 ? 800 : null,
        disconnectDeadline: index === 1 ? 650 : null,
      })),
    };
    expect(nextRoomAlarmAt(room, 600)).toBe(650);
    expect(
      nextRoomAlarmAt(
        { ...room, seats: room.seats.map((s) => ({ ...s, disconnectDeadline: null })) },
        600,
      ),
    ).toBe(800);
    expect(nextRoomAlarmAt({ ...room, pendingBotWork: true }, 600)).toBe(600);
    expect(
      nextRoomAlarmAt(
        {
          ...room,
          pendingBotWork: false,
          seats: room.seats.map((s) => ({ ...s, idleDeadline: null, disconnectDeadline: null })),
        },
        600,
      ),
    ).toBe(1500);
  });

  it('expires at the TTL deadline and accepted activity pushes expiry out', () => {
    let room = playingRoom({ ttlMs: 1000 });
    const expired = roomStep(room, { kind: 'alarm' }, room.lastActivityAt + 1000);
    expect(expired.room).toBeNull();

    room = { ...room, lastActivityAt: 200 };
    const connected = roomStep(room, { kind: 'connect', seat: 0, conn: 'host' }, 900);
    expect(connected.room!.lastActivityAt).toBe(900);
    expect(connected.nextAlarmAt).toBe(1900);
    expect(roomStep(connected.room!, { kind: 'alarm' }, 1900).room).toBeNull();
  });

  it('clears expired disconnect deadlines for seats already under bot takeover', () => {
    let room = playingRoom({ idleMs: 100 });
    const actor = room.game!.turnSeat;
    const takeover = roomStep(room, { kind: 'alarm' }, room.seats[actor]!.idleDeadline!);
    expectNoStaleAlarm(takeover, room.seats[actor]!.idleDeadline!);
    room = takeover.room!;
    expect(room.seats[actor]!.controller).toBe('botTakeover');
    const disconnected = roomStep(room, { kind: 'disconnect', seat: actor, conn: 'seat' }, 400);
    expectNoStaleAlarm(disconnected, 400);
    room = disconnected.room!;
    const deadline = room.seats[actor]!.disconnectDeadline!;
    const result = roomStep(room, { kind: 'alarm' }, deadline);
    expectNoStaleAlarm(result, deadline);
    expect(result.room!.seats[actor]!.disconnectDeadline).toBeNull();
    expect(result.nextAlarmAt === null || result.nextAlarmAt > deadline).toBe(true);
  });

  it('does not schedule takeover or bot work for finished rooms', () => {
    const playing = playingRoom({ idleMs: 100, ttlMs: 1000 });
    const finished: Room = { ...playing, status: 'finished', pendingBotWork: false };
    const disconnected = roomStep(finished, { kind: 'disconnect', seat: 0, conn: 'seat' }, 300);
    expectNoStaleAlarm(disconnected, 300);
    const result = roomStep(disconnected.room!, { kind: 'alarm' }, 400);
    expectNoStaleAlarm(result, 400);
    expect(result.room!.pendingBotWork).toBe(false);
    expect(result.room!.seats[0]!.controller).toBe('player');
    expect(result.room!.seats[0]!.disconnectDeadline).toBeNull();
    expect(result.nextAlarmAt).toBe(
      disconnected.room!.lastActivityAt + disconnected.room!.config.ttlMs,
    );
  });

  it('does not reset another acting seat idle deadline on a connection change, but refreshes after its action', () => {
    let room = createRoom('ABCDE', 'Ada', 'old-hash', 0, { idleMs: 100 });
    room = roomStep(
      room,
      msg(null, 'visitor', { type: 'join', name: 'Bob' }, { newTokenHash: 'bob-hash' }),
      0,
    ).room!;
    room = roomStep(
      room,
      msg(0, 'host', { type: 'start' }, { seed: 'timer-regression-seed' }),
      0,
    ).room!;
    const actor = room.seats.find((seat) => seat.idleDeadline !== null)!;
    const deadline = actor.idleDeadline!;
    const other = actor.seat === 0 ? 1 : 0;
    room = roomStep(room, { kind: 'disconnect', seat: other, conn: 'other' }, 50).room!;
    room = roomStep(room, { kind: 'connect', seat: other, conn: 'other-return' }, 55).room!;
    expect(room.seats[actor.seat]!.idleDeadline).toBe(deadline);

    const legal = legalActions(room.game!, actor.seat);
    const acted = roomStep(
      room,
      msg(actor.seat, 'actor', { type: 'action', action: legal[0]!, turn: room.turn }),
      60,
    ).room!;
    if (legalActions(acted.game!, actor.seat).length > 0) {
      expect(acted.seats[actor.seat]!.idleDeadline).toBe(160);
    }
  });

  it('refreshes activity for accepted messages but not rejected messages', () => {
    const room = playingRoom({ ttlMs: 1000 });
    const actor = room.game!.turnSeat;
    const legal = legalActions(room.game!, actor);
    const accepted = roomStep(
      room,
      msg(actor, 'player', { type: 'action', action: legal[0]!, turn: room.turn }),
      400,
    );
    expect(accepted.room!.lastActivityAt).toBe(400);
    const rejected = roomStep(
      room,
      msg(actor, 'player', { type: 'action', action: legal[0]!, turn: -1 }),
      500,
    );
    expect(rejected.room!.lastActivityAt).toBe(room.lastActivityAt);
  });
});
