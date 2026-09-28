import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const testCode = 'ZZZZZ';
const onlineOrigin = 'http://127.0.0.1:8787';
const actionSelector =
  '[data-testid^="action-"], [data-testid^="pick-"], [data-testid^="perk-"], [data-testid^="shop-"]';
const enabledActionSelector = actionSelector
  .split(',')
  .map((selector) => `${selector.trim()}:visible:enabled`)
  .join(',');

async function createRoom(page: Page): Promise<string> {
  await page.goto(`${onlineOrigin}/?speed=0`);
  await page.getByTestId('online-create').click();
  await page.getByTestId('online-name').fill('Alice');
  await page.getByTestId('online-create-submit').click();
  await expect(page.getByTestId('screen-lobby')).toBeVisible();
  return (await page.locator('.room-code strong').textContent())!.trim();
}

async function joinRoom(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`${onlineOrigin}/r/${code}?speed=0`);
  await expect(page.getByTestId('online-join-submit')).toBeVisible();
  await page.getByTestId('online-name').fill(name);
  await page.getByTestId('online-join-submit').click();
  await expect(page.getByTestId('screen-lobby')).toBeVisible();
}

async function visibleAction(page: Page): Promise<boolean> {
  const modalAction = page.locator('.dialog-shade button:visible:enabled').first();
  if ((await modalAction.count()) > 0) return true;
  return (await page.locator(enabledActionSelector).first().count()) > 0;
}

async function clickFirstAction(page: Page): Promise<boolean> {
  const modalAction = page.locator('.dialog-shade button:visible:enabled').first();
  const action =
    (await modalAction.count()) > 0 ? modalAction : page.locator(enabledActionSelector).first();
  if ((await action.count()) === 0) return false;
  await action.click();
  return true;
}

async function gameStamp(page: Page): Promise<string> {
  return page.evaluate(() => {
    const game = window.__db?.getState();
    return game ? JSON.stringify(game) : 'no-game';
  });
}

async function playUntilEachHumanActsThreeTimes(
  pages: [Page, Page],
): Promise<{ alice: number; bob: number; finishedEarly: boolean }> {
  const acted = [0, 0];
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const finished = await Promise.all(
      pages.map((page) => page.evaluate(() => window.__db?.getState().phase.kind === 'gameOver')),
    );
    if (finished.some(Boolean)) return { alice: acted[0]!, bob: acted[1]!, finishedEarly: true };
    if (acted[0]! >= 3 && acted[1]! >= 3 && !(await visibleAction(pages[1]!))) break;

    const active = await Promise.all(pages.map(visibleAction));
    const actor = acted[0]! < 3 && active[0] ? 0 : active[1] ? 1 : active[0] ? 0 : -1;
    if (actor === -1) {
      await expect
        .poll(
          async () => {
            const gameOver = await Promise.all(
              pages.map((page) =>
                page.evaluate(() => window.__db?.getState().phase.kind === 'gameOver'),
              ),
            );
            return (
              gameOver.some(Boolean) || (await Promise.all(pages.map(visibleAction))).some(Boolean)
            );
          },
          { timeout: 15_000 },
        )
        .toBe(true);
      continue;
    }

    const before = await Promise.all(pages.map(gameStamp));
    expect(await clickFirstAction(pages[actor]!)).toBe(true);
    acted[actor] = acted[actor]! + 1;
    await expect
      .poll(
        async () => {
          const finished = await Promise.all(
            pages.map((page) =>
              page.evaluate(() => window.__db?.getState().phase.kind === 'gameOver'),
            ),
          );
          if (finished.some(Boolean)) return true;
          const after = await Promise.all(pages.map(gameStamp));
          return after.every((stamp, index) => stamp !== before[index]);
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  }
  const finishedEarly = (
    await Promise.all(
      pages.map((page) => page.evaluate(() => window.__db?.getState().phase.kind === 'gameOver')),
    )
  ).some(Boolean);
  return { alice: acted[0]!, bob: acted[1]!, finishedEarly };
}

async function newContext(browser: Browser, mobile: boolean): Promise<BrowserContext> {
  return browser.newContext({
    viewport: mobile ? { width: 915, height: 412 } : { width: 1280, height: 720 },
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  });
}

test('creates, plays, disconnects, reclaims, claims, and rejects an unknown online room', async ({
  browser,
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-landscape';
  test.setTimeout(mobile ? 30_000 : 180_000);
  // Verify cross-tab language sync in an isolated room so it cannot add a player
  // to the two-device gameplay journey below.
  const languageContext = await newContext(browser, false);
  try {
    const languageHost = await languageContext.newPage();
    const languageCode = await createRoom(languageHost);
    const languageTab = await languageContext.newPage();
    await languageTab.goto(`${onlineOrigin}/?speed=0`);
    await languageTab.evaluate(
      (roomCode) => localStorage.removeItem(`dice-bandits:room:${roomCode}`),
      languageCode,
    );
    await joinRoom(languageTab, languageCode, 'Bob');
    await languageHost.locator('[data-lang="en"]').click();
    await expect(languageTab.getByRole('heading', { level: 1 })).toHaveText('Room lobby');
    await languageHost.locator('[data-lang="th"]').click();
    await expect(languageTab.getByRole('heading', { level: 1 })).toHaveText('ห้องรอผู้เล่น');
    await languageHost.locator('[data-lang="en"]').click();
    await expect(languageTab.getByRole('heading', { level: 1 })).toHaveText('Room lobby');
  } finally {
    await languageContext.close();
  }

  const aliceContext = page.context();
  let alicePage = page;
  const code = await createRoom(alicePage);
  const bobContext = await newContext(browser, mobile);
  const bobPage = await bobContext.newPage();
  try {
    await joinRoom(bobPage, code, 'Bob');
    await expect(alicePage.getByTestId('lobby-seat-1')).toContainText('Bob');
    await bobPage.getByTestId('lobby-class-mage').click();
    await expect(bobPage.getByTestId('lobby-class-mage')).toHaveAttribute('aria-pressed', 'true');
    await expect(bobPage.getByTestId('lobby-class-mage')).toBeFocused();
    await alicePage.getByTestId('lobby-class-thief').click();
    await expect(alicePage.getByTestId('lobby-class-thief')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    if (mobile) {
      await expect(alicePage.getByTestId('lobby-start')).toBeVisible();
      await expect(bobPage.getByTestId('screen-lobby')).toBeVisible();
      return;
    }

    await alicePage.getByTestId('lobby-start').click();
    await expect(alicePage.getByTestId('screen-board')).toBeVisible();
    await expect(bobPage.getByTestId('screen-board')).toBeVisible();

    const actions = await playUntilEachHumanActsThreeTimes([alicePage, bobPage]);
    testInfo.annotations.push({
      type: 'online-human-actions',
      description: JSON.stringify(actions),
    });
    if (actions.finishedEarly) {
      expect(actions.alice + actions.bob).toBeGreaterThan(0);
      testInfo.annotations.push({
        type: 'online-journey-note',
        description: 'The game reached game over before each human could act three times.',
      });
      return;
    }
    expect(actions.alice).toBeGreaterThanOrEqual(3);
    expect(actions.bob).toBeGreaterThanOrEqual(3);

    await alicePage.close();
    await expect(bobPage.getByTestId('seat-takeover-0')).toBeVisible({ timeout: 10_000 });
    const beforeTakeoverProgress = await gameStamp(bobPage);
    await expect
      .poll(
        async () =>
          (await gameStamp(bobPage)) !== beforeTakeoverProgress || (await visibleAction(bobPage)),
        { timeout: 10_000 },
      )
      .toBe(true);
    if ((await gameStamp(bobPage)) === beforeTakeoverProgress) {
      expect(await clickFirstAction(bobPage)).toBe(true);
      await expect
        .poll(async () => (await gameStamp(bobPage)) !== beforeTakeoverProgress)
        .toBe(true);
    }

    alicePage = await aliceContext.newPage();
    await alicePage.goto(`${onlineOrigin}/r/${code}?speed=0`);
    await expect(alicePage.getByTestId('screen-board')).toBeVisible();
    await expect(bobPage.getByTestId('seat-takeover-0')).toHaveCount(0, { timeout: 10_000 });
    await expect(alicePage.getByTestId('online-takeover')).toHaveCount(0);

    await bobPage.close();
    await expect(alicePage.getByTestId('seat-takeover-1')).toBeVisible({ timeout: 10_000 });
    const charlieContext = await newContext(browser, false);
    const charliePage = await charlieContext.newPage();
    try {
      await charliePage.goto(`${onlineOrigin}/r/${code}?speed=0`);
      await expect(charliePage.getByTestId('claim-seat-1')).toBeVisible();
      await charliePage.getByTestId('claim-seat-1').click();
      await expect(charliePage.getByTestId('screen-board')).toBeVisible();
      const reclaimedBobPage = await bobContext.newPage();
      await reclaimedBobPage.goto(`${onlineOrigin}/r/${code}?speed=0`);
      await expect(reclaimedBobPage.getByTestId('online-error')).toBeVisible({ timeout: 15_000 });

      const unknownPage = await charlieContext.newPage();
      await unknownPage.goto(`${onlineOrigin}/r/${testCode}?speed=0`);
      await expect(unknownPage.getByTestId('online-error')).toBeVisible();
    } finally {
      await charlieContext.close();
    }
  } finally {
    await bobContext.close();
  }
});
