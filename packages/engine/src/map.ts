import mapJson from './data/map.json' with { type: 'json' };
import type { Region } from './types';

export interface MapNode {
  id: number;
  x: number;
  y: number;
  region: Region;
  slot: 'castle' | 'shop' | 'free';
  next: number[];
}

export const MAP = mapJson as unknown as {
  width: number;
  height: number;
  nodes: MapNode[];
};

const REGIONS: readonly Region[] = ['meadow', 'desert', 'snow', 'volcano'];

/**
 * Validates a map graph. Returns a list of human-readable problems;
 * an empty list means the map is valid.
 */
export function validateMap(m: { width: number; height: number; nodes: MapNode[] }): string[] {
  const errors: string[] = [];
  const nodes = m.nodes;

  const byId = new Map<number, MapNode>();
  for (const n of nodes) {
    if (byId.has(n.id)) errors.push(`duplicate node id ${n.id}`);
    byId.set(n.id, n);
  }

  for (const n of nodes) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y))
      errors.push(`node ${n.id}: non-finite coordinates`);
    else if (n.x < 120 || n.x > m.width - 120 || n.y < 120 || n.y > m.height - 120)
      errors.push(`node ${n.id}: position (${n.x}, ${n.y}) is outside the ${120}px map margin`);
    if (!REGIONS.includes(n.region)) errors.push(`node ${n.id}: unknown region "${n.region}"`);
    if (n.slot !== 'castle' && n.slot !== 'shop' && n.slot !== 'free')
      errors.push(`node ${n.id}: unknown slot "${n.slot as string}"`);
    if (n.next.length === 0) errors.push(`node ${n.id}: has no outgoing edges`);
    for (const nx of n.next) if (!byId.has(nx)) errors.push(`node ${n.id}: dangling next id ${nx}`);
  }

  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 100) errors.push(`nodes ${a.id} and ${b.id}: ${Math.round(d)} px apart (min 100)`);
      if (a.x === b.x && a.y === b.y)
        errors.push(`nodes ${a.id} and ${b.id}: duplicate coordinates`);
    }

  const reach = (next: (n: MapNode) => number[]): Set<number> => {
    const start = nodes[0];
    if (!start) return new Set();
    const seen = new Set<number>([start.id]);
    const q = [start.id];
    while (q.length) {
      const cur = byId.get(q.pop()!);
      if (!cur) continue;
      for (const nx of next(cur)) {
        if (byId.has(nx) && !seen.has(nx)) {
          seen.add(nx);
          q.push(nx);
        }
      }
    }
    return seen;
  };
  const forward = reach((n) => n.next);
  if (nodes.length > 0 && forward.size !== nodes.length)
    errors.push(`${nodes.length - forward.size} node(s) unreachable from node ${nodes[0]!.id}`);
  const prev = new Map<number, number[]>(nodes.map((n) => [n.id, [] as number[]]));
  for (const n of nodes) for (const nx of n.next) prev.get(nx)?.push(n.id);
  const backward = reach((n) => prev.get(n.id) ?? []);
  if (nodes.length > 0 && backward.size !== nodes.length)
    errors.push(`node ${nodes[0]!.id} is unreachable from ${nodes.length - backward.size} node(s)`);

  const castles = nodes.filter((n) => n.slot === 'castle');
  if (castles.length !== 1 || castles[0]?.id !== 0)
    errors.push(`expected exactly one castle slot on node 0, found ${castles.length}`);
  for (const r of REGIONS) {
    if (!nodes.some((n) => n.slot === 'shop' && n.region === r))
      errors.push(`region ${r}: no shop slot`);
    const free = nodes.filter((n) => n.slot === 'free' && n.region === r).length;
    if (free < 6) errors.push(`region ${r}: only ${free} free slot(s) (min 6)`);
  }

  return errors;
}
