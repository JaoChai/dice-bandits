import { expect, test } from '@playwright/test';
import { playUntil } from './helpers';

test('reward dialog frame stays inside the viewport with all choices scrollable', async ({
  page,
}) => {
  await page.goto('/?seed=review-m4a&speed=0');
  await page.locator('[data-action="new"]').click();
  for (let seat = 1; seat < 4; seat++)
    await page.locator(`[data-seat="${seat}"] select[data-field="control"]`).selectOption('bot');
  await page.locator('#setup-form button[type="submit"]').click();
  await playUntil(page, (state) => state.phase.kind === 'pvpReward');
  const dialog = page.locator('.dialog-shade .game-dialog');
  for (const lang of ['en', 'th']) {
    await page
      .locator(`.game-topline [data-lang="${lang}"]`)
      .evaluate((button: HTMLElement) => button.click());
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box, `reward dialog visible in ${lang}`).not.toBeNull();
    expect(box!.y, 'top edge').toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, 'bottom edge').toBeLessThanOrEqual(viewport.height);
    const buttons = dialog.locator('button');
    await buttons.last().evaluate((button) => button.scrollIntoView());
    await expect(buttons.last()).toBeInViewport();
  }
});
for (const [region, seed] of [
  ['meadow', 'review-m4a'],
  ['desert', 'desert-4'],
  ['volcano', 'volcano-3'],
] as const) {
  test(`${region} battle renders its own backdrop without a page error`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/?seed=${seed}&speed=0`);
    await page.locator('[data-action="new"]').click();
    for (let seat = 1; seat < 4; seat++)
      await page.locator(`[data-seat="${seat}"] select[data-field="control"]`).selectOption('bot');
    await page.locator('#setup-form button[type="submit"]').click();
    await playUntil(page, (state) => {
      if (state.phase.kind !== 'battle') return false;
      const spaceId = state.phase.battle.spaceId;
      return state.board.spaces.find((space) => space.id === spaceId)?.region === region;
    });
    await expect
      .poll(() => page.evaluate(() => window.__db!.art.backdropKey))
      .toBe(`backdrop-${region}`);
    expect(errors).toEqual([]);
  });
}

test('snow battle survives atlas loading and renders without a page error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let releaseAtlas!: () => void;
  const atlasGate = new Promise<void>((resolve) => {
    releaseAtlas = resolve;
  });
  await page.route('**/sprites/hero-knight.json', async (route) => {
    await atlasGate;
    await route.continue();
  });
  await page.goto('/?seed=snow-7&speed=0', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-action="new"]').click();
  for (let seat = 1; seat < 4; seat++)
    await page.locator(`[data-seat="${seat}"] select[data-field="control"]`).selectOption('bot');
  await page.locator('#setup-form button[type="submit"]').click();
  await playUntil(
    page,
    (state) =>
      state.phase.kind === 'battle' &&
      state.board.spaces.find((space) => space.id === state.phase.battle.spaceId)?.region ===
        'snow',
  );
  await expect(page.locator('.battle-panel')).toBeVisible();
  releaseAtlas();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await page.evaluate(() => window.__db!.art.backdropKey)).toBe('backdrop-snow');
  expect(errors, 'Phaser must not render a destroyed legacy frame').toEqual([]);
});
