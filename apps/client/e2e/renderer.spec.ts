import { expect, test } from '@playwright/test';
import { startTestGame } from './helpers';

test('uses smooth Canvas for SwiftShader instead of the software WebGL readback path', async ({
  page,
}) => {
  await startTestGame(page);
  await page.waitForFunction(() => window.__db.art.boardReady);
  const renderer = await page.evaluate(() => {
    const probe = document.createElement('canvas');
    const gl =
      probe.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) ??
      probe.getContext('webgl', { failIfMajorPerformanceCaveat: true });
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const driver = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    const software = !gl || /SwiftShader|llvmpipe|softpipe/i.test(driver);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    const canvas = document.querySelector<HTMLCanvasElement>('#phaser-board canvas')!;
    const context = canvas.getContext('2d');
    return {
      driver,
      software,
      canvasRenderer: context !== null,
      smooth: context?.imageSmoothingEnabled,
      width: canvas.width,
      height: canvas.height,
    };
  });
  expect(renderer.canvasRenderer, renderer.driver).toBe(renderer.software);
  expect(renderer.width).toBe(1280);
  expect(renderer.height).toBe(720);
  if (renderer.software) expect(renderer.smooth).toBe(true);
});
