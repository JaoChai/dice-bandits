import { describe, it, expect } from 'vitest';
import { generateBoard } from '../src/board';

const SEEDS = Array.from({ length: 10_000 }, (_, i) => `seed-${i}`);
describe('generateBoard', () => {
  it('is deterministic', () => {
    expect(generateBoard('x')).toEqual(generateBoard('x'));
  });
  it.each([0, 1, 2])('guarantees hold (slice %i)', (slice) => {
    for (const seed of SEEDS.slice(slice * 3334, (slice + 1) * 3334)) {
      const b = generateBoard(seed);
      expect(b.spaces.length).toBeGreaterThanOrEqual(36);
      expect(b.spaces.length).toBeLessThanOrEqual(44);
      expect(b.spaces[b.castleId]?.kind).toBe('castle');
      for (const r of ['meadow', 'desert', 'snow', 'volcano'] as const) {
        const inR = b.spaces.filter((s) => s.region === r);
        expect(inR.filter((s) => s.kind === 'town').length).toBeGreaterThanOrEqual(2);
        expect(inR.filter((s) => s.kind === 'shop').length).toBeGreaterThanOrEqual(1);
      }
      for (const s of b.spaces)
        for (const n of s.next)
          expect(!(s.kind === 'trap' && b.spaces[n]?.kind === 'trap')).toBe(true);
      // reachability from castle
      const seen = new Set([b.castleId]);
      const q = [b.castleId];
      while (q.length)
        for (const n of b.spaces[q.pop()!]!.next)
          if (!seen.has(n)) {
            seen.add(n);
            q.push(n);
          }
      expect(seen.size).toBe(b.spaces.length);
      expect(b.spaces.filter((s) => s.next.length === 2).length).toBe(2);
      const coords = new Set(b.spaces.map((s) => `${s.x},${s.y}`));
      expect(coords.size).toBe(b.spaces.length);
    }
  });
});
