import type Phaser from 'phaser';
import type { Space, Town } from '@dice-bandits/engine';
import { MAP, data as engineData } from '@dice-bandits/engine';
import { ART } from '../../art/manifest';

export const DEPTH_BUILDINGS = -2;

/** Uniform cartoon scale for landmark buildings (Review 3): the ~270 px
 *  native frames render at this factor beside the 96 px space tiles. */
export const BUILDING_SCALE = 0.6;

/** Atlas frames for the card-mandated landmarks (Review 3). */
export const CASTLE_BUILDING = 'castle';
export const BARON_FORT_BUILDING = 'baronFort';

/** Authored baron-fort spot: inside the loop, volcano zone (card). */
export const BARON_FORT_AT = { x: 656, y: 900 } as const;

/** Castle stands about 250 px left of node 0 (card). */
const CASTLE_OFFSET_X = -250;

export function townTier(
  value: number,
  base = engineData.BALANCE.townBaseValue,
): 'town1' | 'town2' | 'town3' {
  if (value >= base * 4) return 'town3';
  if (value >= base * 2) return 'town2';
  return 'town1';
}

interface Placement {
  x: number;
  y: number;
}

function addBuilding(
  scene: Phaser.Scene,
  frame: string,
  at: Placement,
): Phaser.GameObjects.Image {
  const texture = scene.textures.get(ART.buildings);
  const native = texture.get(frame);
  const width = (native.width || 1) * BUILDING_SCALE;
  const height = (native.height || 1) * BUILDING_SCALE;
  return scene.add
    .image(at.x, at.y, ART.buildings, frame)
    .setDisplaySize(width, height)
    .setOrigin(0.5, 1)
    .setDepth(DEPTH_BUILDINGS);
}

export function drawBuildings(
  scene: Phaser.Scene,
  towns: Town[],
  positionOf: (spaceId: number) => { x: number; y: number } | undefined,
): Phaser.GameObjects.Image[] {
  if (!scene.textures.exists(ART.buildings)) return [];
  const texture = scene.textures.get(ART.buildings);
  const images: Phaser.GameObjects.Image[] = [];

  // Landmarks (Review 3): the castle beside node 0 and the baron fort in the
  // volcano loop draw on every authored board, independent of town ownership.
  const node0 = positionOf(0) ?? MAP.nodes[0];
  if (node0 && texture.has(CASTLE_BUILDING))
    images.push(addBuilding(scene, CASTLE_BUILDING, { x: node0.x + CASTLE_OFFSET_X, y: node0.y }));
  if (texture.has(BARON_FORT_BUILDING))
    images.push(addBuilding(scene, BARON_FORT_BUILDING, BARON_FORT_AT));

  for (const town of towns) {
    const at = positionOf(town.spaceId);
    if (!at) continue;
    const frame = townTier(town.value);
    if (!texture.has(frame)) continue;
    // Beside the tile (Review 3 / spec §6.3): clear the 96 px tile plus half
    // the scaled building; the bottom-centre origin plants it on the ground.
    const halfTile = 96 / 2;
    const width = texture.get(frame).width * BUILDING_SCALE;
    images.push(
      addBuilding(scene, frame, { x: at.x + halfTile + width / 2, y: at.y + halfTile }),
    );
  }
  return images;
}

export type { Space };
