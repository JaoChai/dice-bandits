import { expect, test, type Page } from '@playwright/test';
import { startTestGame } from './helpers';

/** The board keeps TH/EN inside its menu button (spec §9); the title keeps its header toggle. */
async function boardLang(page: Page, lang: 'th' | 'en'): Promise<void> {
  await page.locator('[data-testid="menu-button"]').click();
  await page.locator(`.menu-panel [data-lang="${lang}"]`).click();
  // The panel stays open across a switch; close it like a player would.
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-panel')).toHaveCount(0);
}

test('switches language on the title and in-game', async ({ page }) => {
  await page.goto('/?seed=e2e-i18n&speed=0');
  await expect(page.getByTestId('title-play')).toHaveText('Play');
  await page.getByTestId('title-language').click();
  await page.locator('[data-lang="th"]').click();
  await expect(page.getByTestId('title-play')).toHaveText('เล่น');
  await page.locator('[data-lang="en"]').click();
  await expect(page.getByTestId('title-play')).toHaveText('Play');

  await startTestGame(page);
  await expect(page.locator('[data-testid="action-roll"]')).toHaveText('Roll');
  await boardLang(page, 'th');
  await expect(page.locator('[data-testid="action-roll"]')).toHaveText('ทอยเต๋า');
  await boardLang(page, 'en');
  await expect(page.locator('[data-testid="action-roll"]')).toHaveText('Roll');
});
