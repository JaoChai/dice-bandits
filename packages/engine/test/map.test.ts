import { describe, it, expect } from 'vitest';
import { MAP, validateMap, type MapNode } from '../src/map';
import type { Region } from '../src/types';

const REGIONS: Region[] = ['meadow', 'desert', 'snow', 'volcano'];
const byId = new Map(MAP.nodes.map((n) => [n.id, n]));

function reachable(from: number, next: (n: MapNode) => number[]): Set<number> {
  const seen = new Set<number>([from]);
  const q = [from];
  while (q.length) {
    const cur = byId.get(q.pop()!);
    if (!cur) continue;
    for (const nx of next(cur))
      if (!seen.has(nx)) {
        seen.add(nx);
        q.push(nx);
      }
  }
  return seen;
}

describe('authored map graph', () => {
  it('is valid per validateMap', () => {
    expect(validateMap(MAP)).toEqual([]);
  });

  it('has 40 uniquely numbered nodes', () => {
    expect(MAP.nodes).toHaveLength(40);
    const ids = MAP.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(40);
    expect([...ids].sort((a, b) => a - b)).toEqual([...Array(40).keys()]);
  });

  it('has exactly two fork nodes, at 10 and 19', () => {
    const forks = MAP.nodes.filter((n) => n.next.length === 2);
    expect(forks.map((n) => n.id).sort((a, b) => a - b)).toEqual([10, 19]);
  });

  it('has every node reachable from 0 and 0 reachable from every node', () => {
    expect(reachable(0, (n) => n.next).size).toBe(40);
    const prev = new Map(MAP.nodes.map((n) => [n.id, [] as number[]]));
    for (const n of MAP.nodes) for (const nx of n.next) prev.get(nx)!.push(n.id);
    expect(reachable(0, (n) => prev.get(n.id)!).size).toBe(40);
  });

  it('has one castle slot at id 0 and exactly one shop per region', () => {
    const castles = MAP.nodes.filter((n) => n.slot === 'castle');
    expect(castles.map((n) => n.id)).toEqual([0]);
    for (const r of REGIONS)
      expect(MAP.nodes.filter((n) => n.slot === 'shop' && n.region === r)).toHaveLength(1);
  });

  it('has at least 6 free slots per region', () => {
    for (const r of REGIONS) {
      const free = MAP.nodes.filter((n) => n.slot === 'free' && n.region === r).length;
      expect(free).toBeGreaterThanOrEqual(6);
    }
  });

  it('has unique coords, all nodes >= 100 px apart and inside the 120 px margin', () => {
    const coords = new Set(MAP.nodes.map((n) => `${n.x},${n.y}`));
    expect(coords.size).toBe(MAP.nodes.length);
    for (let i = 0; i < MAP.nodes.length; i++)
      for (let j = i + 1; j < MAP.nodes.length; j++) {
        const a = MAP.nodes[i]!;
        const b = MAP.nodes[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(100);
      }
    for (const n of MAP.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(120);
      expect(n.x).toBeLessThanOrEqual(MAP.width - 120);
      expect(n.y).toBeGreaterThanOrEqual(120);
      expect(n.y).toBeLessThanOrEqual(MAP.height - 120);
    }
  });

  it('has each region contiguous along the main loop', () => {
    const seq: Region[] = [MAP.nodes[0]!.region];
    let cur = MAP.nodes[0]!;
    for (;;) {
      cur = byId.get(cur.next[0]!)!;
      if (cur.id === 0) break;
      seq.push(cur.region);
    }
    expect(seq).toHaveLength(34);
    const closed = [...seq, seq[0]!];
    let changes = 0;
    for (let i = 0; i + 1 < closed.length; i++) if (closed[i] !== closed[i + 1]) changes++;
    expect(changes).toBe(REGIONS.length);
  });
});

describe('validateMap rejects broken maps', () => {
  const clone = () =>
    JSON.parse(JSON.stringify(MAP)) as { width: number; height: number; nodes: MapNode[] };

  it('flags a dangling next id', () => {
    const m = clone();
    m.nodes[0]!.next = [99];
    expect(validateMap(m).length).toBeGreaterThan(0);
  });

  it('flags a duplicate coordinate', () => {
    const m = clone();
    m.nodes[1]!.x = m.nodes[2]!.x;
    m.nodes[1]!.y = m.nodes[2]!.y;
    expect(validateMap(m).length).toBeGreaterThan(0);
  });

  it('flags a region with no shop', () => {
    const m = clone();
    m.nodes[5]!.slot = 'free';
    expect(validateMap(m).length).toBeGreaterThan(0);
  });
});
