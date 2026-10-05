import type Phaser from 'phaser';
import { expect, test } from '@playwright/test';
import { observeBoardGame, renderedBoardGeometry, startJourney } from './helpers';

type ProbeWindow = Window & { __m5aGame?: Phaser.Game };

for (const lang of ['th', 'en'] as const) {
  test(`board camera keeps the painted map across canvas edges (${lang})`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
    await observeBoardGame(page);
    await startJourney(page);
    await page.waitForFunction(() => window.__db?.art.boardReady);

    for (const mode of ['start', 'whole-map', 'return'] as const) {
      if (mode !== 'start') await page.locator('[data-testid="map-toggle"]').click();
      // Wait for an actual rendered frame, not stale camera worldView values.
      const geometry = await renderedBoardGeometry(page);
      const measurement = await page.evaluate(() => {
        const scene = (window as ProbeWindow).__m5aGame!.scene.getScene('BoardScene');
        const camera = scene.cameras.main;
        const images = scene.children.getChildren().filter((child) => {
          return (
            'texture' in child &&
            /^map-r\d+c\d+$/.test((child as Phaser.GameObjects.Image).texture.key)
          );
        }) as Phaser.GameObjects.Image[];
        const boxes = images.map((image) => image.getBounds());
        return {
          zoom: camera.zoom,
          scrollX: camera.scrollX,
          scrollY: camera.scrollY,
          view: {
            left: camera.worldView.left,
            right: camera.worldView.right,
            top: camera.worldView.top,
            bottom: camera.worldView.bottom,
          },
          map: {
            left: Math.min(...boxes.map((box) => box.left)),
            right: Math.max(...boxes.map((box) => box.right)),
            top: Math.min(...boxes.map((box) => box.top)),
            bottom: Math.max(...boxes.map((box) => box.bottom)),
            tiles: images.length,
          },
        };
      });
      console.log(
        `Board edge ${testInfo.project.name} ${lang} ${mode}: ${JSON.stringify(measurement)}`,
      );
      await testInfo.attach(`${mode}-geometry`, {
        body: JSON.stringify({ measurement, geometry }, null, 2),
        contentType: 'application/json',
      });
      await page.screenshot({ path: testInfo.outputPath(`board-edge-${lang}-${mode}.png`) });
      expect(measurement.map.tiles, 'painted map actually loaded').toBe(15);
      expect(
        measurement.view.left,
        'camera exposes background left of painted map',
      ).toBeGreaterThanOrEqual(measurement.map.left - 0.5);
      expect(
        measurement.view.right,
        'camera exposes background right of painted map',
      ).toBeLessThanOrEqual(measurement.map.right + 0.5);
      expect(
        measurement.view.top,
        'camera exposes background above painted map',
      ).toBeGreaterThanOrEqual(measurement.map.top - 0.5);
      expect(
        measurement.view.bottom,
        'camera exposes background below painted map',
      ).toBeLessThanOrEqual(measurement.map.bottom + 0.5);
    }
  });
}
