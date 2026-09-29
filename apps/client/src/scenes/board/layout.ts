import type { Space } from '@dice-bandits/engine';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface HudRect {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: 'tl' | 'tr' | 'bl' | 'br' | 'banner' | 'topline' | 'tray';
}

export interface BoardLayout {
  /** Space spacing in px (= tile display size). Integer when the HUD fits. */
  scale: number;
  toScreen: (x: number, y: number) => ScreenPoint;
}

const CUSHION = 2;

function rect(kind: HudRect['kind'], x0: number, y0: number, x1: number, y1: number): HudRect {
  return {
    kind,
    x: x0 - CUSHION,
    y: y0 - CUSHION,
    width: x1 - x0 + 2 * CUSHION,
    height: y1 - y0 + 2 * CUSHION,
  };
}

/**
 * DOM HUD overlays in 640x360 canvas coordinates: the union of the live DOM
 * rects measured with Playwright at 1280x720 and 915x412 over four seeds
 * (seat cards, event banner, language/back row, Roll tray), plus a 2 px
 * cushion. Re-measure if Task 7 moves the HUD.
 */
export const HUD_RECTS: HudRect[] = [
  rect('tl', -73, 4, 144, 72),
  rect('tr', 496, 4, 714, 72),
  rect('bl', -73, 234, 144, 328),
  rect('br', 496, 234, 714, 328),
  rect('banner', 128, 4, 513, 51),
  rect('topline', 242, 31, 398, 83),
  rect('tray', 289, 302, 351, 356),
];

/** Largest tile size (px) tried when shrinking the board to fit the HUD. */
export const MAX_TILE = 24;
/** Smallest tile size the layout will shrink to before giving up. */
export const MIN_TILE = 8;

function tileClear(point: ScreenPoint, half: number, canvas: Size): boolean {
  if (
    point.x - half < 0 ||
    point.x + half > canvas.width ||
    point.y - half < 0 ||
    point.y + half > canvas.height
  ) {
    return false;
  }
  return HUD_RECTS.every(
    (hud) =>
      point.x + half <= hud.x ||
      point.x - half >= hud.x + hud.width ||
      point.y + half <= hud.y ||
      point.y - half >= hud.y + hud.height,
  );
}

/**
 * Map the engine grid onto the 640x360 canvas:
 * - largest integer tile size (24 down to 8 px) whose whole tile boxes stay
 *   inside the canvas and clear of every DOM HUD rectangle;
 * - board centred horizontally; the vertical offset closest to centre that
 *   clears the HUD wins;
 * - integer screen coordinates (roundPixels);
 * - falls back to a plain centred fit (M1 behaviour) if nothing clears.
 */
export function boardLayout(spaces: Space[], canvas: Size): BoardLayout {
  if (spaces.length === 0) {
    return { scale: 0, toScreen: () => ({ x: canvas.width / 2, y: canvas.height / 2 }) };
  }
  const minX = Math.min(...spaces.map((space) => space.x));
  const maxX = Math.max(...spaces.map((space) => space.x));
  const minY = Math.min(...spaces.map((space) => space.y));
  const maxY = Math.max(...spaces.map((space) => space.y));
  const unitsX = Math.max(1, maxX - minX);
  const unitsY = Math.max(1, maxY - minY);

  for (let tile = MAX_TILE; tile >= MIN_TILE; tile--) {
    const offsetX = Math.round((canvas.width - unitsX * tile) / 2);
    const centreY = Math.round((canvas.height - unitsY * tile) / 2);
    for (const offsetY of offsetsNearest(centreY, canvas.height)) {
      const fits = spaces.every((space) =>
        tileClear(
          { x: offsetX + (space.x - minX) * tile, y: offsetY + (space.y - minY) * tile },
          tile / 2,
          canvas,
        ),
      );
      if (fits) {
        return {
          scale: tile,
          toScreen: (x: number, y: number) => ({
            x: offsetX + (x - minX) * tile,
            y: offsetY + (y - minY) * tile,
          }),
        };
      }
    }
  }

  const margin = 10;
  const scale = Math.min(
    (canvas.width - 2 * margin) / unitsX,
    (canvas.height - 2 * margin) / unitsY,
  );
  const offsetX = (canvas.width - unitsX * scale) / 2;
  const offsetY = (canvas.height - unitsY * scale) / 2;
  return {
    scale,
    toScreen: (x: number, y: number) => ({
      x: offsetX + (x - minX) * scale,
      y: offsetY + (y - minY) * scale,
    }),
  };
}

/** Every vertical offset in the canvas, nearest to the centred one first. */
function offsetsNearest(centre: number, height: number): number[] {
  const out = [centre];
  for (let delta = 1; delta <= height; delta++) out.push(centre - delta, centre + delta);
  return out.filter((offset) => offset >= 0 && offset <= height);
}
