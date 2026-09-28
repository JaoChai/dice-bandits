import { expect, test } from '@playwright/test';
import { playSteps, startTestGame } from './helpers';

test('continues the saved game after reload', async ({ page }) => {
  await startTestGame(page);
  await playSteps(page, 5);
  const beforeReload = await page.evaluate(() => {
    const state = window.__db!.getState();
    return { round: state.round, turnSeat: state.turnSeat };
  });

  await page.reload();
  await expect(page.locator('[data-action="continue"]')).toBeVisible();
  await page.locator('[data-action="continue"]').click();
  await expect(page.locator('[data-testid="screen-board"]')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = window.__db!.getState();
        return { round: state.round, turnSeat: state.turnSeat };
      }),
    )
    .toEqual(beforeReload);
});
