import type Phaser from 'phaser';
import type { GameState, Region } from '@dice-bandits/engine';
import { REGION_VISUALS } from '../../art/tables';

export function battleRegion(state: GameState, spaceId: number): string {
  const region: Region =
    state.board.spaces.find((space) => space.id === spaceId)?.region ?? 'meadow';
  return REGION_VISUALS[region].backdrop;
}

export function drawBackdrop(scene: Phaser.Scene, state: GameState, spaceId: number): void {
  const key = battleRegion(state, spaceId);
  let renderedKey = '';
  if (scene.textures.exists(key) && scene.textures.get(key).has('0')) {
    renderedKey = scene.add.image(320, 180, key, 0).setDepth(-10).texture.key;
  } else {
    const region = key.slice('backdrop-'.length);
    const fallback = scene.textures.exists(key) ? key : `tile-${region}`;
    if (scene.textures.exists(fallback))
      renderedKey = scene.add.tileSprite(320, 180, 640, 360, fallback).setDepth(-10).texture.key;
    else scene.add.rectangle(320, 180, 640, 360, 0x273449).setDepth(-10);
  }
  if (import.meta.env.VITE_TEST_HOOKS === '1' && window.__db)
    window.__db.art.backdropKey = renderedKey;
  scene.add.rectangle(320, 240, 640, 4, 0x243143, 0.72).setDepth(-1);
}
