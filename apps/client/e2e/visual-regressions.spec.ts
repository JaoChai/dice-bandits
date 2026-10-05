import { expect, test } from '@playwright/test';
import { observeBoardGame, playUntil, waitForBattleArt } from './helpers';

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
    // The reward shade covers the board, so drive the menu with DOM clicks
    // exactly like the pre-menu spec drove the old header toggle.
    await page
      .locator('[data-testid="menu-button"]')
      .evaluate((button: HTMLElement) => button.click());
    await page
      .locator(`.menu-panel [data-lang="${lang}"]`)
      .evaluate((button: HTMLElement) => button.click());
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box, `reward dialog visible in ${lang}`).not.toBeNull();
    expect(box!.y, 'top edge').toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, 'bottom edge').toBeLessThanOrEqual(viewport.height);
    const buttons = dialog.locator('button');
    await buttons.last().evaluate((button) => button.scrollIntoView());
    await expect(buttons.last()).toBeInViewport();
    // The panel stays open across a switch; close it before the next iteration.
    await page
      .locator('[data-testid="menu-button"]')
      .evaluate((button: HTMLElement) => button.click());
  }
});
// M5a (review round 1): seeds re-derived for the fixed map via engine replay with the
// setup screen's real defaults (all bots greedy). Meadow `m5a-2` @ 1 click, desert
// `m5a-1` @ 9, volcano `m5a-v8` @ 23 (the old `m5a-9` journey reached round 12
// game-over before any volcano battle under real UI click order).
for (const [region, seed] of [
  ['meadow', 'm5a-2'],
  ['desert', 'm5a-1'],
  ['volcano', 'm5a-v8'],
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
    await waitForBattleArt(page);
    await expect
      .poll(() => page.evaluate(() => window.__db!.art.backdropKey))
      .toBe(`art:backdrop-${region}`);
    expect(errors).toEqual([]);
  });
}

test('snow battle survives atlas loading and renders without a page error', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let releaseAtlas!: () => void;
  const atlasGate = new Promise<void>((resolve) => {
    releaseAtlas = resolve;
  });
  let atlasRequested = false;
  let atlasReleased = false;
  await page.route('**/art/hero-knight.json', async (route) => {
    atlasRequested = true;
    await atlasGate;
    atlasReleased = true;
    await route.continue();
  });
  await page.goto('/?seed=snow-7&speed=0', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-action="new"]').click();
  for (let seat = 1; seat < 4; seat++)
    await page.locator(`[data-seat="${seat}"] select[data-field="control"]`).selectOption('bot');
  await page.locator('#setup-form button[type="submit"]').click();
  try {
    await expect.poll(() => atlasRequested, 'the cartoon atlas gate is hit').toBe(true);
    await playUntil(page, (state) => {
      if (state.phase.kind !== 'battle') return false;
      const spaceId = state.phase.battle.spaceId;
      return state.board.spaces.find((space) => space.id === spaceId)?.region === 'snow';
    });
    await expect(page.locator('.battle-panel')).toBeVisible();
    expect(atlasReleased, 'atlas still held while the snow battle opens').toBe(false);
  } finally {
    releaseAtlas();
  }
  await waitForBattleArt(page);
  expect(await page.evaluate(() => window.__db!.art.backdropKey)).toBe('art:backdrop-snow');
  expect(errors, 'snow battle must survive a delayed cartoon atlas').toEqual([]);
});

/** Legacy interim pixel-pipeline texture keys that must no longer exist. */
const LEGACY_KEY_PATTERN =
  /^(hero|token|portrait|monster|ground|props|ambient|backdrop)-|^tile-(meadow|desert|snow|volcano)$|^(tiles|fx|cards|icons)$|-atlas-image$/;

// M5a Task 11c (replaces the gated legacy-atlas test): the interim
// `/sprites` pipeline is deleted, so a full boot-to-battle journey must
// fetch nothing from `/sprites`, register no legacy texture key, and never
// surface the asset-error panel.
test('ships no pixel-art /sprites requests or legacy texture keys', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const spritesRequests: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/sprites/')) spritesRequests.push(pathname);
  });
  observeBoardGame(page);

  await page.goto('/?seed=m5a-2&speed=0');
  await page.locator('[data-action="new"]').click();
  for (let seat = 1; seat < 4; seat++)
    await page.locator(`[data-seat="${seat}"] select[data-field="control"]`).selectOption('bot');
  await page.locator('#setup-form button[type="submit"]').click();
  await playUntil(page, (state) => state.phase.kind === 'battle');
  await waitForBattleArt(page);

  expect(spritesRequests, 'no /sprites request in a full boot-to-battle journey').toEqual([]);
  const legacyKeys = await page.evaluate((pattern: string) => {
    const game = (window as unknown as { __m5aGame?: { textures: { getTextureKeys(): string[] } } })
      .__m5aGame!;
    return game.textures.getTextureKeys().filter((key) => new RegExp(pattern).test(key));
  }, LEGACY_KEY_PATTERN.source);
  expect(legacyKeys, 'no legacy pixel-pipeline texture key registered').toEqual([]);
  await expect(page.locator('[data-testid="asset-error"]')).toHaveCount(0);
  expect(errors, 'no uncaught page errors').toEqual([]);
});
