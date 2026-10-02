import { describe, it, expect } from 'vitest';
import { seedRng, nextFloat, nextInt, shuffle, weightedPick } from '../src/rng';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = seedRng('abc'),
      b = seedRng('abc');
    expect(nextFloat(a)[0]).toBe(nextFloat(b)[0]);
  });
  it('differs between seeds', () => {
    expect(nextFloat(seedRng('a'))[0]).not.toBe(nextFloat(seedRng('b'))[0]);
  });
  it('does not mutate input state', () => {
    const s = seedRng('x');
    const copy = [...s];
    nextFloat(s);
    expect(s).toEqual(copy);
  });
  it('nextInt stays in inclusive range and hits both ends', () => {
    let s = seedRng('range');
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const [v, n] = nextInt(s, 1, 6);
      s = n;
      seen.add(v);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('shuffle is a permutation', () => {
    const [out] = shuffle(seedRng('s'), [1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it('weightedPick only returns keys of the weight table', () => {
    let s = seedRng('weights');
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const [v, n] = weightedPick(s, { town: 3, monster: 4 });
      s = n;
      seen.add(v);
    }
    expect([...seen].sort()).toEqual(['monster', 'town']);
  });
  it('weightedPick honours weights (heavier key drawn more often)', () => {
    let s = seedRng('weights2');
    let town = 0;
    let monster = 0;
    for (let i = 0; i < 6000; i++) {
      const [v, n] = weightedPick(s, { town: 3, monster: 4 });
      s = n;
      if (v === 'town') town++;
      else monster++;
    }
    expect(monster).toBeGreaterThan(town);
    const share = monster / (monster + town);
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(0.66);
  });
  it('weightedPick is deterministic per seed and does not mutate input state', () => {
    const s = seedRng('wdet');
    const copy = [...s];
    expect(weightedPick(s, { a: 1, b: 2 })[0]).toBe(weightedPick(s, { a: 1, b: 2 })[0]);
    expect(s).toEqual(copy);
  });
  it('state is JSON round-trippable', () => {
    const s = seedRng('j');
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
