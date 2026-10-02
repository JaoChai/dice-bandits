import { expect, test } from '@playwright/test';
import { playUntil } from './helpers';

test('reward dialog frame stays inside the viewport with all choices scrollable', async ({
  page,
}) => {
  // Reaching this deterministic reward takes ~38 full UI actions. CI traces
  // show ~0.55 s per click on a slow runner, so budget for runner variance.
  test.setTimeout(150_000);
  // M5a: seed re-derived for the fixed map (engine replay: human wins a duel
  // and takes a pvpReward with 13 choices at action 38; the M4 seed
  // review-m4a no longer reaches a human pvpReward within budget).
  await page.goto('/?seed=m5a-7&speed=0');
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
// M5a: seeds re-derived for the fixed map via engine replay (first battle in
// the target region with the human seat in it, human takes the first legal
// action, bots greedy): meadow `m5a-2` @ 3, desert `m5a-1` @ 45,
// volcano `m5a-9` @ 72 actions.
for (const [region, seed] of [
  ['meadow', 'm5a-2'],
  ['desert', 'm5a-1'],
  ['volcano', 'm5a-9'],
] as const) {
  test(`${region} battle renders its own backdrop without a page error`, async ({ page }) => {
    // This visual journey traverses many actions before the regional battle.
    test.setTimeout(150_000);
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
