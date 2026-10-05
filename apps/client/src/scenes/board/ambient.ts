import type Phaser from 'phaser';
import { reducedMotion } from '../../art/motion';

export const DEPTH_AMBIENTS = 15;

/** One soft accent colour per region; the map art stays the hero. */
const ACCENTS: Record<string, number> = {
  meadow: 0x7fc8f8,
  desert: 0xf8d47f,
  snow: 0xd8f4ff,
  volcano: 0xf8845f,
};

/**
 * M5a ambient life (spec §5): tween-only accents — at most one per region,
 * no sprites or atlases, drawn above the tiles. Runs only at speed > 0 with
 * motion allowed, and flags the E2E `ambientRunning` probe when it does.
 */
export function drawAmbients(
  scene: Phaser.Scene,
  nodes: readonly { id: number; x: number; y: number; region: string }[],
): void {
  if (reducedMotion() || window.diceBanditsSpeed <= 0) return;
  const firstByRegion = new Map<string, { x: number; y: number }>();
  for (const node of nodes)
    if (!firstByRegion.has(node.region)) firstByRegion.set(node.region, node);
  for (const [region, node] of firstByRegion) {
    const glow = scene.add.graphics().setDepth(DEPTH_AMBIENTS);
    glow.fillStyle(ACCENTS[region] ?? 0xffffff, 1);
    glow.fillCircle(node.x, node.y, 10);
    scene.tweens.add({
      targets: glow,
      alpha: 0.35,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    // The E2E probe exists only when the app ran with test hooks; gate on it
    // directly so the flag works in every build/runtime.
    if (window.__db) window.__db.art.ambientRunning = true;
  }
}
