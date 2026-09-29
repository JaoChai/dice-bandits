import Phaser from 'phaser';

export const DEPTH_ROAD = -5;
export const ROAD_COLOR = 0xe8d8a8;
export const ROAD_EDGE_COLOR = 0x8a7346;
export const ROAD_WIDTH = 6;

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
 * Cream 6 px road polyline (darker 1 px edges) along every undirected `next`
 * edge, drawn as one graphics pass under the tiles, with rounded joints
 * (small discs at each endpoint).
 */
export function drawRoad(scene: Phaser.Scene, segments: Segment[]): void {
  if (segments.length === 0) return;
  const g = scene.add.graphics().setDepth(DEPTH_ROAD);
  const half = ROAD_WIDTH / 2;
  const drawn = new Set<string>();
  for (const { a, b } of segments) {
    const key = `${Math.round(a.x)},${Math.round(a.y)},${Math.round(b.x)},${Math.round(b.y)}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    g.fillStyle(ROAD_EDGE_COLOR, 1);
    drawParallel(g, a, b, half + 0.5);
    g.fillStyle(ROAD_COLOR, 1);
    drawParallel(g, a, b, half);
    g.fillCircle(a.x, a.y, half);
    g.fillCircle(b.x, b.y, half);
  }
}
