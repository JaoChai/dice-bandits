import { expect, test } from '@playwright/test';
import { playOneStep, startTestGame } from './helpers';

test('plays a full game through the results screen', async ({ page }) => {
  // Keep the original journey budget: smooth 720p textures do not require MSAA.
  test.setTimeout(90_000);
  const startedAt = Date.now();
  await startTestGame(page);
  let iterations = 0;
  while (!(await page.locator('[data-testid="results"]').isVisible()) && iterations < 3_000) {
    await playOneStep(page);
    iterations += 1;
  }

  await expect(page.locator('[data-testid="results"]')).toBeVisible();
  await expect(page.locator('.results-ranking li')).toHaveCount(4);
  expect(await page.evaluate(() => window.__db.getState().phase.kind)).toBe('gameOver');
  test.info().annotations.push({ type: 'full-game-iterations', description: String(iterations) });
  console.log(
    `Full game (${test.info().project.name}): ${iterations} iterations in ${Date.now() - startedAt} ms`,
  );
});
