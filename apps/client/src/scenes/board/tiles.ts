import type Phaser from 'phaser';
import type { GameState, Space } from '@dice-bandits/engine';
import { ART } from '../../art/manifest';

export const DEPTH_TILES = 0;

/** Space tile size in map pixels (plan Task 6: ≥ 96). */
export const TILE_MAP_SIZE = 96;

const seatFlagColors = [0x2e7fe0, 0x3ba84a, 0x6c2ebe, 0xd42b3a, 0xf07818, 0xf06ea9];

/**
 * Draw the space tile (cartoon tiles atlas frame by kind) centred on each
 * space at its authored map position, with an owner town flag using the
 * seat colour. Falls back to a flat rounded marker when the atlas or the
 * frame is missing (Global Constraints: warn, never crash).
 */
export function drawTiles(
  scene: Phaser.Scene,
  spaces: Space[],
  owners: Map<number, number | null>,
  state?: GameState,
): Phaser.GameObjects.Image[] {
  const images: Phaser.GameObjects.Image[] = [];
  const textureKey = ART.tiles;
  const texture = scene.textures.exists(textureKey) ? scene.textures.get(textureKey) : undefined;
  const fallbackWarned = { value: false };
  for (const space of spaces) {
    // Review 2: art:tiles frames are named by kind (castle, town, …), not index.
    const frameName = space.kind;
    if (texture?.has(frameName)) {
      images.push(
        scene.add
          .image(space.x, space.y, textureKey, frameName)
          .setDisplaySize(TILE_MAP_SIZE, TILE_MAP_SIZE)
          .setDepth(DEPTH_TILES),
      );
    } else {
      warnFallback(fallbackWarned);
      const g = scene.add.graphics().setDepth(DEPTH_TILES);
      g.fillStyle(0xf3c744, 1);
      g.fillRoundedRect(
        space.x - TILE_MAP_SIZE / 2,
        space.y - TILE_MAP_SIZE / 2,
        TILE_MAP_SIZE,
        TILE_MAP_SIZE,
        12,
      );
    }
    const owner = owners.get(space.id);
    if (owner !== null && owner !== undefined) {
      const flag = scene.add.graphics().setDepth(DEPTH_TILES + 1);
      const color = seatFlagColors[owner % seatFlagColors.length]!;
      flag.fillStyle(color, 1);
      flag.fillRoundedRect(
        space.x + TILE_MAP_SIZE * 0.2,
        space.y - TILE_MAP_SIZE * 0.62,
        26,
        18,
        4,
      );
      flag.fillStyle(0x5c3317, 1);
      flag.fillRect(space.x + TILE_MAP_SIZE * 0.2, space.y - TILE_MAP_SIZE * 0.62, 4, 40);
    }
  }
  void state;
  return images;
}

function warnFallback(warned: { value: boolean }): void {
  if (warned.value) return;
  warned.value = true;
  console.warn('[art] fallback', ART.tiles);
}
