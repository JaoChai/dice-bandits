import type Phaser from 'phaser';
import type { GameState } from '@dice-bandits/engine';
import { openSpaceInfo } from '../../ui/spaceInfo';

/** Tap threshold in map pixels: tiles are ≥ 96 map px, so a tap within a
 *  half-tile of a centre selects that space (plan Task 6). */
const TAP_RADIUS = 64;

export interface SpaceTapContext {
  state: GameState;
  wholeMap: boolean;
}

/** Live unbind for the currently bound pointerdown handler (Review 6a). */
let unbind: (() => void) | null = null;

/**
 * Tap-a-space handler (Review 6a): exactly one `pointerdown` listener per
 * scene at any time. BoardScene re-renders many times per game — each bind
 * first removes the previous handler so listeners never pile up, and the
 * handler always reads the latest context through `contextOf`.
 */
export function bindSpaceTaps(
  scene: Pick<Phaser.Scene, 'input' | 'cameras'>,
  contextOf: () => SpaceTapContext,
  onWholeMapExit: () => void,
): () => void {
  // Review 6a: the previous handler must go before the new one binds, or
  // re-renders pile up stale listeners.
  unbind?.();
  const handler = (pointer: Phaser.Input.Pointer): void => {
    const { state, wholeMap } = contextOf();
    if (wholeMap) {
      onWholeMapExit();
      return;
    }
    const camera = scene.cameras.main;
    const worldPoint = camera.getWorldPoint(pointer.x, pointer.y);
    let nearest: { id: number; distance: number } | null = null;
    for (const space of state.board.spaces) {
      const distance = Math.hypot(space.x - worldPoint.x, space.y - worldPoint.y);
      if (!nearest || distance < nearest.distance) nearest = { id: space.id, distance };
    }
    if (nearest && nearest.distance <= TAP_RADIUS) openSpaceInfo(document.body, state, nearest.id);
  };
  scene.input.on('pointerdown', handler);
  unbind = () => {
    scene.input.off('pointerdown', handler);
  };
  return unbind;
}
