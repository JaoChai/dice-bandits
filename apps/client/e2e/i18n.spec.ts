import { expect, test } from '@playwright/test';
import { startTestGame } from './helpers';

test('switches language on the title and in-game', async ({ page }) => {
  await page.goto('/?seed=e2e-i18n&speed=0');
  await expect(page.locator('[data-action="new"]')).toHaveText('New game');
  await page.locator('[data-lang="th"]').click();
  await expect(page.locator('[data-action="new"]')).toHaveText('เริ่มเกมใหม่');
  await page.locator('[data-lang="en"]').click();
  await expect(page.locator('[data-action="new"]')).toHaveText('New game');

  await startTestGame(page);
  await expect(page.locator('[data-testid="action-roll"]')).toHaveText('Roll');
  await page.locator('[data-lang="th"]').click();
  await expect(page.locator('[data-testid="action-roll"]')).toHaveText('ทอยเต๋า');
  await page.locator('[data-lang="en"]').click();
  await expect(page.locator('[data-testid="action-roll"]')).toHaveText('Roll');
});
