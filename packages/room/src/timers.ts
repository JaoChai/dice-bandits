import { legalActions } from '@dice-bandits/engine';
import type { Room, RoomSeat } from './model';

export function syncIdleDeadlines(room: Room, now: number): Room {
  if (room.status !== 'playing' || room.game === null) {
    return { ...room, seats: room.seats.map((seat) => ({ ...seat, idleDeadline: null })) };
  }
  const actingSeats = new Set(
    room.seats
      .filter(
        (seat) => seat.controller === 'player' && legalActions(room.game!, seat.seat).length > 0,
      )
      .map((seat) => seat.seat),
  );
  return {
    ...room,
    seats: room.seats.map((seat) => ({
      ...seat,
      idleDeadline: actingSeats.has(seat.seat) ? now + room.config.idleMs : null,
    })),
  };
}

export function startTakeover(seat: RoomSeat): RoomSeat {
  return { ...seat, controller: 'botTakeover', disconnectDeadline: null, idleDeadline: null };
}

export function reclaimSeat(seat: RoomSeat): RoomSeat {
  return { ...seat, controller: 'player', disconnectDeadline: null, idleDeadline: null };
}
