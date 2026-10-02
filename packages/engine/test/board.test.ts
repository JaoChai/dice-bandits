import { describe, it, expect } from 'vitest';
import { generateBoard } from '../src/board';
import { MAP } from '../src/map';

const SEEDS = Array.from({ length: 10_000 }, (_, i) => `seed-${i}`);

const nodeById = (id: number) => {
  const node = MAP.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`MAP has no node ${id}`);
  return node;
};

describe('generateBoard', () => {
  it('is deterministic', () => {
    expect(generateBoard('x')).toEqual(generateBoard('x'));
  });

  it.each([0, 1, 2])('guarantees hold (slice %i)', (slice) => {
    for (const seed of SEEDS.slice(slice * 3334, (slice + 1) * 3334)) {
      const b = generateBoard(seed);
      expect(b.spaces.length).toBe(40);
      expect(b.spaces[b.castleId]?.kind).toBe('castle');
      expect(b.spaces.filter((s) => s.kind === 'castle').length).toBe(1);
      expect(b.spaces.filter((s) => s.kind === 'castle')[0]?.id).toBe(b.castleId);
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
      // fixed graph: ids, pixels, regions, edges match MAP; shop slots fixed
      expect(b.spaces.map((s) => s.id)).toEqual(MAP.nodes.map((n) => n.id).sort((a, z) => a - z));
      for (const s of b.spaces) {
        const node = nodeById(s.id);
        expect(s.x).toBe(node.x);
        expect(s.y).toBe(node.y);
        expect(s.region).toBe(node.region);
        expect(s.next).toEqual([...node.next].sort((a, z) => a - z));
        expect(s.kind === 'shop').toBe(node.slot === 'shop');
      }
      // castle space sits on the castle slot
      expect(nodeById(b.castleId).slot).toBe('castle');
      // free slots never keep a fixed kind
      for (const s of b.spaces) {
        const node = nodeById(s.id);
        if (node.slot === 'free') expect(s.kind).not.toBe('castle');
      }
      const coords = new Set(b.spaces.map((s) => `${s.x},${s.y}`));
      expect(coords.size).toBe(b.spaces.length);
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
});
