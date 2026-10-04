import Phaser from 'phaser';
import BootScene from './scenes/BootScene';
import BoardScene from './scenes/BoardScene';
import BattleScene from './scenes/BattleScene';

/** M5a logical canvas: 720p cartoon stage, smooth (non-pixel-art) scaling. */
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/** Shared Phaser config factory: both hot-seat and online entry points. */
export function createGame(parent: string): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
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
  let mode: number | undefined;
  game.events.on('poststep', () => {
    const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    if (mode === undefined) {
      mode = renderer.blendModes.length;
      renderer.addBlendMode([renderer.gl.ONE, renderer.gl.ZERO], renderer.gl.FUNC_ADD);
      console.log(
        'PROBE copy-blend',
        JSON.stringify({ mode, parameters: renderer.blendModes[mode] }),
      );
    }
    const board = game.scene.getScene('BoardScene');
    for (const child of board?.children?.list ?? []) {
      const image = child as Phaser.GameObjects.Image;
      if (image.depth === -10) image.setBlendMode(mode);
    }
  });
  return game;
}
