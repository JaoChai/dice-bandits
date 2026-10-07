import type { GameState } from '@dice-bandits/engine';
import { MAP } from '@dice-bandits/engine';
import { motionScale, reducedMotion } from '../../art/motion';

/** Authored map size in map pixels (engine `map.json`). */
export const WORLD = { width: MAP.width, height: MAP.height } as const;

/** Logical canvas; camera zoom is expressed against it. */
export const VIEW = { width: 1280, height: 720 } as const;

/** Base ease duration for camera moves at speed 1 (ms). */
const EASE_MS = 600;

/** Zoom whose viewport spans `span` px of world width. */
export function zoomForSpan(span: number, spanHeight = span): number {
  return Math.min(VIEW.width / span, VIEW.height / spanHeight);
}

/** Spacing the gameplay zoom shows, in authored spaces across the canvas.
 *  Review 7c: averaged over ALL edges the mean is ~188 px, so 7 spaces give
 *  a zoom whose 96 px tiles render ≥ 48 CSS px at the 915×412 viewport
 *  (spec §7 range 7–9; 8 would drop to ~46.7 px). */
const SPACES_ACROSS = 7;

/** Authored on-map tile size in map pixels (tiles.ts TILE_MAP_SIZE). */
const TILE_MAP_SIZE_PX = 96;

/**
 * Gameplay zoom: spaces span the logical 1280 px canvas per SPACES_ACROSS.
 * Review 7c: averages ALL undirected edges (each once) — the previous loop
 * skipped `other.id > node.id` and averaged only a third of the edges.
 */
export function gameplayZoom(): number {
  let total = 0;
  let count = 0;
  const seen = new Set<string>();
  for (const node of MAP.nodes)
    for (const next of node.next) {
      const other = MAP.nodes[next];
      if (!other) continue;
      const key = node.id < other.id ? `${node.id}-${other.id}` : `${other.id}-${node.id}`;
      if (node.id !== other.id && seen.has(key)) continue;
      if (node.id !== other.id) seen.add(key);
      total += Math.hypot(other.x - node.x, other.y - node.y);
      count += 1;
    }
  const meanEdge = count > 0 ? total / count : 0;
  return zoomForSpan(
    meanEdge * SPACES_ACROSS,
    meanEdge * SPACES_ACROSS * (VIEW.height / VIEW.width),
  );
}

/** Tile size in CSS px at a viewport: the canvas scales to the viewport
 *  height (Phaser Scale FIT), so CSS px per world px = viewportH / 720. */
export function tilePxAt(viewportWidth: number, viewportHeight: number): number {
  const cssPerWorld = viewportHeight / VIEW.height;
  return TILE_MAP_SIZE_PX * gameplayZoom() * cssPerWorld;
}

/** CSS lane reservations, including device safe areas. */
export type BoardInsets = { left: number; top: number; right: number; bottom: number };

/** Convert CSS HUD lanes to a bounded logical camera viewport (Scale.EXPAND). */
export function boardViewport(
  logical: { width: number; height: number },
  css: { width: number; height: number },
  insets: BoardInsets,
): { x: number; y: number; width: number; height: number } {
  const dimension = (value: number) => (Number.isFinite(value) ? Math.max(1, value) : 1);
  const lane = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
  const width = dimension(logical.width),
    height = dimension(logical.height);
  const sx = width / dimension(css.width),
    sy = height / dimension(css.height);
  const x = Math.min(width - 1, lane(insets.left) * sx);
  const y = Math.min(height - 1, lane(insets.top) * sy);
  return {
    x,
    y,
    width: Math.max(1, width - x - lane(insets.right) * sx),
    height: Math.max(1, height - y - lane(insets.bottom) * sy),
  };
}

export interface CameraTarget {
  x: number;
  y: number;
  zoom: number;
  /** Tween duration in ms; 0 = snap (?speed=0, prefers-reduced-motion). */
  duration: number;
}

/**
 * Where the board camera should be: centred on the active seat's token at
 * gameplay zoom, or the whole 3200×1800 map for the whole-map view.
 */
export function cameraTarget(
  state: GameState,
  wholeMap = false,
  view: { width: number; height: number } = VIEW,
): CameraTarget {
  if (wholeMap) {
    return {
      x: WORLD.width / 2,
      y: WORLD.height / 2,
      // Fit the entire authored world, including heroes above north tiles.
      // Painted gutters fill the extra viewport; gameplay is never cropped.
      zoom: wholeMapZoom(view),
      duration: moveDuration(),
    };
  }
  const player = state.players[state.turnSeat];
  const space = player
    ? state.board.spaces.find((candidate) => candidate.id === player.pos)
    : undefined;
  return {
    x: space?.x ?? WORLD.width / 2,
    y: space?.y ?? WORLD.height / 2,
    zoom: gameplayZoom(),
    duration: moveDuration(),
  };
}

function wholeMapZoom(view: { width: number; height: number }): number {
  return Math.min(view.width / WORLD.width, view.height / WORLD.height);
}

/** Whole-map fit needs painted gutters outside the authored world on wide
 * screens. Normal follow stays clamped to the original map. */
export function cameraBounds(view: { width: number; height: number }, wholeMap = false) {
  const zoom = wholeMapZoom(view);
  const width = wholeMap ? Math.max(WORLD.width, view.width / zoom) : WORLD.width;
  const height = wholeMap ? Math.max(WORLD.height, view.height / zoom) : WORLD.height;
  return { x: (WORLD.width - width) / 2, y: (WORLD.height - height) / 2, width, height };
}

function moveDuration(): number {
  if (motionScale() <= 0 || reducedMotion()) return 0;
  return Math.round(EASE_MS * motionScale());
}
