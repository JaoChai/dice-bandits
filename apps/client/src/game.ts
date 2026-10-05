import Phaser from 'phaser';
import BootScene from './scenes/BootScene';
import BoardScene from './scenes/BoardScene';
import BattleScene from './scenes/BattleScene';

/** M5a logical canvas: 720p cartoon stage, smooth (non-pixel-art) scaling. */
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/** AUTO checks WebGL availability, not acceleration. Software WebGL adds a
 * synchronous framebuffer readback to every painted-map frame. Keep WebGL on
 * hardware, but use Phaser's smooth Canvas renderer for software fallbacks. */
function rendererType(): number {
  const canvas = document.createElement('canvas');
  for (const context of ['webgl2', 'webgl'] as const) {
    try {
      const gl = canvas.getContext(context, { failIfMajorPerformanceCaveat: true }) as
        WebGLRenderingContext | WebGL2RenderingContext | null;
      if (!gl) continue;
      // Chromium can accept the caveat probe even with SwiftShader Subzero.
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const driver = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe/i.test(driver) ? Phaser.CANVAS : Phaser.AUTO;
    } catch {
      // Disabled/unsupported WebGL must not prevent the Canvas fallback.
    }
  }
  return Phaser.CANVAS;
}

/** Shared Phaser config factory: both hot-seat and online entry points. */
export function createGame(parent: string): Phaser.Game {
  return new Phaser.Game({
    type: rendererType(),
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
