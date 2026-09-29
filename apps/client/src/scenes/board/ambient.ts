import type Phaser from 'phaser';
import { REGION_VISUALS } from '../../art/tables';
import { reducedMotion } from '../../art/motion';

export const DEPTH_AMBIENT_MIN = 10;

/**
 * Animated pond/oasis/frozen-pond/lava sprites in open ground, `loop` anim at
 * 32 px, y-sorted with the other decor. Falls back to a still M1 colour dot.
 */
export function drawAmbients(
  scene: Phaser.Scene,
  placed: { x: number; y: number; region: string }[],
  ambientScale: number,
): Phaser.GameObjects.Sprite[] {
  const sprites: Phaser.GameObjects.Sprite[] = [];
  for (const ambient of [...placed].sort((a, b) => a.y - b.y)) {
    const key = REGION_VISUALS[ambient.region as keyof typeof REGION_VISUALS]?.ambient;
    const depth = DEPTH_AMBIENT_MIN + ambient.y / 1000;
    if (!key || !scene.textures.exists(key) || !scene.textures.get(key).has('0')) {
      const g = scene.add.graphics().setDepth(depth);
      g.fillStyle(0x4aa5c8, 1);
      g.fillCircle(ambient.x, ambient.y, 6);
      sprites.push(g as unknown as Phaser.GameObjects.Sprite);
      continue;
    }
    const sprite = scene.add
      .sprite(ambient.x, ambient.y, key, 0)
      .setScale(ambientScale)
      .setDepth(depth);
    if (hasLoop(scene, key) && !reducedMotion() && window.diceBanditsSpeed > 0) {
      sprite.play(`${key}:loop`);
      if (import.meta.env.VITE_TEST_HOOKS === '1' && window.__db)
        window.__db.art.ambientRunning = true;
    }
    sprites.push(sprite);
  }
  return sprites;
}

function hasLoop(scene: Phaser.Scene, key: string): boolean {
  return scene.anims.exists(`${key}:loop`);
}
