import type Phaser from 'phaser';
import type { Region } from '@dice-bandits/engine';
import { REGION_VISUALS } from '../../art/tables';
import type { ScreenPoint } from './layout';

export const DEPTH_GROUND = -10;

const CELL = 32;
/** Soft-dither geometry: sparse 2 px dots in a wide checker lattice. */
const DITHER_DOT = 2;
const DITHER_STEP = 8;

/** Flat fallback and dither colours per region (sampled from the ground sheets). */
const GROUND_COLORS: Record<Region, number> = {
  meadow: 0x4f9e4f,
  desert: 0xd9c07c,
  snow: 0xdfe8ee,
  volcano: 0x4a3a3d,
};

export interface GroundCell {
  gx: number;
  gy: number;
  region: Region;
  variation: number;
  /** Neighbouring region to dither into along a region seam. */
  dither?: Region;
}

/**
 * 32 px ground cells covering the canvas; each takes its nearest space's
 * region. Cells on a region seam carry the neighbouring region so the seam
 * gets a one-cell dithered border.
 */
export function groundRegions(
  spaces: { x: number; y: number; region: Region }[],
  toScreen: (x: number, y: number) => ScreenPoint,
  width: number,
  height: number,
): GroundCell[] {
  const centres = spaces.map((space) => ({
    point: toScreen(space.x, space.y),
    region: space.region,
  }));
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const grid: Region[][] = [];
  for (let col = 0; col < cols; col++) {
    grid.push([]);
    for (let row = 0; row < rows; row++) {
      const gx = col * CELL + CELL / 2;
      const gy = row * CELL + CELL / 2;
      let best = centres[0]!;
      let bestDistance = Infinity;
      for (const candidate of centres) {
        const distance = Math.hypot(candidate.point.x - gx, candidate.point.y - gy);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
      grid[col]!.push(best.region);
    }
  }
  const cells: GroundCell[] = [];
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const region = grid[col]![row]!;
      const neighbours = [
        grid[col - 1]?.[row],
        grid[col + 1]?.[row],
        grid[col]?.[row - 1],
        grid[col]?.[row + 1],
      ];
      const dither = neighbours.find((other) => other !== undefined && other !== region);
      cells.push({
        gx: col * CELL + CELL / 2,
        gy: row * CELL + CELL / 2,
        region,
        variation: (col * 7 + row * 13) % 2,
        ...(dither ? { dither } : {}),
      });
    }
  }
  return cells;
}

/**
 * Cover the whole canvas with region ground (two-frame variation per cell),
 * a flat colour where a region's ground atlas is missing, and a 4 px
 * checkerboard dither along region seams.
 */
export function drawGround(
  scene: Phaser.Scene,
  spaces: { x: number; y: number; region: Region }[],
  toScreen: (x: number, y: number) => ScreenPoint,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const cells = groundRegions(spaces, toScreen, canvasWidth, canvasHeight);
  const flat = scene.add.graphics().setDepth(DEPTH_GROUND);
  for (const cell of cells) {
    const key = REGION_VISUALS[cell.region].ground;
    if (scene.textures.exists(key) && scene.textures.get(key).has(String(cell.variation))) {
      scene.add.image(cell.gx, cell.gy, key, cell.variation).setDepth(DEPTH_GROUND);
    } else {
      flat.fillStyle(GROUND_COLORS[cell.region], 1);
      flat.fillRect(cell.gx - CELL / 2, cell.gy - CELL / 2, CELL, CELL);
    }
  }
  const dither = scene.add.graphics().setDepth(DEPTH_GROUND + 1);
  for (const cell of cells) {
    if (!cell.dither) continue;
    dither.fillStyle(GROUND_COLORS[cell.dither], 1);
    const left = cell.gx - CELL / 2;
    const top = cell.gy - CELL / 2;
    // Soft border: sparse 2 px dots (~6% coverage) in a 8 px checker lattice,
    // so seams read as a textured transition instead of a placeholder pattern.
    for (let dx = 0; dx < CELL; dx += DITHER_STEP) {
      for (let dy = 0; dy < CELL; dy += DITHER_STEP) {
        if ((dx / DITHER_STEP + dy / DITHER_STEP) % 2 === 0) {
          dither.fillRect(left + dx + 3, top + dy + 3, DITHER_DOT, DITHER_DOT);
        }
      }
    }
  }
}
