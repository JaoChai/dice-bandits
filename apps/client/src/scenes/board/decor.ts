import type Phaser from 'phaser';
import { REGION_PROPS } from '../../art/decorations';
import { REGION_VISUALS } from '../../art/tables';

export const DEPTH_DECOR_MIN = 10;

/** Frame index per prop name inside the 8-frame props atlas (0..7). */
export const PROP_FRAMES: Record<string, number> = Object.fromEntries(
  Object.entries(REGION_PROPS).flatMap(([, props]) => props.map((prop, index) => [prop, index])),
);

/**
 * Props are bottom-anchored sprites sorted by their y so nearer props draw
 * over farther ones. Falls back to small M1 colour dots when the region's
 * props atlas is missing.
 */
export function drawDecor(
  scene: Phaser.Scene,
  placed: { x: number; y: number; prop: string; region: string }[],
  propScale: number,
): Phaser.GameObjects.Image[] {
  const sorted = [...placed].sort((a, b) => a.y - b.y);
  const images: Phaser.GameObjects.Image[] = [];
  const fallbackColors = [0x2f7d32, 0xb5651d, 0x8d8d8d, 0x6b8e23];
  for (const prop of sorted) {
    const key = REGION_VISUALS[prop.region as keyof typeof REGION_VISUALS]?.props;
    const depth = DEPTH_DECOR_MIN + prop.y / 1000;
    if (key && scene.textures.exists(key)) {
      images.push(
        scene.add
          .image(prop.x, prop.y, key, PROP_FRAMES[prop.prop] ?? 0)
          .setOrigin(0.5, 1)
          .setScale(propScale)
          .setDepth(depth),
      );
    } else {
      const g = scene.add.graphics().setDepth(depth);
      g.fillStyle(fallbackColors[(prop.x + prop.y) % fallbackColors.length]!, 1);
      g.fillCircle(prop.x, prop.y - 3, 3);
      images.push(g as unknown as Phaser.GameObjects.Image);
    }
  }
  return images;
}
