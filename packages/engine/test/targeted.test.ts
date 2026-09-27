import { describe, it, expect } from 'vitest';
import { createGame, step, legalActions } from '../src/index';
import { type GameConfig } from '../src/types';
import { assertInvariants } from './invariants';

const cfg = (seed = 't1'): GameConfig => ({
  seed,
  rounds: 12,
  seats: [
    { name: 'A', classId: 'knight', control: 'human', personality: null },
    { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
});

describe('targeted flow', () => {
  it('fork presents chooseBranch with 2 options and follows the chosen branch', () => {
    // 'fork' seed: forks at 20 (next 23|26) and 31; place A two before fork 20.
    const s = createGame(cfg('fork'));
    s.players[0]!.pos = 20;
    s.players[1]!.pos = 31; // B far away so no duel interference
    const r = step(s, { type: 'roll' });
    expect(r.state.phase.kind).toBe('chooseBranch');
    const ph = r.state.phase;
    if (ph.kind !== 'chooseBranch') throw new Error('unreachable');
    expect(ph.options.sort((a, b) => a - b)).toEqual([23, 26]);
    expect(
      legalActions(r.state, r.state.turnSeat)
        .map((a) => (a as { to: number }).to)
        .sort((a, b) => a - b),
    ).toEqual([23, 26]);
    const r2 = step(r.state, { type: 'chooseBranch', to: 26 });
    expect(r2.events.some((e) => e.type === 'Moved')).toBe(true);
    // continue moving the remaining steps; final pos must lie on the 26 branch or beyond
    let st = r2.state;
    while (st.phase.kind === 'chooseBranch' || st.phase.kind === 'moving') {
      const acts = legalActions(st, st.turnSeat);
      st = step(st, acts[0]!).state;
      if (st.players[0]!.pos === 26) break;
    }
    expect([26, 27, 28]).toContain(st.players[0]!.pos);
    assertInvariants(st);
  });

  it('passing an occupied space offers a duel; duel:null keeps moving', () => {
    const s = createGame(cfg('fork'));
    // A rolls first; put B 2 ahead so A passes them mid-move (not on final space, ideally).
    s.players[1]!.pos = 2;
    const r = step(s, { type: 'roll' });
    if (r.state.phase.kind === 'duelOffer') {
      expect(legalActions(r.state, r.state.turnSeat).map((a) => a.type)).toContain('duel');
      const r2 = step(r.state, { type: 'duel', target: null });
      expect(r2.events.some((e) => e.type === 'DuelDeclined')).toBe(true);
      expect(r2.state.players[0]!.pos).not.toBe(2); // kept moving
      assertInvariants(r2.state);
    } else {
      // roll was 1: landed directly on B — no pass, acceptable, retry with another seed
      expect(r.state.players[0]!.pos).toBe(2);
    }
  });

  it('a seat with skipTurns: 1 is skipped once with TurnSkipped', () => {
    const s = createGame(cfg('skip'));
    s.players[0]!.skipTurns = 1;
    const r = step(s, { type: 'roll' }); // A rolls; stub ends their turn
    expect(r.state.turnSeat).toBe(1); // B's turn now
    // B rolls; when the turn wraps back to A they are skipped -> B again.
    const r2 = step(r.state, { type: 'roll' });
    expect(r2.state.turnSeat).toBe(1); // A skipped, B rolls again
    expect(r2.events.some((e) => e.type === 'TurnSkipped')).toBe(true);
    expect(r2.state.players[0]!.skipTurns).toBe(0);
    assertInvariants(r2.state);
  });

  it('after the last seat of the final round ends, phase is gameOver with seat order', () => {
    const s = createGame(cfg('end'));
    s.round = 12;
    // A rolls and lands (stub resolver ends turn), then B rolls and ends: game over.
    const r = step(s, { type: 'roll' });
    expect(r.state.phase.kind).not.toBe('gameOver');
    const r2 = step(r.state, { type: 'roll' });
    expect(r2.state.phase.kind).toBe('gameOver');
    if (r2.state.phase.kind === 'gameOver') expect(r2.state.phase.ranking).toEqual([0, 1]);
    assertInvariants(r2.state);
  });

  it('stub resolveSpace ends the turn after landing', () => {
    const s = createGame(cfg('t1'));
    assertInvariants(s);
    // after A's single roll the turn must pass to seat 1 via the stub
    const r2 = step(createGame(cfg('t1')), { type: 'roll' });
    expect(r2.state.turnSeat).toBe(1);
    expect(r2.state.phase.kind).toBe('awaitRoll');
  });
});
