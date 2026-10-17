import { expect, test, type Page } from '@playwright/test';
import { openTitleChoice, startTestGame } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

const NUDGE_TH = 'ยังไม่ใช่ปุ่มนี้ ลองปุ่มกรอบน้ำเงินนะ';
const MUTED_ARIA =
  '[data-testid^="action-"][aria-disabled="true"], [data-testid^="pick-"][aria-disabled="true"], [data-testid^="perk-"][aria-disabled="true"], [data-testid^="shop-"][aria-disabled="true"]';

async function openPractice(page: Page): Promise<void> {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'th');
    localStorage.setItem('dice-bandits:intro-seen', '1');
    localStorage.setItem('dice-bandits:tips', '{"enabled":false,"seen":["roll"]}');
  });
  await page.goto('/?speed=0');
  await openTitleChoice(page, 'title-practice');
  await expect(page.getByTestId('practice-begin')).toBeVisible();
  await page.getByTestId('practice-begin').click();
  await page.waitForFunction(() => window.__db?.art.boardReady);
}

async function clickAllowed(page: Page): Promise<void> {
  await page.locator('.practice-highlight').waitFor({ state: 'visible', timeout: 20_000 });
  await expect(page.locator('.practice-highlight')).toBeEnabled({ timeout: 20_000 });
  await page.locator('.practice-highlight').click();
}

test('muted fork control nudges in Thai, the correct tap advances, exit clears', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Single-viewport journey');
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await openPractice(page);
  await clickAllowed(page); // lesson 1 roll; the bot presents on its own
  await clickAllowed(page); // second roll reaches the fork
  await expect(page.getByTestId('action-chooseBranch-34')).toBeVisible();

  const mutedButton = page.getByTestId('action-chooseBranch-11');
  await expect(mutedButton).toHaveAttribute('aria-disabled', 'true');
  await expect(mutedButton).toHaveClass(/practice-muted/);
  await expect(mutedButton).not.toHaveClass(/practice-highlight/);
  expect(
    await mutedButton.evaluate((el) => Number(getComputedStyle(el).opacity)),
  ).toBeLessThanOrEqual(0.5);
  await expect(page.locator('.practice-track')).toHaveAttribute('aria-valuenow', '2');

  // A real pointer tap still lands on an aria-disabled control (only
  // assistive tech and Playwright actionability refuse it), which is exactly
  // the wrong tap this card wants the nudge for.
  await mutedButton.click({ force: true });
  const nudge = page.getByTestId('practice-nudge');
  await expect(nudge).toBeVisible();
  await expect(nudge).toHaveText(NUDGE_TH);
  await expect(nudge).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('.practice-highlight')).toHaveAttribute(
    'data-testid',
    'action-chooseBranch-34',
  );
  await expect(page.locator('.practice-track')).toHaveAttribute('aria-valuenow', '2');
  await expect(nudge).toBeHidden({ timeout: 4_000 });

  await page.getByTestId('action-chooseBranch-34').click();
  await expect(page.locator('.practice-track')).toHaveAttribute('aria-valuenow', '4');
  await expect(page.locator('.practice-muted')).toHaveCount(0);
  await expect(page.locator(MUTED_ARIA)).toHaveCount(0);

  const text = await page.locator('body').innerText();
  expect(text).toContain('โอปอล์');
  expect(text).toContain('มินต์');
  expect(text).not.toMatch(/Learner|Bandit/);

  await page.getByTestId('practice-exit').click();
  await page.getByTestId('practice-leave').click();
  await expect(page.getByTestId('title-practice')).toBeFocused();
  await expect(page.locator('.practice-muted')).toHaveCount(0);
  await expect(page.locator(MUTED_ARIA)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a normal solo game never shows practice muting', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Single-viewport journey');
  await page.setViewportSize({ width: 915, height: 412 });
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'th');
    localStorage.setItem('dice-bandits:intro-seen', '1');
    localStorage.setItem('dice-bandits:tips', '{"enabled":false,"seen":["roll"]}');
  });
  await page.goto('/?seed=e2e-1&speed=0');
  await startTestGame(page);
  await expect(page.locator('.practice-muted')).toHaveCount(0);
  await expect(page.locator(MUTED_ARIA)).toHaveCount(0);
  await expect(page.locator('.practice-topbar')).toHaveCount(0);
});
