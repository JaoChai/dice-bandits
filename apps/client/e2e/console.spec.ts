import { expect, test } from '@playwright/test';

test('hot-seat game startup has no console errors or uncaught page errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('GL Driver')) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/?seed=console-e2e&speed=0');
  await page.locator('[data-action="new"]').click();
  for (let seat = 1; seat < 4; seat += 1) {
    await page.locator(`[data-seat="${seat}"] select[data-field="control"]`).selectOption('human');
  }
  await page.locator('[data-seat="0"] select[data-field="classId"]').selectOption('knight');
  await page.locator('#setup-form button[type="submit"]').click();
  await expect(page.locator('[data-testid="screen-board"]')).toBeVisible();
  await expect(page.locator('#phaser-board canvas')).toBeVisible();
  await page.waitForLoadState('networkidle');

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
