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
    render: {
      antialias: true,
      antialiasGL: false,
      maxTextures: import.meta.env.VITE_PROBE_MODE === 'global-single' ? 1 : -1,
    },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, BoardScene, BattleScene],
  });
  game.events.on('poststep', () => {
    if (import.meta.env.VITE_PROBE_MODE !== 'map-single') return;
    const manager = (game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).renderNodes;
    let node = manager.getNode(
      'TerrainSingle',
    ) as Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuad;
    if (!node) {
      node = new Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuad(manager, {
        name: 'TerrainSingle',
      });
      node.updateTextureCount(1);
      manager.addNode('TerrainSingle', node);
    }
    const board = game.scene.getScene('BoardScene');
    for (const child of board?.children?.list ?? []) {
      const image = child as Phaser.GameObjects.Image;
      if (image.depth === -10) image.setRenderNodeRole('BatchHandler', node);
    }
  });
  return game;
}
