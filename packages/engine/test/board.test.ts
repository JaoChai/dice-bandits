import { describe, it, expect } from 'vitest';
import { generateBoard } from '../src/board';
import { MAP } from '../src/map';

const SEEDS = Array.from({ length: 10_000 }, (_, i) => `seed-${i}`);

// prebuilt once (review round 1, item 1): no per-lookup Array.find
const MAP_BY_ID = new Map(MAP.nodes.map((n) => [n.id, n]));
const MAP_NODES_BY_ID = [...MAP.nodes].sort((a, z) => a.id - z.id);

describe('generateBoard', () => {
  it('is deterministic', () => {
    expect(generateBoard('x')).toEqual(generateBoard('x'));
  });

  it.each([0, 1, 2])('guarantees hold (slice %i)', (slice) => {
    for (const seed of SEEDS.slice(slice * 3334, (slice + 1) * 3334)) {
      const b = generateBoard(seed);
      // one aggregated toEqual per board (review round 1, item 1): ids, pixels,
      // regions, edges, and fixed-slot kinds all come from MAP in one comparison
      expect(b).toEqual({
        castleId: MAP.nodes[0]!.id,
        spaces: MAP_NODES_BY_ID.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          region: n.region,
          next: [...n.next].sort((a, z) => a - z),
          kind: n.slot === 'castle' ? 'castle' : n.slot === 'shop' ? 'shop' : expect.anything(),
        })),
      });
      // exactly one castle space, and it is the castle slot
      expect(b.spaces.filter((s) => s.kind === 'castle').map((s) => s.id)).toEqual([b.castleId]);
      // free slots never keep a fixed kind (the slot bag excludes castle)
      expect(
        b.spaces.some((s) => MAP_BY_ID.get(s.id)!.slot === 'free' && s.kind === 'castle'),
      ).toBe(false);
      for (const r of ['meadow', 'desert', 'snow', 'volcano'] as const) {
        const inR = b.spaces.filter((s) => s.region === r);
        expect(inR.filter((s) => s.kind === 'town').length).toBeGreaterThanOrEqual(2);
        expect(inR.filter((s) => s.kind === 'shop').length).toBeGreaterThanOrEqual(1);
      }
      // no trap->trap edge
      expect(
        b.spaces.some((s) => s.kind === 'trap' && s.next.some((n) => b.spaces[n]!.kind === 'trap')),
      ).toBe(false);
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
      // coordinates are unique
      expect(new Set(b.spaces.map((s) => `${s.x},${s.y}`)).size).toBe(b.spaces.length);
    }
  });

  it('varies kind sequences across seeds for at least 99% of 1000 seed pairs', () => {
    const signatures = Array.from({ length: 1001 }, (_, i) => {
      const board = generateBoard(`pair-${i}`);
      return board.spaces.map((s) => `${s.id}:${s.kind}`).join('|');
    });
    let equalPairs = 0;
    for (let i = 0; i < signatures.length; i++)
      for (let j = i + 1; j < signatures.length; j++)
        if (signatures[i] === signatures[j]) equalPairs++;
    const totalPairs = (signatures.length * (signatures.length - 1)) / 2;
    expect(equalPairs / totalPairs).toBeLessThanOrEqual(0.01);
  });

  it('never throws for adversarial seeds (repair failures retry, not crash)', () => {
    // These seeds exhaust every donor space in a region (probe3-2388: volcano),
    // so repair() throws "no donor space" and generateBoard crashed instead of
    // re-drafting the slot bag in its existing attempt loop.
    for (const seed of ['probe3-2388', 'crash-8641', 'crash-15563'])
      expect(() => generateBoard(seed)).not.toThrow();
    for (let i = 0; i < 2000; i++) expect(() => generateBoard(`crash-${i}`)).not.toThrow();
  });
});
