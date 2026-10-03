import Phaser from 'phaser';

export const DEPTH_ROAD = -5;
/** Palette tokens (Global Constraints): cream fill, cocoa outline. */
export const ROAD_COLOR = 0xf5eedc;
export const ROAD_EDGE_COLOR = 0x5c3317;
/** Cream road width in map pixels (plan Task 6: 64 px). */
export const ROAD_WIDTH = 64;

type Point = { x: number; y: number };
type Segment = { a: Point; b: Point };

function drawParallel(g: Phaser.GameObjects.Graphics, a: Point, b: Point, offset: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  // unit normal, scaled by the perpendicular offset
  const nx = (-dy / length) * offset;
  const ny = (dx / length) * offset;
  g.fillPoints(
    [
      new Phaser.Math.Vector2(a.x + nx, a.y + ny),
      new Phaser.Math.Vector2(b.x + nx, b.y + ny),
      new Phaser.Math.Vector2(b.x - nx, b.y - ny),
      new Phaser.Math.Vector2(a.x - nx, a.y - ny),
    ],
    true,
  );
}

/**
 * Cream 64 map-px road with a 6 map-px cocoa outline along every undirected
 * edge, drawn as one graphics pass under the buildings/tiles, with rounded
 * joints (small discs at each endpoint). Map pixels: the follow camera
 * scales it; no per-zoom redraw needed.
 */
export function drawRoad(scene: Phaser.Scene, segments: Segment[]): void {
  if (segments.length === 0) return;
  const g = scene.add.graphics().setDepth(DEPTH_ROAD);
  const half = ROAD_WIDTH / 2;
  const edge = ROAD_EDGE_WIDTH / 2;
  const drawn = new Set<string>();
  for (const { a, b } of segments) {
    const key = `${Math.round(a.x)},${Math.round(a.y)},${Math.round(b.x)},${Math.round(b.y)}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    g.fillStyle(ROAD_EDGE_COLOR, 1);
    drawParallel(g, a, b, half + edge);
    g.fillStyle(ROAD_COLOR, 1);
    drawParallel(g, a, b, half);
    g.fillCircle(a.x, a.y, half + edge);
    g.fillCircle(b.x, b.y, half + edge);
  }
}

export const ROAD_EDGE_WIDTH = 6;
