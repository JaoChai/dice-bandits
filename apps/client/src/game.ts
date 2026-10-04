import Phaser from 'phaser';
import BootScene from './scenes/BootScene';
import BoardScene from './scenes/BoardScene';
import BattleScene from './scenes/BattleScene';

/** M5a logical canvas: 720p cartoon stage, smooth (non-pixel-art) scaling. */
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/** Shared Phaser config factory: both hot-seat and online entry points. */
export function createGame(parent: string): Phaser.Game {
  const canvas = document.createElement('canvas');
  const hardware = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
  console.log('PROBE hardware-context', Boolean(hardware));
  hardware?.getExtension('WEBGL_lose_context')?.loseContext();
  return new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#273449',
    pixelArt: false,
    roundPixels: false,
    // Keep linear texture sampling, without a multisampled framebuffer.
    // MSAA resolves every 720p frame even on an unchanged board (SwiftShader).
    render: { antialias: true, antialiasGL: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, BoardScene, BattleScene],
  });
}
