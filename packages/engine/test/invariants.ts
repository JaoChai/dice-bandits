import { expect } from 'vitest';
import type { GameState } from '../src/types';

/** Deep invariants every legal GameState must hold; called in tests after each step. */
export function assertInvariants(state: GameState): void {
  // gold never negative
  for (const p of state.players) expect(p.gold).toBeGreaterThanOrEqual(0);
  // hp within [0, maxHp]
  for (const p of state.players) {
    expect(p.hp).toBeGreaterThanOrEqual(0);
    expect(p.hp).toBeLessThanOrEqual(p.stats.maxHp);
  }
  // turnSeat valid
  expect(state.turnSeat).toBeGreaterThanOrEqual(0);
  expect(state.turnSeat).toBeLessThan(state.players.length);
  // round within game length
  expect(state.round).toBeLessThanOrEqual(state.config.rounds);
  // state must survive a structured-clone round-trip unchanged (serialisable, no live refs)
  expect(structuredClone(state)).toEqual(state);
}
