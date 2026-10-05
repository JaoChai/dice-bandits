import { expect, test } from '@playwright/test';
import { playUntil, startJourney, waitForBattleArt } from './helpers';

test('battle art waits for the renderer, not the already visible DOM', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/art/hero-knight.webp', async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await startJourney(page, 1);
    await playUntil(page, (state) => state.phase.kind === 'battle');
    await expect(page.locator('.battle-panel')).toBeVisible();
    expect(
      await page.evaluate(() => ({
        board: window.__db!.art.boardReady,
        battle: window.__db!.art.battleReady,
        ambient: window.__db!.art.ambientRunning,
        backdrop: window.__db!.art.backdropKey,
      })),
    ).toEqual({ board: false, battle: false, ambient: false, backdrop: undefined });
    let resolved = false;
    const ready = waitForBattleArt(page).then(() => {
      resolved = true;
    });
    // A real browser event-loop turn, not a guessed loading delay. A DOM-only
    // waiter resolves here, even though the gated asset cannot have loaded.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(resolved, 'visible HUD is not proof that the canvas scenes have rendered').toBe(false);
    await page.screenshot({ path: test.info().outputPath('asset-loading.png') });
    release();
    await ready;
    expect(
      await page.evaluate(() => ({
        board: window.__db!.art.boardReady,
        battle: window.__db!.art.battleReady,
        ambient: window.__db!.art.ambientRunning,
        backdrop: window.__db!.art.backdropKey,
      })),
    ).toEqual({ board: true, battle: true, ambient: true, backdrop: 'art:backdrop-meadow' });
    const renderer = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#phaser-board canvas')!;
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        type: gl ? 'WEBGL' : 'CANVAS',
        driver: gl && ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
        width: canvas.width,
        height: canvas.height,
        antialiasGL: gl?.getContextAttributes()?.antialias ?? false,
      };
    });
    console.log(`Renderer (${test.info().project.name}): ${JSON.stringify(renderer)}`);
    // EXPAND grows the logical width, while retaining uniform 720p scaling.
    const viewport = page.viewportSize()!;
    expect(renderer.width).toBe(
      Math.floor(Math.max(1280, (720 * viewport.width) / viewport.height)),
    );
    expect(renderer.height).toBe(
      Math.floor(Math.max(720, (1280 * viewport.height) / viewport.width)),
    );
    expect(renderer.antialiasGL).toBe(false);
  } finally {
    release();
  }
});
