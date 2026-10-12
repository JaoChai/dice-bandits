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
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const ghosts = new Map<number, Phaser.GameObjects.Image>();
  const clear = (): void => {
    revision++;
    clearTimeout(deadline);
    deadline = undefined;
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
      // Phaser smooths long frame gaps down to 33ms. Tween durations alone
      // cannot bound wall-clock lifetime; this cosmetic view must expire even
      // when scene updates stall. Cancellation owns both clocks.
      deadline = setTimeout(() => {
        if (revision !== ownedRevision || generation !== nextGeneration) return;
        // Finish only existing cosmetic ghosts at their authored endpoints.
        // Never move (or hide) authoritative tokens or create skipped ghosts.
        for (const segment of plan.segments) {
          const ghost = ghosts.get(segment.seat);
          const destination = spaces.get(segment.to);
          if (ghost && destination) {
            ghost.x = destination.x;
            ghost.y = destination.y;
          }
        }
        clear();
      }, 600);
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
        const startX = ghost.x,
          startY = ghost.y,
          baseScaleY = ghost.scaleY;
        const hop = { progress: 0 };
        tween = scene.tweens.add({
          targets: hop,
          progress: 1,
          duration: segment.hopMs,
          ease: 'Linear',
          onUpdate: () => {
            if (revision !== ownedRevision || generation !== nextGeneration) return;
            const k = hop.progress;
            ghost.x = startX + (destination.x - startX) * k;
            ghost.y = startY + (destination.y - startY) * k - Math.sin(Math.PI * k) * 26;
            ghost.scaleY = baseScaleY * (k >= 0.85 ? 0.88 + (0.12 * (k - 0.85)) / 0.15 : 1);
          },
          onComplete: () => {
            if (revision !== ownedRevision || generation !== nextGeneration) return;
            ghost.x = destination.x;
            ghost.y = destination.y;
            ghost.scaleY = baseScaleY;
            tween = undefined;
            advance(index + 1);
          },
        });
      };
      advance(0);
    },
  };
}
