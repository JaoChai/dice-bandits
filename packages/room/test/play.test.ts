import { legalActions } from '@dice-bandits/engine';
import { describe, expect, it, vi } from 'vitest';
import { createRoom } from '../src/model';
import { roomStep } from '../src/roomStep';
import type { Room, RoomSeat } from '../src/model';
import type { RoomInput } from '../src/roomStep';

const msg = (
  seat: number | null,
  conn: string,
  message: Extract<RoomInput, { kind: 'msg' }>['msg'],
  extras: Partial<Extract<RoomInput, { kind: 'msg' }>> = {},
): RoomInput => ({ kind: 'msg', seat, conn, msg: message, ...extras });

function startRoom(config: Partial<Room['config']> = {}): Room {
  const lobby = createRoom('ABCDE', 'Ada', 'hash-0', 100, config);
  const started = roomStep(
    lobby,
    msg(0, 'host', { type: 'start' }, { seed: 'task-3-fixed-seed' }),
    110,
  );
  return started.room!;
}

function actionInput(room: Room, seat: number, action: unknown, turn = room.turn): RoomInput {
  return msg(seat, `conn-${seat}`, { type: 'action', action, turn } as never);
}

function hasError(result: ReturnType<typeof roomStep>, key: string): boolean {
  return result.out.some(
    (item) => item.msg.type === 'error' && item.msg.key === `online.error.${key}`,
  );
}

function botFirstRoom(): Room {
  const room = startRoom();
  const seats: RoomSeat[] = room.seats.map((seat) =>
    seat.seat === 0 ? { ...seat, controller: 'botTakeover' } : seat,
  );
  return { ...room, seats };
}

describe('server-authoritative play', () => {
  it('rejects an action from a seat that is not the acting seat without changing room', () => {
    const room = startRoom();
    const actingSeat = room.game!.turnSeat;
    const wrongSeat = (actingSeat + 1) % 4;
    const before = structuredClone(room);
    const result = roomStep(
      room,
      actionInput(room, wrongSeat, legalActions(room.game!, actingSeat)[0]),
      120,
    );
    expect(result.room).toEqual(before);
    expect(hasError(result, 'notYourTurn')).toBe(true);
  });

  it('rejects a stale turn without changing room', () => {
    const room = startRoom();
    const seat = room.game!.turnSeat;
    const before = structuredClone(room);
    const result = roomStep(
      room,
      actionInput(room, seat, legalActions(room.game!, seat)[0], room.turn - 1),
      120,
    );
    expect(result.room).toEqual(before);
    expect(hasError(result, 'staleAction')).toBe(true);
  });

  it('rejects an illegal action without changing room', () => {
    const room = startRoom();
    const seat = room.game!.turnSeat;
    const before = structuredClone(room);
    const result = roomStep(
      room,
      actionInput(room, seat, { type: 'roll', extra: 'not-legal' }),
      120,
    );
    expect(result.room).toEqual(before);
    expect(hasError(result, 'illegalAction')).toBe(true);
  });

  it('rejects actions from bot-controlled seats', () => {
    const room = botFirstRoom();
    const before = structuredClone(room);
    const seat = room.game!.turnSeat;
    const result = roomStep(room, actionInput(room, seat, legalActions(room.game!, seat)[0]), 120);
    expect(result.room).toEqual(before);
    expect(hasError(result, 'notYourTurn')).toBe(true);
  });

  it('starts with a player-controlled turn or has already finished', () => {
    const room = createRoom('ABCDE', 'Ada', 'hash-0', 100);
    const result = roomStep(
      room,
      msg(0, 'host', { type: 'start' }, { seed: 'task-3-fixed-seed' }),
      110,
    );
    const started = result.room!;
    const actingSeat =
      started.game!.phase.kind === 'pvpReward'
        ? started.game!.phase.winner
        : started.game!.turnSeat;
    expect(
      started.status === 'finished' || started.seats[actingSeat]!.controller === 'player',
    ).toBe(true);
  });

  it('plays a one-human three-bot game to completion from legal human actions', () => {
    let room = startRoom();
    const errors: unknown[] = [];
    for (let guard = 0; room.status !== 'finished' && guard < 5000; guard += 1) {
      const game = room.game!;
      const seat = game.phase.kind === 'pvpReward' ? game.phase.winner : game.turnSeat;
      if (room.seats[seat]!.controller !== 'player') {
        const acted = roomStep(room, { kind: 'alarm' }, 120 + guard);
        errors.push(...acted.out.filter((item) => item.msg.type === 'error'));
        room = acted.room!;
        continue;
      }
      const legal = legalActions(game, seat);
      const result = roomStep(room, actionInput(room, seat, legal[0]), 120 + guard);
      errors.push(...result.out.filter((item) => item.msg.type === 'error'));
      room = result.room!;
    }
    expect(room.status).toBe('finished');
    expect(errors).toEqual([]);
  });

  it('rolls back the whole human input if a bot step in its chain throws', async () => {
    const engine = await import('@dice-bandits/engine');
    const originalStep = engine.step;
    let calls = 0;
    const stepSpy = vi.spyOn(engine, 'step').mockImplementation((state, action) => {
      calls += 1;
      if (calls === 2) throw new Error('injected bot step failure');
      const result = originalStep(state, action);
      return { ...result, state: { ...result.state, turnSeat: 1, phase: { kind: 'awaitRoll' } } };
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const room = startRoom();
      const before = structuredClone(room);
      const result = roomStep(room, actionInput(room, 0, legalActions(room.game!, 0)[0]), 120);
      expect(calls).toBe(2);
      expect(result.room).toEqual(before);
      expect(hasError(result, 'server')).toBe(true);
      expect(log).toHaveBeenCalledWith(
        '[room]',
        room.code,
        1,
        expect.any(String),
        expect.any(Error),
      );
    } finally {
      stepSpy.mockRestore();
      log.mockRestore();
    }
  });

  it('backs off alarm bot failures and stops after three consecutive failures', async () => {
    const engine = await import('@dice-bandits/engine');
    const stepSpy = vi.spyOn(engine, 'step').mockImplementation(() => {
      throw new Error('injected alarm bot failure');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      let room = startRoom();
      room = {
        ...room,
        pendingBotWork: true,
        seats: room.seats.map((seat) => ({ ...seat, controller: 'botTakeover' as const })),
      };
      let now = 777;
      for (const delay of [1_000, 5_000]) {
        const result = roomStep(room, { kind: 'alarm' }, now);
        expect(result.room!.pendingBotWork).toBe(true);
        expect(result.room!.botFailures).toBeGreaterThan(0);
        expect(result.nextAlarmAt).toBe(now + delay);
        expect(result.out).toEqual([]);
        room = result.room!;
        now += delay;
      }
      const final = roomStep(room, { kind: 'alarm' }, now);
      expect(final.room!.pendingBotWork).toBe(false);
      expect(final.room!.botFailures).toBe(0);
      expect(final.nextAlarmAt).not.toBe(now);
      expect(
        final.out.filter(
          (item) => item.msg.type === 'error' && item.msg.key === 'online.error.server',
        ),
      ).toHaveLength(4);
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      stepSpy.mockRestore();
      log.mockRestore();
    }
  });

  it('rolls back start if its immediate bot chain throws', async () => {
    const engine = await import('@dice-bandits/engine');
    const stepSpy = vi.spyOn(engine, 'step').mockImplementation(() => {
      throw new Error('injected start bot failure');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const room = {
        ...createRoom('ABCDE', 'Ada', 'hash-0', 100),
        seats: createRoom('ABCDE', 'Ada', 'hash-0', 100).seats.map((seat) => ({
          ...seat,
          controller: 'botTakeover' as const,
        })),
      };
      const before = structuredClone(room);
      const result = roomStep(
        room,
        msg(0, 'host', { type: 'start' }, { seed: 'start-failure-seed' }),
        120,
      );
      expect(result.room).toEqual(before);
      expect(hasError(result, 'server')).toBe(true);
      expect(log).toHaveBeenCalledWith(
        '[room]',
        room.code,
        0,
        expect.any(String),
        expect.any(Error),
      );
    } finally {
      stepSpy.mockRestore();
      log.mockRestore();
    }
  });

  it('caps bot work per input and resumes it on alarms', () => {
    let room = startRoom({ botBatch: 3 });
    room = {
      ...room,
      pendingBotWork: true,
      seats: room.seats.map((seat) => ({ ...seat, controller: 'botTakeover' as const })),
    };
    let result = roomStep(room, { kind: 'alarm' }, 500);
    expect(result.room?.turn).toBe(room.turn + 3);
    expect(result.room?.pendingBotWork).toBe(true);
    expect(result.nextAlarmAt).toBe(500);
    let guard = 0;
    while (result.room?.status !== 'finished' && guard++ < 2000) {
      result = roomStep(result.room!, { kind: 'alarm' }, 500 + guard);
    }
    expect(result.room?.status).toBe('finished');
    expect(guard).toBeLessThan(2000);
  });

  it('does not persist or advance state when the engine step throws', async () => {
    const engine = await import('@dice-bandits/engine');
    const stepSpy = vi.spyOn(engine, 'step').mockImplementation(() => {
      throw new Error('injected step failure');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const room = startRoom();
      const seat = room.game!.turnSeat;
      const before = structuredClone(room);
      const result = roomStep(
        room,
        actionInput(room, seat, legalActions(room.game!, seat)[0]),
        120,
      );
      expect(result.room).toEqual(before);
      expect(hasError(result, 'server')).toBe(true);
      expect(log).toHaveBeenCalledWith(
        '[room]',
        room.code,
        seat,
        room.game!.phase.kind,
        expect.any(Error),
      );
    } finally {
      stepSpy.mockRestore();
      log.mockRestore();
    }
  });
});
