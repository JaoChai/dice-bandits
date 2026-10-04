import type Phaser from 'phaser';
import { hasAnim, sheetKey } from '../../art/atlas';

/**
 * Above every board layer (painted map -10, road -5, tiles 0, buildings -2);
 * only selection rings (40+) draw over tokens.
 */
const TOKEN_DEPTH = 30;

export function tokenOffsets(countAtSpace: number): { x: number; y: number }[] {
  if (countAtSpace <= 0) return [];
  if (countAtSpace === 1) return [{ x: 0, y: 0 }];
  if (countAtSpace === 2)
    return [
      { x: -6, y: 0 },
      { x: 6, y: 0 },
    ];
  return [
    { x: -6, y: -6 },
    { x: 6, y: -6 },
    { x: -6, y: 6 },
    { x: 6, y: 6 },
  ].slice(0, countAtSpace);
}

/** Offsets for tokens in seat order, spread by how many share each space. */
export function tokenLayout(positions: number[]): { x: number; y: number }[] {
  const totals = new Map<number, number>();
  for (const pos of positions) totals.set(pos, (totals.get(pos) ?? 0) + 1);
  const seen = new Map<number, number>();
  return positions.map((pos) => {
    const index = seen.get(pos) ?? 0;
    seen.set(pos, index + 1);
    return tokenOffsets(totals.get(pos)!)[index]!;
  });
}

export function createHeroToken(
  scene: Phaser.Scene,
  classId: string,
  x: number,
  y: number,
  playIdle = true,
): Phaser.GameObjects.Image | Phaser.GameObjects.Sprite {
  const key = sheetKey('token', classId);
  if (!hasAnim(scene, key, 'idle')) {
    return scene.add.image(x, y, `hero-${classId}`).setDisplaySize(14, 14).setDepth(TOKEN_DEPTH);
  }

  const sprite = scene.add.sprite(x, y, key).setOrigin(0.5, 1).setDepth(TOKEN_DEPTH);
  if (playIdle) sprite.play(`${key}:idle`);
  return sprite;
}
