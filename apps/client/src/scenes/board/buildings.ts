import type Phaser from 'phaser';
import type { Space, Town } from '@dice-bandits/engine';
import { data as engineData } from '@dice-bandits/engine';
import { ART } from '../../art/manifest';

export const DEPTH_BUILDINGS = -2;

/**
 * Town buildings from the `buildings` atlas, chosen by value tier
 * (plan Task 6): `town1` below 2× base value, `town2` below 4×, `town3`
 * from 4× up. Anchored at the space centre; the atlas frame carries its own
 * bottom-centre anchor. Missing atlas → nothing draws (tiles + flags still
 * mark the space).
 */
export function townTier(
  value: number,
  base = engineData.BALANCE.townBaseValue,
): 'town1' | 'town2' | 'town3' {
  if (value >= base * 4) return 'town3';
  if (value >= base * 2) return 'town2';
  return 'town1';
}

export function drawBuildings(
  scene: Phaser.Scene,
  towns: Town[],
  positionOf: (spaceId: number) => { x: number; y: number } | undefined,
): Phaser.GameObjects.Image[] {
  if (!scene.textures.exists(ART.buildings)) return [];
  const texture = scene.textures.get(ART.buildings);
  const images: Phaser.GameObjects.Image[] = [];
  for (const town of towns) {
    const at = positionOf(town.spaceId);
    if (!at) continue;
    const frame = townTier(town.value);
    if (!texture.has(frame)) continue;
    images.push(scene.add.image(at.x, at.y, ART.buildings, frame).setDepth(DEPTH_BUILDINGS));
  }
  return images;
}

export type { Space };
