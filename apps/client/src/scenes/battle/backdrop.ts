import type Phaser from 'phaser';
import type { GameState, Region } from '@dice-bandits/engine';
import { ART } from '../../art/manifest';
import { BATTLE_FRAME } from './layout';

export function battleRegion(state: GameState, spaceId: number): Region {
  return state.board.spaces.find((space) => space.id === spaceId)?.region ?? 'meadow';
}

/** Canvas is the full 1280×720 stage; only test hooks observe the key. */
const CANVAS_CENTRE = { x: BATTLE_FRAME.width / 2, y: BATTLE_FRAME.height / 2 };

export function drawBackdrop(scene: Phaser.Scene, state: GameState, spaceId: number): void {
  const key = ART.backdrops[battleRegion(state, spaceId)];
  let renderedKey = '';
  if (scene.textures.exists(key) && scene.textures.get(key).has('bg')) {
    renderedKey = scene.add.image(CANVAS_CENTRE.x, CANVAS_CENTRE.y, key, 'bg').setDepth(-10)
      .texture.key;
  } else {
    // Global Constraints: missing/failed asset → flat-shape fallback + warn.
    console.warn('[art] fallback', key);
    scene.add
      .rectangle(
        CANVAS_CENTRE.x,
        CANVAS_CENTRE.y,
        BATTLE_FRAME.width,
        BATTLE_FRAME.height,
        0x273449,
      )
      .setDepth(-10);
  }
  if (import.meta.env.VITE_TEST_HOOKS === '1' && window.__db)
    window.__db.art.backdropKey = renderedKey;
}
