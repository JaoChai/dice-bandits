import { expect, test } from '@playwright/test';

/**
 * Lead-review guard: every authored cartoon asset must load in the built
 * preview. Any `[art] fallback` warning means a missing atlas, map tile, or
 * frame drew its flat placeholder instead — fail loudly so the asset gap is
 * caught before release, while the drawing code keeps its warn-don't-crash
 * contract for degraded environments.
 */
test('authored cartoon assets load without any art fallback warning', async ({ page }) => {
  const fallbacks: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().includes('[art] fallback')) {
      fallbacks.push(message.text());
    }
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/?seed=m5ab-1&speed=0');
  await page.locator('[data-action="new"]').click();
  for (let seat = 1; seat < 4; seat += 1) {
    await page.locator(`[data-seat="${seat}"] select[data-field="control"]`).selectOption('bot');
  }
  await page.locator('[data-seat="0"] select[data-field="classId"]').selectOption('knight');
  await page.locator('#setup-form button[type="submit"]').click();
  await expect(page.locator('#phaser-board canvas')).toBeVisible();
  await page.waitForLoadState('networkidle');

  expect(fallbacks, 'authored /art assets are missing in the built preview').toEqual([]);
  expect(pageErrors, 'no uncaught page errors').toEqual([]);
});
