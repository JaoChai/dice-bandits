import type Phaser from 'phaser';
import type { Board, Space } from '@dice-bandits/engine';
import { MAP } from '@dice-bandits/engine';
import { ART } from '../../art/manifest';

/**
 * Painted map background (plan Task 6): `ART.mapTiles` describes the 5×3 grid
 * of 640×600 WebP tiles that tile the 3200×1800 authored map. Tiles are added
 * as plain images; the follow camera's Phaser culling keeps only visible ones
 * on the render list. Missing tiles draw a region-tinted flat fallback and
 * warn once, per Global Constraints.
 */
export function drawMapLayer(scene: Phaser.Scene): Phaser.GameObjects.Image[] {
  const images: Phaser.GameObjects.Image[] = [];
  const { cols, rows, tile } = ART.mapTiles;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const key = `map-r${row}c${col}`;
      const x = col * tile[0] + tile[0] / 2;
      const y = row * tile[1] + tile[1] / 2;
      if (scene.textures.exists(key)) {
        images.push(scene.add.image(x, y, key).setDepth(DEPTH_MAP));
      } else if (scene.textures.exists('art:map')) {
        images.push(scene.add.image(x, y, 'art:map', `r${row}c${col}`).setDepth(DEPTH_MAP));
      } else {
        warnMissingTile(key);
        images.push(
          scene.add
            .rectangle(x, y, tile[0], tile[1], 0x2e4d38)
            .setDepth(DEPTH_MAP) as unknown as Phaser.GameObjects.Image,
        );
      }
    }
  }
  return images;
}

let warnedMissingTile = false;
function warnMissingTile(key: string): void {
  if (warnedMissingTile) return;
  warnedMissingTile = true;
  console.warn('[art] fallback', key);
}

export const DEPTH_MAP = -10;

/**
 * Undirected road segments in map pixels, one per `next` edge.
 */
export function roadSegments(
  board: Board,
): { a: { x: number; y: number }; b: { x: number; y: number } }[] {
  const byId = new Map(board.spaces.map((space) => [space.id, space]));
  const segments: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  const seen = new Set<string>();
  for (const space of board.spaces) {
    for (const nextId of space.next) {
      const other = byId.get(nextId);
      if (!other || other.id === space.id) continue;
      const key = space.id < other.id ? `${space.id}-${other.id}` : `${other.id}-${space.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      segments.push({ a: { x: space.x, y: space.y }, b: { x: other.x, y: other.y } });
    }
  }
  return segments;
}

/**
 * Guard for pre-deploy online rooms (Review Focus 2): a view whose board was
 * generated from a different map must never be rendered. `true` only when
 * every MAP node is present with identical coordinates and adjacency.
 */
export function validate(board: Board): boolean {
  if (board.spaces.length !== MAP.nodes.length) return false;
  const byId = new Map(board.spaces.map((space) => [space.id, space]));
  for (const node of MAP.nodes) {
    const space = byId.get(node.id);
    if (!space) return false;
    if (space.x !== node.x || space.y !== node.y) return false;
    if (space.region !== node.region) return false;
    const next = [...space.next].sort((a, b) => a - b);
    const expected = [...node.next].sort((a, b) => a - b);
    if (next.length !== expected.length || next.some((id, index) => id !== expected[index]))
      return false;
  }
  return true;
}

/** Map-pixel position of a space id. */
export function spacePosition(board: Board, spaceId: number): { x: number; y: number } | undefined {
  const space: Space | undefined = board.spaces.find((candidate) => candidate.id === spaceId);
  return space ? { x: space.x, y: space.y } : undefined;
}
