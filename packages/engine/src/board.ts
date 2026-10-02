import type { Board, Region, Space, SpaceKind } from './types';
import { pick, seedRng, weightedPick } from './rng';
import type { RngState } from './rng';
import { MAP } from './map';
import { BALANCE } from './data/index';

const REGIONS: readonly Region[] = ['meadow', 'desert', 'snow', 'volcano'];
const MAX_ATTEMPTS = 10;

/** Weighted bag kinds a `free` slot can draw; fixed slots (castle, shop) are excluded. */
type BagKind = Exclude<SpaceKind, 'castle' | 'shop'>;

interface Node {
  id: number;
  kind: SpaceKind;
  region: Region;
  next: Set<number>;
  x: number;
  y: number;
}

function buildWith(): Node[] {
  return MAP.nodes.map((n) => ({
    id: n.id,
    kind: n.slot === 'castle' ? 'castle' : n.slot === 'shop' ? 'shop' : 'event',
    region: n.region,
    next: new Set(n.next),
    x: n.x,
    y: n.y,
  }));
}

/** Guarantee >=2 towns and >=1 shop per region, then kill trap->trap edges. */
function repair(draft: Node[], state: RngState): RngState {
  for (const r of REGIONS) {
    const inR = draft.filter((n) => n.region === r);
    const donors = () =>
      inR.filter((n) => n.kind === 'chest' || n.kind === 'event' || n.kind === 'monster');
    let towns = inR.filter((n) => n.kind === 'town').length;
    while (towns < 2) {
      const pool = donors();
      if (pool.length === 0) throw new Error(`no donor space in region ${r}`);
      const [d, s] = pick(state, pool);
      state = s;
      d.kind = 'town';
      towns++;
    }
    let shops = inR.filter((n) => n.kind === 'shop').length;
    while (shops < 1) {
      const pool = donors();
      if (pool.length === 0) throw new Error(`no donor space in region ${r}`);
      const [d, s] = pick(state, pool);
      state = s;
      d.kind = 'shop';
      shops++;
    }
  }
  for (let guard = 0; ; guard++) {
    if (guard > 100) throw new Error('trap repair did not converge');
    let bad: { from: number; to: number } | null = null;
    const byId = new Map(draft.map((n) => [n.id, n]));
    for (const n of draft) {
      for (const t of [...n.next].sort((a, b) => a - b)) {
        if (n.kind === 'trap' && byId.get(t)!.kind === 'trap') {
          bad = { from: n.id, to: t };
          break;
        }
      }
      if (bad) break;
    }
    if (!bad) break;
    const [victim, s] = pick(state, [bad.from, bad.to]);
    state = s;
    byId.get(victim)!.kind = 'event';
  }
  return state;
}

function valid(draft: Node[]): boolean {
  if (draft.filter((n) => n.next.size === 2).length !== 2) return false;
  const byId = new Map(draft.map((n) => [n.id, n]));
  for (const n of draft) {
    for (const t of n.next) if (n.kind === 'trap' && byId.get(t)!.kind === 'trap') return false;
  }
  for (const r of REGIONS) {
    const inR = draft.filter((n) => n.region === r);
    if (inR.filter((n) => n.kind === 'town').length < 2) return false;
    if (inR.filter((n) => n.kind === 'shop').length < 1) return false;
  }
  const start = MAP.nodes[0]!.id;
  const seen = new Set<number>([start]);
  const q: number[] = [start];
  while (q.length) {
    const cur = byId.get(q.pop()!)!;
    for (const t of cur.next)
      if (!seen.has(t)) {
        seen.add(t);
        q.push(t);
      }
  }
  return seen.size === draft.length;
}

export function generateBoard(seed: string): Board {
  const slotWeights = BALANCE.slotWeights as Record<BagKind, number>;
  let state: RngState = seedRng(seed);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const draft = buildWith();
    for (const r of REGIONS) {
      const free = draft.filter((n) => n.region === r && MAP.nodes[n.id]!.slot === 'free');
      let guard = free.length; // bag-draw bound; weightedPick always advances the state
      for (const n of free) {
        if (guard-- <= 0) throw new Error('slot bag did not terminate');
        const [kind, s1] = weightedPick(state, slotWeights);
        state = s1;
        n.kind = kind;
      }
    }
    state = repair(draft, state);
    if (valid(draft)) {
      const spaces: Space[] = draft
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((n) => ({
          id: n.id,
          kind: n.kind,
          region: n.region,
          next: [...n.next].sort((a, b) => a - b),
          x: n.x,
          y: n.y,
        }));
      return { spaces, castleId: MAP.nodes[0]!.id };
    }
  }
  throw new Error(`generateBoard: repair failed after ${MAX_ATTEMPTS} attempts for seed ${seed}`);
}
