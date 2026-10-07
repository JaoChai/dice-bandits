import type { GameEvent, GameState } from '@dice-bandits/engine';

export interface MovementPlan {
  segments: Array<{
    seat: number;
    from: number;
    to: number;
    remaining: number;
    hopMs: number;
    holdMs: number;
  }>;
  landingSeat: number | null;
  landingSpace: number | null;
}

/** Follow actual Moved events and authored space IDs, never roll faces. */
export function planMovement(
  previous: GameState,
  events: readonly GameEvent[],
  mode: 'human' | 'bot' | 'online',
): MovementPlan {
  const plan: MovementPlan = { segments: [], landingSeat: null, landingSpace: null };
  const spaces = new Set(previous.board.spaces.map((space) => space.id));
  const positions = new Map(previous.players.map((player) => [player.seat, player.pos]));
  for (const event of events) {
    if (event.type !== 'Moved' || event.seat === null) continue;
    const from = positions.get(event.seat);
    const { to, remaining } = event.params;
    if (
      from === undefined ||
      typeof to !== 'number' ||
      !spaces.has(to) ||
      to === from ||
      typeof remaining !== 'number' ||
      !Number.isInteger(remaining) ||
      remaining < 0
    )
      continue;
    plan.segments.push({
      seat: event.seat,
      from,
      to,
      remaining: remaining > 0 ? remaining - 1 : 0,
      hopMs: mode === 'human' ? 280 : 120,
      holdMs: mode === 'human' ? 120 : mode === 'bot' ? 40 : 0,
    });
    positions.set(event.seat, to);
    plan.landingSeat = remaining === 0 ? event.seat : null;
    plan.landingSpace = remaining === 0 ? to : null;
  }
  if (mode === 'online') {
    const scale = Math.min(1, 600 / Math.max(1, plan.segments.length * 120));
    for (const segment of plan.segments) segment.hopMs *= scale;
  }
  return plan;
}
