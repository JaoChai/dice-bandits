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

/**
 * Map the engine board onto the 640x360 canvas.
 *
 * Since M5a, `Space.x/y` are authored map pixels (0..3200 x 0..1800) with
 * hand-tuned jitter, so the M4 integer grid-fit no longer applies: quantising
 * pixels to graph units collapses diagonal node pairs onto one cell. The
 * interim layout is a plain centred linear fit of the real map geometry
 * (10 px margin), with `toScreen` returning rounded integer coordinates.
 * The M4 HUD-avoiding integer tile pass is replaced by the M5a follow camera
 * in Task 6, which consumes `Space.x/y` directly and never draws the whole
 * map at once.
 */
export function boardLayout(spaces: Space[], canvas: Size): BoardLayout {
  if (spaces.length === 0) {
    return { scale: 0, toScreen: () => ({ x: canvas.width / 2, y: canvas.height / 2 }) };
  }
  const minX = Math.min(...spaces.map((space) => space.x));
  const maxX = Math.max(...spaces.map((space) => space.x));
  const minY = Math.min(...spaces.map((space) => space.y));
  const maxY = Math.max(...spaces.map((space) => space.y));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  const margin = 10;
  const scale = Math.min((canvas.width - 2 * margin) / spanX, (canvas.height - 2 * margin) / spanY);
  const offsetX = (canvas.width - spanX * scale) / 2;
  const offsetY = (canvas.height - spanY * scale) / 2;
  return {
    scale,
    toScreen: (x: number, y: number) => ({
      x: Math.round(offsetX + (x - minX) * scale),
      y: Math.round(offsetY + (y - minY) * scale),
    }),
  };
}
