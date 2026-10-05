import type Phaser from 'phaser';
import type { GameState, Region } from '@dice-bandits/engine';
import { ART } from '../../art/manifest';
import { BATTLE_FRAME } from './layout';

export function battleRegion(state: GameState, spaceId: number): Region {
  return state.board.spaces.find((space) => space.id === spaceId)?.region ?? 'meadow';
}

export function drawBackdrop(
  scene: Phaser.Scene,
  state: GameState,
  spaceId: number,
  view: { width: number; height: number } = BATTLE_FRAME,
): void {
  const key = ART.backdrops[battleRegion(state, spaceId)];
  let renderedKey = '';
  if (scene.textures.exists(key) && scene.textures.get(key).has('bg')) {
    // Uniform cover keeps the painted backdrop undistorted at every aspect.
    renderedKey = scene.add
      .image(view.width / 2, view.height / 2, key, 'bg')
      .setScale(Math.max(view.width / BATTLE_FRAME.width, view.height / BATTLE_FRAME.height))
      .setDepth(-10).texture.key;
  } else {
    // Global Constraints: missing/failed asset → flat-shape fallback + warn.
    console.warn('[art] fallback', key);
    scene.add
      .rectangle(view.width / 2, view.height / 2, view.width, view.height, 0x273449)
      .setDepth(-10);
  }
  if (import.meta.env.VITE_TEST_HOOKS === '1' && window.__db)
    window.__db.art.backdropKey = renderedKey;
}
