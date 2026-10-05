import type Phaser from 'phaser';
import type { Board, Space } from '@dice-bandits/engine';
import { MAP } from '@dice-bandits/engine';
import { ART } from '../../art/manifest';

/**
 * Painted map background (plan Task 6): `ART.mapTiles` describes the 5×3 grid
 * of 640×600 WebP tiles that tile the 3200×1800 authored map. Tiles are added
 * as images with an explicit camera-bounds gate. Phaser's ordinary Image
 * willRender only checks flags, not bounds: without this gate all 15 large
 * textures are submitted even when most are offscreen. Missing tiles draw
 * a region-tinted flat fallback and warn once, per Global Constraints.
 */
export function drawMapLayer(
  scene: Phaser.Scene,
  bounds = { x: 0, y: 0, width: MAP.width, height: MAP.height },
): Phaser.GameObjects.Image[] {
  const images: Phaser.GameObjects.Image[] = [];
  const { cols, rows, tile } = ART.mapTiles;
  // Reflect existing terrain at native resolution into the fit-view gutters.
  // No extra textures, stretched art, or renderer-background letterboxing.
  const reflected = (index: number, count: number) => {
    const position = ((index % (count * 2)) + count * 2) % (count * 2);
    return {
      index: position < count ? position : count * 2 - position - 1,
      flip: position >= count,
    };
  };
  for (
    let row = Math.floor(bounds.y / tile[1]);
    row < Math.ceil((bounds.y + bounds.height) / tile[1]);
    row++
  ) {
    for (
      let col = Math.floor(bounds.x / tile[0]);
      col < Math.ceil((bounds.x + bounds.width) / tile[0]);
      col++
    ) {
      const sourceRow = reflected(row, rows);
      const sourceCol = reflected(col, cols);
      const key = `map-r${sourceRow.index}c${sourceCol.index}`;
      const x = col * tile[0] + tile[0] / 2;
      const y = row * tile[1] + tile[1] / 2;
      if (scene.textures.exists(key)) {
        images.push(scene.add.image(x, y, key).setDepth(DEPTH_MAP));
      } else if (scene.textures.exists('art:map')) {
        images.push(
          scene.add
            .image(x, y, 'art:map', `r${sourceRow.index}c${sourceCol.index}`)
            .setDepth(DEPTH_MAP),
        );
      } else {
        warnMissingTile(key);
        images.push(
          scene.add
            .rectangle(x, y, tile[0], tile[1], 0x2e4d38)
            .setDepth(DEPTH_MAP) as unknown as Phaser.GameObjects.Image,
        );
      }
      const image = images[images.length - 1]!;
      if (sourceCol.flip && 'setFlipX' in image) image.setFlipX(true);
      if (sourceRow.flip && 'setFlipY' in image) image.setFlipY(true);
      const nativeWillRender = image.willRender;
      image.willRender = (camera) => {
        // CameraManager preRender updates worldView before willRender checks,
        // so this follows pans/zoom without stale bounds or extra listeners.
        const view = camera.worldView;
        return (
          nativeWillRender.call(image, camera) &&
          x + tile[0] / 2 > view.x &&
          x - tile[0] / 2 < view.x + view.width &&
          y + tile[1] / 2 > view.y &&
          y - tile[1] / 2 < view.y + view.height
        );
      };
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
