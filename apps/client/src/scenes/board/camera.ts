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

/** Spacing the gameplay zoom shows: ~8 authored spaces across (spec §7). */
const SPACES_ACROSS = 8;

/**
 * Gameplay zoom: ~8 spaces span the logical 1280 px canvas. Derived from the
 * mean authored edge length so the value follows `map.json` automatically.
 */
export function gameplayZoom(): number {
  let total = 0;
  let count = 0;
  for (const node of MAP.nodes)
    for (const next of node.next) {
      const other = MAP.nodes[next];
      if (!other || other.id > node.id) continue;
      total += Math.hypot(other.x - node.x, other.y - node.y);
      count += 1;
    }
  const meanEdge = count > 0 ? total / count : 0;
  return zoomForSpan(
    meanEdge * SPACES_ACROSS,
    meanEdge * SPACES_ACROSS * (VIEW.height / VIEW.width),
  );
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
export function cameraTarget(state: GameState, wholeMap = false): CameraTarget {
  if (wholeMap) {
    return {
      x: WORLD.width / 2,
      y: WORLD.height / 2,
      zoom: zoomForSpan(WORLD.width, WORLD.height),
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

function moveDuration(): number {
  if (motionScale() <= 0 || reducedMotion()) return 0;
  return Math.round(EASE_MS * motionScale());
}
