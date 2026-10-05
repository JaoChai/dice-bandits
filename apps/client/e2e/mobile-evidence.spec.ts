import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  assertInside,
  observeBoardGame,
  playOneStep,
  startTestGame,
  waitForBattleArt,
} from './helpers';
import type Phaser from 'phaser';

const viewports = [
  { width: 915, height: 412 },
  { width: 932, height: 388 },
  { width: 1280, height: 720 },
];

async function audit(page: Page, name: string, info: TestInfo) {
  // Local injection, identical to prior review cards. No network/dependency
  // added to normal CI; supply AXE_SOURCE when collecting accessibility evidence.
  if (!process.env.AXE_SOURCE) return;
  await page.addScriptTag({ path: process.env.AXE_SOURCE });
  const result = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: { run: (options: unknown) => Promise<{ violations: Array<{ impact: string }> }> };
      }
    ).axe;
    return axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
  });
  await info.attach(`${name}-axe`, {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  const severe = result.violations.filter((issue) =>
    ['serious', 'critical'].includes(issue.impact),
  );
  console.log(`axe ${name}: ${severe.length} serious/critical`);
  expect(severe).toEqual([]);
}

for (const lang of ['th', 'en'] as const) {
  test(`responsive screen and accessibility evidence ${lang}`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
    await observeBoardGame(page);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const prefix = `${viewport.width}x${viewport.height}-${lang}`;
      await page.goto('/?seed=m5ab-1&speed=0');
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: info.outputPath(`${prefix}-title.png`) });
      await page.locator('[data-action="new"]').click();
      await page.screenshot({ path: info.outputPath(`${prefix}-setup.png`) });
      if (viewport.width < 1000) await audit(page, `${prefix}-setup`, info);
      for (let seat = 1; seat < 4; seat++) {
        await page
          .locator(`[data-seat="${seat}"] select[data-field="control"]`)
          .selectOption('bot');
      }
      await page.locator('#setup-form button[type="submit"]').click();
      await page.waitForFunction(() => window.__db?.art.boardReady);
      await page.screenshot({ path: info.outputPath(`${prefix}-board.png`) });
      if (viewport.width < 1000) await audit(page, `${prefix}-board`, info);
      await page.locator('[data-testid="map-toggle"]').click();
      await page.screenshot({ path: info.outputPath(`${prefix}-whole-map.png`) });
      // Exercise a real resize while zoomed out, not just a fresh game at a size.
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const camera = (window as Window & { __m5aGame: Phaser.Game }).__m5aGame.scene.getScene(
              'BoardScene',
            ).cameras.main;
            return camera.width / camera.zoom;
          }),
        )
        .toBeGreaterThanOrEqual(3199.5);
      await page.locator('[data-testid="map-toggle"]').click();
      await playOneStep(page);
      await waitForBattleArt(page);
      await page.screenshot({ path: info.outputPath(`${prefix}-battle.png`) });
      await assertInside(page, '.battle-hp-card, .action-tray, .command-card', '.game-shell');
      if (viewport.width < 1000) await audit(page, `${prefix}-battle`, info);
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const scene = (window as Window & { __m5aGame: Phaser.Game }).__m5aGame.scene.getScene(
              'BattleScene',
            );
            const image = scene.children
              .getChildren()
              .find(
                (child) =>
                  'texture' in child &&
                  (child as Phaser.GameObjects.Image).texture.key.startsWith('art:backdrop'),
              ) as Phaser.GameObjects.Image;
            const box = image.getBounds();
            return {
              left: box.left <= 0,
              right: box.right >= scene.cameras.main.width,
              top: box.top <= 0,
              bottom: box.bottom >= scene.cameras.main.height,
            };
          }),
        )
        .toEqual({ left: true, right: true, top: true, bottom: true });
    }
    // Real completed game, then capture the same result at each screen size.
    await startTestGame(page);
    let iterations = 0;
    while (!(await page.locator('[data-testid="results"]').isVisible()) && iterations < 3000) {
      await playOneStep(page);
      iterations++;
    }
    await expect(page.locator('[data-testid="results"]')).toBeVisible();
    expect(await page.evaluate(() => window.__db.getState().phase.kind)).toBe('gameOver');
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.screenshot({
        path: info.outputPath(`${viewport.width}x${viewport.height}-${lang}-results.png`),
      });
    }
    console.log(`Results evidence ${lang}: ${iterations} real UI actions`);
  });
}
