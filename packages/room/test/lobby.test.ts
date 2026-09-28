import { describe, expect, it } from 'vitest';
import { createRoom, MAX_SEATS } from '../src/model';
import { roomStep } from '../src/roomStep';
import type { RoomInput } from '../src/roomStep';

const makeRoom = () => createRoom('ABCDE', 'Ada', 'hash-0', 100);
const msg = (
  seat: number | null,
  conn: string,
  message: Extract<RoomInput, { kind: 'msg' }>['msg'],
  newTokenHash?: string,
  seed?: string,
): RoomInput => ({
  kind: 'msg',
  seat,
  conn,
  msg: message,
  ...(newTokenHash === undefined ? {} : { newTokenHash }),
  ...(seed === undefined ? {} : { seed }),
});

function addPlayer(room = makeRoom(), name = 'Bea', conn = 'conn-1') {
  return roomStep(room, msg(null, conn, { type: 'join', name }, `hash-${conn}`), 110);
}

describe('room lobby reducer', () => {
  it('joins the next seat, welcomes only that connection, then broadcasts lobby', () => {
    const result = addPlayer();
    expect(result.room?.seats.map((seat) => seat.name)).toEqual(['Ada', 'Bea']);
    expect(result.out[0]).toEqual({ to: { conn: 'conn-1' }, msg: { type: 'welcome', seat: 1 } });
    expect(result.out.some((item) => item.to === 'all' && item.msg.type === 'lobby')).toBe(true);
  });

  it('rejects a fifth join with roomFull', () => {
    let room = makeRoom();
    for (let seat = 1; seat < MAX_SEATS; seat += 1) {
      const result = addPlayer(room, `P${seat}`, `c${seat}`);
      room = result.room!;
    }
    const result = addPlayer(room, 'Full', 'overflow');
    expect(result.room?.seats).toHaveLength(4);
    expect(result.out).toContainEqual({
      to: { conn: 'overflow' },
      msg: { type: 'error', key: 'online.error.roomFull' },
    });
  });

  it('allows only a seat to set its own class', () => {
    const joined = addPlayer();
    const room = joined.room!;
    const changed = roomStep(room, msg(1, 'conn-1', { type: 'setClass', classId: 'mage' }), 121);
    expect(changed.room?.seats[0]?.classId).toBe('knight');
    expect(changed.room?.seats[1]?.classId).toBe('mage');
    expect(changed.out.some((item) => item.to === 'all' && item.msg.type === 'lobby')).toBe(true);
  });

  it('rejects start by a non-host', () => {
    const room = addPlayer().room!;
    const result = roomStep(room, msg(1, 'conn-1', { type: 'start' }), 130);
    expect(result.room?.status).toBe('lobby');
    expect(result.out).toContainEqual({
      to: { conn: 'conn-1' },
      msg: { type: 'error', key: 'online.error.notHost' },
    });
  });

  it('starts with bot-filled seats, unused classes, cycling personalities and per-seat views', () => {
    let room = makeRoom();
    room = addPlayer(room, 'Bea', 'b').room!;
    room = roomStep(room, msg(1, 'b', { type: 'setClass', classId: 'thief' }), 120).room!;
    const result = roomStep(room, msg(0, 'host', { type: 'start' }, undefined, 'fixed-seed'), 140);
    const started = result.room!;
    expect(started.status).toBe('playing');
    expect(started.seats.map((seat) => seat.kind)).toEqual(['human', 'human', 'bot', 'bot']);
    expect(started.game?.config.rounds).toBe(12);
    expect(
      started.game?.config.seats.slice(2).map((seat) => [seat.classId, seat.personality]),
    ).toEqual([
      ['mage', 'greedy'],
      ['cleric', 'vengeful'],
    ]);
    expect(started.game?.config.seats.slice(0, 2).map((seat) => seat.control)).toEqual([
      'human',
      'human',
    ]);
    expect(result.out.filter((item) => item.msg.type === 'view')).toHaveLength(4);
    expect(result.out.filter((item) => item.msg.type === 'view').map((item) => item.to)).toEqual([
      0, 1, 2, 3,
    ]);
    const views = result.out.flatMap((item) => (item.msg.type === 'view' ? [item.msg] : []));
    expect(views.every((view) => Array.isArray(view.legal))).toBe(true);
    expect(views.map((view) => view.you)).toEqual([0, 1, 2, 3]);
  });

  it('removes disconnected lobby seats at deadline, transfers host, and deletes an empty room', () => {
    let room = addPlayer().room!;
    const disconnected = roomStep(room, { kind: 'disconnect', seat: 0, conn: 'host' }, 200);
    room = disconnected.room!;
    expect(room.seats[0]?.disconnectDeadline).toBe(200 + room.config.idleMs);
    const removed = roomStep(room, { kind: 'alarm' }, 200 + room.config.idleMs);
    expect(removed.room?.seats.map((seat) => seat.seat)).toEqual([1]);
    expect(removed.room?.host).toBe(1);

    const empty = roomStep(
      removed.room!,
      { kind: 'disconnect', seat: 1, conn: 'conn-1' },
      300 + room.config.idleMs,
    );
    const deleted = roomStep(empty.room!, { kind: 'alarm' }, 300 + 2 * room.config.idleMs);
    expect(deleted.room).toBeNull();
  });
});
