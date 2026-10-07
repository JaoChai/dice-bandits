import type Phaser from 'phaser';
import type { GameState } from '@dice-bandits/engine';
import { motionScale, reducedMotion } from '../../art/motion';
import { createHeroToken } from './tokens';
import type { MovementPlan } from './movementPlan';

/** Detached cosmetic objects only. Authoritative tokens remain visible and
 * interactive throughout, so cancellation never has to restore a hidden seat. */
export function createMovementOverlay(scene: Phaser.Scene): {
  play(plan: MovementPlan, generation: number): void;
  destroy(): void;
} {
  let generation: number | null = null;
  let revision = 0;
  let tween: Phaser.Tweens.Tween | undefined;
  const ghosts = new Map<number, Phaser.GameObjects.Image>();
  const clear = (): void => {
    revision++;
    tween?.remove();
    tween = undefined;
    for (const ghost of ghosts.values()) ghost.destroy();
    ghosts.clear();
  };
  return {
    destroy: () => {
      clear();
      generation = null;
    },
    play(plan, nextGeneration) {
      clear();
      generation = nextGeneration;
      if (motionScale() <= 0 || reducedMotion() || plan.segments.length === 0) return;
      const state = scene.game.registry.get('state') as GameState | undefined;
      if (!state) return;
      const spaces = new Map(state.board.spaces.map((space) => [space.id, space]));
      const ownedRevision = revision;
      const advance = (index: number): void => {
        if (revision !== ownedRevision || generation !== nextGeneration) return;
        const segment = plan.segments[index];
        if (!segment) {
          clear();
          return;
        }
        const source = spaces.get(segment.from);
        const destination = spaces.get(segment.to);
        const player = state.players.find((entry) => entry.seat === segment.seat);
        if (!source || !destination || !player) {
          clear();
          return;
        }
        let ghost = ghosts.get(segment.seat);
        if (!ghost) {
          ghost = createHeroToken(scene, player.classId, source.x, source.y)
            .setAlpha(0.65)
            .setDepth(35)
            .setName(`online-movement-${segment.seat}`);
          ghosts.set(segment.seat, ghost);
        }
        ghost.setFlipX(destination.x < ghost.x);
        tween = scene.tweens.add({
          targets: ghost,
          x: destination.x,
          y: destination.y,
          duration: segment.hopMs,
          ease: 'Sine.easeInOut',
          onComplete: () => {
            if (revision !== ownedRevision || generation !== nextGeneration) return;
            tween = undefined;
            advance(index + 1);
          },
        });
      };
      advance(0);
    },
  };
}
