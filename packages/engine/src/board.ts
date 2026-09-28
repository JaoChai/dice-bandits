import type { Board, Region, Space, SpaceKind } from './types';
import { pick, seedRng, shuffle } from './rng';
import type { Chunk, ChunkSpace } from './data/index';
import { CHUNKS } from './data/index';
import type { RngState } from './rng';

const REGIONS: readonly Region[] = ['meadow', 'desert', 'snow', 'volcano'];
const GRID_W = 20;
const GRID_H = 11;
const CASTLE_POS = { x: 9, y: 5 };
const MAX_ATTEMPTS = 10;

/**
 * Split a chunk's spaces into its authored sections:
 * - pre:  leading run of main-row (y=0) spaces; the last one is the fork
 *         start when the chunk is a fork chunk.
 * - upper/lower: the y=-1 / y=+1 branch runs (fork chunks only).
 * - post: trailing main-row run where the branches rejoin (fork chunks only).
 */
interface Sections {
  pre: number[];
  upper: number[];
  lower: number[];
  post: number[];
  forkAt: number; // index into chunk.spaces of the fork start
}

function analyze(chunk: Chunk): Sections {
  const n = chunk.spaces.length;
  const yOf = (i: number) => chunk.spaces[i]!.y;
  let i = 0;
  const pre: number[] = [];
  while (i < n && yOf(i) === 0) pre.push(i++);
  const forkAt = pre[pre.length - 1]!;
  const upper: number[] = [];
  const lower: number[] = [];
  const post: number[] = [];
  if (chunk.fork) {
    while (i < n && yOf(i) === -1) upper.push(i++);
    while (i < n && yOf(i) === 1) lower.push(i++);
    while (i < n && yOf(i) === 0) post.push(i++);
  }
  return { pre, upper, lower, post, forkAt };
}

interface Node {
  id: number;
  kind: SpaceKind;
  region: Region;
  next: Set<number>;
  x: number;
  y: number;
}

interface Draft {
  nodes: Node[];
  coordSet: Set<string>;
}

function addNode(draft: Draft, kind: SpaceKind, region: Region, x: number, y: number): number {
  if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) {
    throw new Error(`tile (${x},${y}) outside ${GRID_W}x${GRID_H} grid`);
  }
  const key = `${x},${y}`;
  if (draft.coordSet.has(key)) throw new Error(`duplicate tile (${x},${y})`);
  draft.coordSet.add(key);
  const id = draft.nodes.length;
  draft.nodes.push({ id, kind, region, next: new Set(), x, y });
  return id;
}

function edge(draft: Draft, from: number, to: number): void {
  if (from !== to) draft.nodes[from]!.next.add(to);
}

/**
 * Authored chunk kinds must never introduce a second castle: only the
 * generator-created root space (id 0) is `castle` (see `buildWith`).
 */
function authoredKind(s: ChunkSpace): SpaceKind {
  return s.kind === 'castle' ? 'event' : s.kind;
}

/** Evenly distribute `n` tile coordinates inside `avail` slots. */
function tileRun(avail: number, n: number): number[] {
  const lead = Math.floor((avail - n) / 2);
  return Array.from({ length: n }, (_, i) => lead + i);
}

/**
 * Place a chunk's main-row spaces on `positions` (one grid tile per line
 * slot, in visit order), chain them, and — for fork chunks — attach the two
 * branches. Branch offsets keep their local (dx,dy) relative to the fork
 * start; callers pass positions whose surroundings make that valid.
 *
 * The fork start links ONLY to the two branch entries (exactly two
 * successors); the branches rejoin at the first post-fork line space.
 */
function placeChunk(
  draft: Draft,
  chunk: Chunk,
  positions: { x: number; y: number }[],
): { first: number; last: number } {
  const sec = analyze(chunk);
  const line = [...sec.pre, ...sec.post];
  if (positions.length !== line.length)
    throw new Error(`position count mismatch for chunk ${chunk.id}`);
  const ids = line.map((ci, k) => {
    const s: ChunkSpace = chunk.spaces[ci]!;
    return addNode(draft, authoredKind(s), chunk.region, positions[k]!.x, positions[k]!.y);
  });
  const forkPos = line.indexOf(sec.forkAt);
  for (let k = 0; k + 1 < ids.length; k++) {
    if (chunk.fork && k === forkPos) continue; // fork start -> branches only
    edge(draft, ids[k]!, ids[k + 1]!);
  }
  if (chunk.fork) {
    const forkId = ids[forkPos]!;
    const fs = chunk.spaces[sec.forkAt]!;
    const rejoin = ids[forkPos + 1]!;
    for (const branch of [sec.upper, sec.lower]) {
      const bids = branch.map((ci) => {
        const s = chunk.spaces[ci]!;
        // travel is -x on the bottom band, so local +x mirrors to -x
        return addNode(
          draft,
          authoredKind(s),
          chunk.region,
          positions[forkPos]!.x - (s.x - fs.x),
          positions[forkPos]!.y + (s.y - fs.y),
        );
      });
      for (let k = 0; k + 1 < bids.length; k++) edge(draft, bids[k]!, bids[k + 1]!);
      edge(draft, forkId, bids[0]!);
      edge(draft, bids[bids.length - 1]!, rejoin);
    }
  }
  return { first: ids[0]!, last: ids[ids.length - 1]! };
}

/** Guarantee >=2 towns and >=1 shop per region, then kill trap->trap edges. */
function repair(draft: Draft, state: RngState): RngState {
  for (const r of REGIONS) {
    const inR = draft.nodes.filter((n) => n.region === r);
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
    for (const n of draft.nodes) {
      for (const t of [...n.next].sort((a, b) => a - b)) {
        if (n.kind === 'trap' && draft.nodes[t]!.kind === 'trap') {
          bad = { from: n.id, to: t };
          break;
        }
      }
      if (bad) break;
    }
    if (!bad) break;
    const [victim, s] = pick(state, [bad.from, bad.to]);
    state = s;
    draft.nodes[victim]!.kind = 'event';
  }
  return state;
}

function valid(draft: Draft): boolean {
  const nodes = draft.nodes;
  if (nodes.filter((n) => n.next.size === 2).length !== 2) return false;
  for (const n of nodes) {
    for (const t of n.next) if (n.kind === 'trap' && nodes[t]!.kind === 'trap') return false;
  }
  for (const r of REGIONS) {
    const inR = nodes.filter((n) => n.region === r);
    if (inR.filter((n) => n.kind === 'town').length < 2) return false;
    if (inR.filter((n) => n.kind === 'shop').length < 1) return false;
  }
  const seen = new Set<number>([0]);
  const q: number[] = [0];
  while (q.length) {
    const cur = nodes[q.pop()!]!;
    for (const t of cur.next)
      if (!seen.has(t)) {
        seen.add(t);
        q.push(t);
      }
  }
  return seen.size === nodes.length;
}

/**
 * Deterministic board layout:
 * - space 0: the castle, grid centre, meadow region.
 * - top band (y=0, left->right): the two non-fork chunks' main rows.
 * - bottom band (y=9, right->left): the two fork chunks' main rows; their
 *   branches hang off at y=8 / y=10, pointing back against travel.
 * - the loop closes: castle -> top -> bottom -> castle.
 */
function buildWith(chunkFor: Record<Region, Chunk>, forked: Set<Region>): Draft {
  const draft: Draft = { nodes: [], coordSet: new Set<string>() };
  addNode(draft, 'castle', 'meadow', CASTLE_POS.x, CASTLE_POS.y);
  const castleId = 0;

  const top = REGIONS.filter((r) => !forked.has(r));
  const bottom = REGIONS.filter((r) => forked.has(r));
  const topChunks = top.map((r) => chunkFor[r]);
  const bottomChunks = bottom.map((r) => chunkFor[r]);

  const topLen = topChunks.reduce(
    (sum, c) => sum + analyze(c).pre.length + analyze(c).post.length,
    0,
  );
  const bottomLen = bottomChunks.reduce(
    (sum, c) => sum + analyze(c).pre.length + analyze(c).post.length,
    0,
  );
  if (topLen > GRID_W || bottomLen > GRID_W) throw new Error('top/bottom band overflow');

  const topXs = tileRun(GRID_W, topLen);
  const bottomXs = tileRun(GRID_W, bottomLen).reverse(); // travel right -> left

  let cursor = 0;
  let prevExit = -1;
  let entry = -1;
  for (const c of topChunks) {
    const len = analyze(c).pre.length + analyze(c).post.length;
    const pos = topXs.slice(cursor, cursor + len).map((x) => ({ x, y: 0 }));
    const run = placeChunk(draft, c, pos);
    if (prevExit !== -1) edge(draft, prevExit, run.first);
    else entry = run.first;
    prevExit = run.last;
    cursor += len;
  }

  cursor = 0;
  for (const c of bottomChunks) {
    const len = analyze(c).pre.length + analyze(c).post.length;
    const pos = bottomXs.slice(cursor, cursor + len).map((x) => ({ x, y: 9 }));
    const run = placeChunk(draft, c, pos);
    edge(draft, prevExit, run.first);
    prevExit = run.last;
    cursor += len;
  }
  edge(draft, prevExit, castleId); // last space links back to the castle
  edge(draft, castleId, entry); // castle opens the loop
  return draft;
}

export function generateBoard(seed: string): Board {
  let state: RngState = seedRng(seed);
  const [order, s1] = shuffle(state, REGIONS);
  state = s1;
  const forked = new Set<Region>(order.slice(0, 2));
  const chunkFor: Record<Region, Chunk> = {} as Record<Region, Chunk>;
  for (const r of REGIONS) {
    const wantFork = forked.has(r);
    const cands = CHUNKS.filter((c) => c.region === r && c.fork === wantFork);
    const [c, s2] = pick(state, cands);
    chunkFor[r] = c;
    state = s2;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const draft = buildWith(chunkFor, forked);
    state = repair(draft, state);
    if (valid(draft)) {
      const spaces: Space[] = draft.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        region: n.region,
        next: [...n.next].sort((a, b) => a - b),
        x: n.x,
        y: n.y,
      }));
      return { spaces, castleId: 0 };
    }
  }
  throw new Error(`generateBoard: repair failed after ${MAX_ATTEMPTS} attempts for seed ${seed}`);
}
