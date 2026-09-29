import { nextFloat, nextInt, seedRng, type RngState } from '@dice-bandits/engine';
import type { Region } from '@dice-bandits/engine';

export interface Placed {
  x: number;
  y: number;
  prop: string;
  region: Region;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface Segment {
  a: ScreenPoint;
  b: ScreenPoint;
}

export interface DecorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DecorView {
  width: number;
  height: number;
  toScreen: (x: number, y: number) => ScreenPoint;
  /** Rectangles that must not contain any decoration (e.g. DOM HUD zones). */
  avoid?: DecorRect[];
}

type SpaceLike = {
  id: number;
  x: number;
  y: number;
  region: Region;
  next: number[];
};

function inAvoid(view: DecorView, x: number, y: number): boolean {
  // All placed sprites use a 32x32 bottom-centred cell. The anchor may clear
  // the HUD while the opaque top or side of the sprite still sits beneath it.
  return (view.avoid ?? []).some(
    (rect) =>
      x - 16 < rect.x + rect.width &&
      x + 16 > rect.x &&
      y - 32 < rect.y + rect.height &&
      y > rect.y,
  );
}

/** Shortest distance from a point to a segment (0 at the endpoints). */
export function segmentDistance(point: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Screen-space road segments, one per undirected `next` edge. */
export function roadSegmentsFor(spaces: SpaceLike[], view: DecorView): Segment[] {
  const byId = new Map(spaces.map((space) => [space.id, space]));
  const segments: Segment[] = [];
  const seen = new Set<string>();
  for (const space of spaces) {
    for (const nextId of space.next) {
      const other = byId.get(nextId);
      if (!other || other.id === space.id) continue;
      const key = space.id < other.id ? `${space.id}-${other.id}` : `${other.id}-${space.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      segments.push({ a: view.toScreen(space.x, space.y), b: view.toScreen(other.x, other.y) });
    }
  }
  return segments;
}

/** Prop names per region; index doubles as the props-atlas frame number. */
export const REGION_PROPS: Record<Region, string[]> = {
  meadow: ['tree', 'house', 'rock', 'stump', 'flower', 'bush', 'log', 'fence'],
  desert: ['cactus', 'house', 'rock', 'palm', 'bones', 'shrub', 'dune', 'fence'],
  snow: ['pine', 'house', 'rock', 'stump', 'ice', 'shrub', 'log', 'fence'],
  volcano: ['lavaRock', 'house', 'rock', 'deadTree', 'vent', 'shrub', 'obsidian', 'fence'],
};

const AMBIENT_REGION_COUNT: Record<Region, number> = {
  meadow: 3,
  desert: 2,
  snow: 2,
  volcano: 2,
};

const PROP_MIN_DISTANCE = 14;
const AMBIENT_MIN_DISTANCE = 24;
const PROP_PROP_MIN_DISTANCE = 9;
const CELL = 8;

interface Cell {
  x: number;
  y: number;
  region: Region;
  road: number;
}

function openCells(
  spaces: SpaceLike[],
  view: DecorView,
  segments: Segment[],
  clearOf: number,
): Cell[] {
  const centres = spaces.map((space) => ({ space, point: view.toScreen(space.x, space.y) }));
  const cells: Cell[] = [];
  for (let gx = CELL / 2; gx < view.width; gx += CELL) {
    for (let gy = CELL / 2; gy < view.height; gy += CELL) {
      let nearest = centres[0]!;
      let nearestDistance = Infinity;
      for (const candidate of centres) {
        const distance = Math.hypot(candidate.point.x - gx, candidate.point.y - gy);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = candidate;
        }
      }
      if (nearestDistance < clearOf) continue;
      let road = Infinity;
      for (const segment of segments) {
        const distance = segmentDistance({ x: gx, y: gy }, segment.a, segment.b);
        if (distance < road) road = distance;
      }
      if (road < clearOf) continue;
      if (inAvoid(view, gx, gy)) continue;
      cells.push({ x: gx, y: gy, region: nearest.space.region, road });
    }
  }
  return cells;
}

/**
 * Deterministic decoration placement for one board:
 * - candidate points on an 8 px grid, at least 14 px from every space centre
 *   and every road segment;
 * - farther-from-road candidates are favoured so props drift to open ground;
 * - count scales with the canvas area, clamped to 12..60;
 * - every prop carries the region of its nearest space.
 */
export function placeDecorations(spaces: SpaceLike[], seed: string, view: DecorView): Placed[] {
  if (spaces.length === 0) return [];
  let rng: RngState = seedRng(`${seed}:decor`);
  const segments = roadSegmentsFor(spaces, view);
  const centres = spaces.map((space) => view.toScreen(space.x, space.y));
  // Props are bottom-anchored 32x32 sprites: keep the whole footprint (plus a
  // 12 px tile half-size) off every space tile, not just the anchor point.
  const cells = openCells(spaces, view, segments, PROP_MIN_DISTANCE).filter((cell) =>
    centres.every(
      (centre) =>
        centre.x <= cell.x - 28 ||
        centre.x >= cell.x + 28 ||
        centre.y <= cell.y - 44 ||
        centre.y >= cell.y + 12,
    ),
  );
  const target = Math.max(12, Math.min(60, Math.round((view.width * view.height) / 5200)));
  const placed: Placed[] = [];

  // Weighted order: sample cells, preferring bigger road clearance.
  const pool = [...cells];
  let guard = pool.length * 3;
  while (placed.length < target && pool.length > 0 && guard-- > 0) {
    const [index, st] = nextInt(rng, 0, pool.length - 1);
    rng = st;
    const cell = pool[index]!;
    // Bias: keep clear-of-road cells, often skip close ones.
    const keepChance = 0.3 + 0.7 * Math.min(1, (cell.road - PROP_MIN_DISTANCE) / 28);
    const [roll, st2] = nextFloat(rng);
    rng = st2;
    if (roll > keepChance) continue;
    if (
      placed.some(
        (other) => Math.hypot(other.x - cell.x, other.y - cell.y) < PROP_PROP_MIN_DISTANCE,
      )
    ) {
      continue;
    }
    const [propIndex, st3] = nextInt(rng, 0, REGION_PROPS[cell.region].length - 1);
    rng = st3;
    placed.push({
      x: cell.x,
      y: cell.y,
      prop: REGION_PROPS[cell.region][propIndex]!,
      region: cell.region,
    });
    pool.splice(index, 1);
  }
  return placed;
}

/**
 * 1-3 ambient water/lava sprites per region present on the board, placed in
 * open ground at least 24 px from spaces/roads and 26 px from each other.
 */
export function placeAmbients(spaces: SpaceLike[], seed: string, view: DecorView): Placed[] {
  if (spaces.length === 0) return [];
  let rng: RngState = seedRng(`${seed}:ambient`);
  const segments = roadSegmentsFor(spaces, view);
  const cells = openCells(spaces, view, segments, AMBIENT_MIN_DISTANCE);
  const regionsInOrder = [...new Set(spaces.map((space) => space.region))];
  const placed: Placed[] = [];
  for (const region of regionsInOrder) {
    const [want, stWant] = nextInt(rng, 1, AMBIENT_REGION_COUNT[region]);
    rng = stWant;
    const regional = () =>
      cells.filter(
        (cell) =>
          cell.region === region &&
          placed.every((other) => Math.hypot(other.x - cell.x, other.y - cell.y) >= 26),
      );
    let pool = regional();
    let count = 0;
    let guard = pool.length + 8;
    while (count < want && pool.length > 0 && guard-- > 0) {
      const [index, st] = nextInt(rng, 0, pool.length - 1);
      rng = st;
      const cell = pool[index]!;
      const [roll, st2] = nextFloat(rng);
      rng = st2;
      if (roll > 0.85) continue; // small jitter in how full each region gets
      placed.push({ x: cell.x, y: cell.y, prop: 'ambient', region });
      count += 1;
      pool = regional();
      guard = pool.length + 8;
    }
    if (count === 0 && pool.length > 0) {
      // Guarantee at least one per visible region.
      const [index, st] = nextInt(rng, 0, pool.length - 1);
      rng = st;
      const cell = pool[index]!;
      placed.push({ x: cell.x, y: cell.y, prop: 'ambient', region });
    }
  }
  return placed;
}
