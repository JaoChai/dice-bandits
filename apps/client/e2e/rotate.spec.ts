import { expect, test } from '@playwright/test';
import { startTestGame } from './helpers';

test('shows the rotate hint only in portrait on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-landscape', 'mobile-only orientation journey');
  await startTestGame(page);
  const rotateHint = page.locator('[data-testid="rotate-hint"]');

  await page.setViewportSize({ width: 412, height: 915 });
  await expect(rotateHint).toBeVisible();
  await page.setViewportSize({ width: 915, height: 412 });
  await expect(rotateHint).toBeHidden();
});
