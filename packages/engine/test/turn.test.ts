import { describe, it, expect } from 'vitest';
import { createGame, step, legalActions } from '../src/index';
import { IllegalActionError, type GameConfig } from '../src/types';
import { assertInvariants } from './invariants';

const cfg = (seed = 't1'): GameConfig => ({
  seed,
  rounds: 12,
  seats: [
    { name: 'A', classId: 'knight', control: 'human', personality: null },
    { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
});

describe('turn flow', () => {
  it('creates a valid initial state', () => {
    const s = createGame(cfg());
    assertInvariants(s);
    expect(s.players.every((p) => p.gold === 300 && p.pos === s.board.castleId)).toBe(true);
    expect(s.phase.kind).toBe('awaitRoll');
  });
  it('rejects illegal actions without changing state', () => {
    const s = createGame(cfg());
    const before = JSON.stringify(s);
    expect(() => step(s, { type: 'invest' })).toThrow(IllegalActionError);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('rolling moves the player and emits DiceRolled + Moved', () => {
    const s0 = createGame(cfg());
    const { state, events } = step(s0, { type: 'roll' });
    const roll = events.find((e) => e.type === 'DiceRolled')!;
    expect(Number(roll.params.value)).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.type === 'Moved')).toBe(true);
    expect(state.players[0]!.pos).not.toBe(s0.players[0]!.pos);
    assertInvariants(state);
  });
  it('same seed + same actions ⇒ identical state', () => {
    const run = () => {
      let s = createGame(cfg('det'));
      for (let i = 0; i < 40 && s.phase.kind !== 'gameOver'; i++)
        s = step(s, legalActions(s, s.turnSeat)[0]!).state;
      return s;
    };
    expect(run()).toEqual(run());
  });
  it('step does not mutate input', () => {
    const s = createGame(cfg());
    const snap = structuredClone(s);
    step(s, { type: 'roll' });
    expect(s).toEqual(snap);
  });
  it('state.rng advances after a roll', () => {
    const s0 = createGame(cfg('det'));
    const before = s0.rng;
    const { state } = step(s0, { type: 'roll' });
    expect(state.rng).not.toEqual(before);
  });
  it('dice stream produces varied values across a game', () => {
    let s = createGame(cfg('det'));
    const values: number[] = [];
    for (let i = 0; i < 60 && s.phase.kind !== 'gameOver'; i++) {
      const r = step(s, legalActions(s, s.turnSeat)[0]!);
      for (const e of r.events) if (e.type === 'DiceRolled') values.push(Number(e.params.value));
      s = r.state;
    }
    expect(values.length).toBeGreaterThanOrEqual(8);
    expect(new Set(values).size).toBeGreaterThanOrEqual(3);
  });
});
