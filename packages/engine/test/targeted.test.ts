import { describe, it, expect } from 'vitest';
import { createGame, step, legalActions } from '../src/index';
import { type Action, type GameConfig, type GameEvent, type GameState } from '../src/types';
import { assertInvariants } from './invariants';

function nextAction(state: GameState): Action {
  if (state.phase.kind === 'battle') {
    const battle = state.phase.battle;
    const side =
      battle.pending.attack === null
        ? battle.attackerSide
        : battle.attackerSide === 'a'
          ? 'b'
          : 'a';
    const actor = side === 'a' ? battle.a : battle.b;
    return actor.kind === 'player'
      ? legalActions(state, actor.seat!)[0]!
      : { type: 'battlePick', side, pick: 'attack' };
  }
  return legalActions(state, state.turnSeat)[0]!;
}

function finishTurn(state: GameState): GameState {
  let current = state;
  const seat = state.turnSeat;
  for (let i = 0; i < 100 && current.phase.kind !== 'gameOver' && current.turnSeat === seat; i++) {
    current = step(current, nextAction(current)).state;
  }
  return current;
}

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
    // seed 'fork' deterministically rolls 3 for A: spaces 1, 2 (B stands there →
    // pass-over duelOffer with 2 remaining), 3.
    const s = createGame(cfg('fork'));
    s.players[1]!.pos = 2;
    const r = step(s, { type: 'roll' });
    expect(r.state.phase.kind).toBe('duelOffer');
    expect(r.state.players[0]!.pos).toBe(2); // paused on the passed space
    expect(legalActions(r.state, r.state.turnSeat).map((a) => a.type)).toContain('duel');
    const r2 = step(r.state, { type: 'duel', target: null });
    expect(r2.events.some((e) => e.type === 'DuelDeclined')).toBe(true);
    expect(r2.state.players[0]!.pos).toBe(3); // kept moving, did not stay on B's space
    expect(r2.events.some((e) => e.type === 'BattleStarted')).toBe(true);
    expect(r2.state.phase.kind).toBe('battle'); // landing resolves the monster space
    assertInvariants(r2.state);
  });

  it('a seat with skipTurns: 1 is skipped once with TurnSkipped', () => {
    const s = createGame(cfg('skip'));
    s.players[0]!.skipTurns = 1;
    let st = finishTurn(step(s, { type: 'roll' }).state);
    expect(st.turnSeat).toBe(1); // B's turn now
    // Drive B's turn: roll, then answer any mid-move duelOffer or battle until the turn wraps.
    const events: GameEvent[] = [];
    let rn = step(st, { type: 'roll' });
    events.push(...rn.events);
    st = rn.state;
    for (let i = 0; i < 30 && st.phase.kind !== 'awaitRoll' && st.phase.kind !== 'gameOver'; i++) {
      rn = step(st, nextAction(st));
      events.push(...rn.events);
      st = rn.state;
    }
    expect(st.turnSeat).toBe(1); // wrapped: A skipped, B rolls again
    expect(events.some((e) => e.type === 'TurnSkipped')).toBe(true);
    expect(st.players[0]!.skipTurns).toBe(0);
    assertInvariants(st);
  });

  it('after the last seat of the final round ends, phase is gameOver with seat order', () => {
    const s = createGame(cfg('end'));
    s.round = 12;
    const r = step(s, { type: 'roll' });
    const afterA = finishTurn(r.state);
    expect(afterA.phase.kind).not.toBe('gameOver');
    const r2 = step(afterA, { type: 'roll' });
    const final = finishTurn(r2.state);
    expect(final.phase).toMatchObject({ kind: 'gameOver', ranking: [0, 1] });
    assertInvariants(final);
  });

  it('resolveSpace processes the landed space instead of silently ending the turn', () => {
    const s = createGame(cfg('t1'));
    assertInvariants(s);
    const r2 = step(createGame(cfg('t1')), { type: 'roll' });
    expect(r2.events.some((event) => event.type === 'Moved')).toBe(true);
    expect(['moving', 'chooseBranch', 'duelOffer']).not.toContain(r2.state.phase.kind);
  });
});
