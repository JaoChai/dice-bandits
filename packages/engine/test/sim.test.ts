import { describe, expect, it } from 'vitest';
import { runSimulation } from '../src/sim';

describe('simulation driver', () => {
  it('finishes 50 deterministic seeded games without crashes or stuck games', () => {
    const report = runSimulation({ games: 50, seedPrefix: 'ci', players: 4 });
    expect(report.games).toBe(50);
    expect(report.crashes).toBe(0);
    expect(report.stuck).toBe(0);
    expect(report.classWinRate).toEqual(
      expect.objectContaining({
        knight: expect.any(Number),
        thief: expect.any(Number),
        mage: expect.any(Number),
        cleric: expect.any(Number),
      }),
    );
  });
});
