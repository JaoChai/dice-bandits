import { expect, test } from '@playwright/test';
import { observeBoardGame, playUntil, renderedBoardGeometry, startJourney } from './helpers';

for (const lang of ['th', 'en'] as const) {
  test(`shared start-space heroes overlap by at most 35% (${lang})`, async ({ page }, testInfo) => {
    await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
    await observeBoardGame(page);
    await startJourney(page);
    await page.waitForFunction(() => window.__db?.art.boardReady);
    const state = await page.evaluate(() => window.__db!.getState());
    expect(state.players.map((player) => player.pos)).toEqual([0, 0, 0, 0]);
    const geometry = await renderedBoardGeometry(page);
    expect(geometry.tokens).toHaveLength(4);
    const pairs = geometry.tokens.flatMap((a, first) =>
      geometry.tokens.slice(first + 1).map((b, index) => ({
        pair: `${first}/${first + index + 1}`,
        percent:
          (100 *
            Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))) /
          Math.min(a.width * a.height, b.width * b.height),
      })),
    );
    console.log(`Token overlap ${testInfo.project.name} ${lang}: ${JSON.stringify(pairs)}`);
    await page.screenshot({ path: testInfo.outputPath(`board-${lang}.png`) });
    for (const token of geometry.tokens) {
      expect(token.visible).toBe(true);
      expect(token.left).toBeGreaterThanOrEqual(geometry.canvas.left);
      expect(token.right).toBeLessThanOrEqual(geometry.canvas.right);
      expect(token.top).toBeGreaterThanOrEqual(geometry.canvas.top);
      expect(token.bottom).toBeLessThanOrEqual(geometry.canvas.bottom);
      // Feet remain local to the shared castle tile, not spread down the road.
      const castle = geometry.tiles.find((tile) => tile.frame === 'castle')!;
      expect(
        Math.hypot(token.world.x - castle.world.x, token.world.y - castle.world.y),
      ).toBeLessThanOrEqual(48);
    }
    for (const pair of pairs) expect(pair.percent, `pair ${pair.pair}`).toBeLessThanOrEqual(35);
  });

  test(`empty event banner is hidden, real event text makes it visible (${lang})`, async ({
    page,
  }) => {
    await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
    await startJourney(page);
    const banner = page.locator('[data-testid="event-banner"]');
    await expect(banner).toHaveCount(1);
    await expect(banner.locator('.event-text')).toHaveText('');
    await expect(banner).toBeHidden();
    await page.waitForFunction(() => window.__db?.art.boardReady);
    await page.screenshot({ path: test.info().outputPath(`empty-event-${lang}.png`) });
    // Real gameplay emits BattleEnded; no test-assigned text or state mutation.
    await page.locator('[data-testid="action-roll"]').click();
    await expect.poll(() => page.evaluate(() => window.__db!.getState().phase.kind)).toBe('battle');
    await playUntil(page, (state) => state.phase.kind !== 'battle');
    await expect(banner.locator('.event-text')).not.toHaveText('');
    await expect(banner).toBeVisible();
  });
}
