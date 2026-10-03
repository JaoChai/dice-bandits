import type Phaser from 'phaser';
import type { GameState } from '@dice-bandits/engine';
import { motionScale, reducedMotion } from '../../art/motion';

export const DEPTH_FORK = 20;

/**
 * Animated fork arrows (spec §7): one arrow per branch option, drawn past
 * the midpoint of each branch edge while `chooseBranch` is pending. Tapping
 * an arrow or the destination tile dispatches that branch; both stay
 * clickable while the space-info popup is open (Review Focus 3).
 */
export function drawForkArrows(
  scene: Phaser.Scene,
  state: GameState,
  onChoose: (to: number) => void,
): Phaser.GameObjects.GameObject[] {
  if (state.phase.kind !== 'chooseBranch') return [];
  const from = state.board.spaces.find((space) => space.next.length > 1);
  const objects: Phaser.GameObjects.GameObject[] = [];
  for (const to of state.phase.options) {
    const destination = state.board.spaces.find((space) => space.id === to);
    const origin = from ?? state.board.spaces.find((space) => space.id === state.turnSeat);
    if (!destination || !origin) continue;
    const midX = (origin.x + destination.x) / 2;
    const midY = (origin.y + destination.y) / 2;

    const g = scene.add.graphics().setDepth(DEPTH_FORK);
    g.fillStyle(0xf5c51c, 1);
    const angle = Math.atan2(destination.y - origin.y, destination.x - origin.x);
    const size = 18;
    // Chunky triangle pointing at the destination.
    const tipX = midX + Math.cos(angle) * size;
    const tipY = midY + Math.sin(angle) * size;
    const leftX = midX + Math.cos(angle + (2.5 * Math.PI) / 3) * size;
    const leftY = midY + Math.sin(angle + (2.5 * Math.PI) / 3) * size;
    const rightX = midX + Math.cos(angle - (2.5 * Math.PI) / 3) * size;
    const rightY = midY + Math.sin(angle - (2.5 * Math.PI) / 3) * size;
    g.fillTriangle(tipX, tipY, leftX, leftY, rightX, rightY);
    g.lineStyle(4, 0x5c3317, 1);
    g.strokeTriangle(tipX, tipY, leftX, leftY, rightX, rightY);

    const hit = scene.add
      .zone(midX, midY, size * 3, size * 3)
      .setOrigin(0.5)
      .setDepth(DEPTH_FORK + 1)
      .setInteractive({ useHandCursor: true });
    hit.setName(`fork-arrow-${to}`);
    hit.on('pointerdown', () => onChoose(to));

    if (motionScale() > 0 && !reducedMotion()) {
      scene.tweens.add({
        targets: [g, hit],
        y: midY - 8,
        duration: 500 * motionScale(),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    objects.push(g, hit);
  }
  return objects;
}
