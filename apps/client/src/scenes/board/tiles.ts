import type Phaser from 'phaser';
import type { Space } from '@dice-bandits/engine';
import { SPACE_VISUALS } from '../../art/tables';

export const DEPTH_TILES = 0;

const seatColors = [0xf15b4a, 0x52c2ed, 0xa5d65b, 0xcd76d7];

/**
 * Draw the space tile (tiles-atlas frame by kind) centred on each space and
 * a town-owner colour pip. Falls back to the M1 rounded-rect marker when the
 * `tiles` atlas is missing.
 */
export function drawTiles(
  scene: Phaser.Scene,
  spaces: Space[],
  toScreen: (x: number, y: number) => { x: number; y: number },
  tileSize: number,
  owners: Map<number, number | null>,
): Phaser.GameObjects.Image[] {
  const images: Phaser.GameObjects.Image[] = [];
  const texture = scene.textures.exists('tiles') ? scene.textures.get('tiles') : undefined;
  // Native 16px art is smaller than the board spacing. Never interpolate
  // atlas pixels to a fractional display scale.
  for (const space of spaces) {
    const point = toScreen(space.x, space.y);
    const frame = SPACE_VISUALS[space.kind].tile;
    if (texture?.has(String(frame))) {
      const image = scene.add.image(point.x, point.y, 'tiles', frame).setDepth(DEPTH_TILES);
      images.push(image);
      const owner = owners.get(space.id);
      if (owner !== null && owner !== undefined) {
        const pip = scene.add
          .circle(
            point.x + tileSize * 0.32,
            point.y - tileSize * 0.32,
            3,
            seatColors[owner % seatColors.length]!,
          )
          .setDepth(DEPTH_TILES + 1);
        images.push(pip as unknown as Phaser.GameObjects.Image);
      }
    } else {
      const g = scene.add.graphics().setDepth(DEPTH_TILES);
      g.fillStyle(0xf3c744, 1);
      g.fillRoundedRect(point.x - 7, point.y - 7, 14, 14, 3);
    }
  }
  return images;
}
