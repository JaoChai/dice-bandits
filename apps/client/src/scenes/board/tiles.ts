import type Phaser from 'phaser';
import type { Space } from '@dice-bandits/engine';
import { SPACE_VISUALS } from '../../art/tables';

export const DEPTH_TILES = 0;
/** One slot in the tile atlas for the town-owner colour pip. */
const PIP_FRAME = 1;

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
  const atlas = scene.textures.exists('tiles');
  for (const space of spaces) {
    const point = toScreen(space.x, space.y);
    const frame = SPACE_VISUALS[space.kind].tile;
    if (atlas) {
      const image = scene.add
        .image(point.x, point.y, 'tiles', frame)
        .setDisplaySize(tileSize, tileSize)
        .setDepth(DEPTH_TILES);
      images.push(image);
      const owner = owners.get(space.id);
      if (owner !== null && owner !== undefined) {
        const pip = scene.add
          .image(point.x + tileSize * 0.32, point.y - tileSize * 0.32, 'tiles', PIP_FRAME)
          .setDisplaySize(6, 6)
          .setDepth(DEPTH_TILES + 1)
          .setTint(seatColors[owner % seatColors.length]!);
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
