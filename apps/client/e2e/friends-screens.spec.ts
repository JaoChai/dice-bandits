import { mkdir } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { openTitleChoice, assertInside } from './helpers';

const origin = 'http://127.0.0.1:8787';
const evidence = process.env.FRIENDS_EVIDENCE_DIR;

async function scan(page: Page, name: string, info: TestInfo): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await assertInside(
    page,
    '.friends-card, .friends-card button, .friends-card input, .friends-seat, .friends-top',
  );
  const small = await page.locator('.friends-page').evaluate((root) =>
    [...root.querySelectorAll('*')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          ((element.childElementCount === 0 && element.textContent?.trim()) ||
            element.tagName === 'INPUT') &&
          Number.parseFloat(getComputedStyle(element).fontSize) < 14
        );
      })
      .map((element) => element.outerHTML),
  );
  expect(small, 'all visible text is at least 14px').toEqual([]);
  const occluded = await page.locator('.friends-page').evaluate((root) =>
    [...root.querySelectorAll('button, input')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return !hit || !element.contains(hit);
      })
      .map((element) => element.getAttribute('data-testid') ?? element.outerHTML),
  );
  expect(occluded, 'all controls are directly clickable without overlap').toEqual([]);
  if (evidence) await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: evidence ? `${evidence}/${name}.png` : info.outputPath(`${name}.png`),
  });
  // Same opt-in AXE_SOURCE contract as dicey.spec.ts; the local gate supplies it.
  if (!process.env.AXE_SOURCE) return;
  await page.addScriptTag({ path: process.env.AXE_SOURCE! });
  const result = await page.evaluate(async () =>
    (
      window as unknown as {
        axe: { run: (options: unknown) => Promise<{ violations: { impact: string }[] }> };
      }
    ).axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }),
  );
  await info.attach(`${name}-axe`, {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  const serious = result.violations.filter((issue) =>
    ['serious', 'critical'].includes(issue.impact),
  );
  console.log(`axe ${name}: ${serious.length} serious/critical`);
  expect(serious).toEqual([]);
}

for (const [width, height] of [
  [915, 412],
  [932, 388],
  [390, 844],
  [1280, 720],
]) {
  for (const lang of ['th', 'en'] as const) {
    test(`friends create join lobby ${width}x${height} ${lang}`, async ({
      page,
      browser,
    }, info) => {
      test.skip(info.project.name !== 'desktop', 'explicit viewport matrix runs once');
      await page.setViewportSize({ width: width!, height: height! });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
      await page.goto(origin);
      await openTitleChoice(page, 'online-create');
      const prefix = `${lang}-${width}x${height}`;
      await page.getByTestId('online-name').fill(lang === 'th' ? 'มาร์ซี่' : 'Marci');
      await scan(page, `${prefix}-create`, info);
      await page.route('**/api/rooms', async (route) => {
        const response = await route.fetch();
        // Hold only the real response to exercise the existing pending form; no fake data.
        await scan(page, `${prefix}-pending`, info);
        await route.fulfill({ response });
      });
      await page.getByTestId('online-create-submit').click();
      await expect(page.getByTestId('screen-lobby')).toBeVisible();
      const code = (await page.locator('.room-code strong').textContent())!.trim();
      await expect(page.locator('.friends-seat')).toHaveCount(4);
      await expect(page.locator('.friends-seat.empty')).toHaveCount(3);
      // Existing rule: the host can start alone; presentation must not add a minimum.
      await expect(page.getByTestId('lobby-start')).toBeEnabled();
      const guest = await browser.newContext({
        viewport: { width: width!, height: height! },
        storageState: 'e2e/storage-state.json',
        reducedMotion: 'reduce',
      });
      try {
        const joiner = await guest.newPage();
        await joiner.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
        await joiner.goto(origin);
        await openTitleChoice(joiner, 'online-join');
        await joiner.getByTestId('online-name').fill('Bo');
        await joiner.getByTestId('online-code').fill(code.toLowerCase());
        await expect(joiner.getByTestId('online-code')).toHaveValue(code);
        await scan(joiner, `${prefix}-join`, info);
        // Language choice is a real keyboard-accessible icon/popover; Escape restores focus.
        await joiner.getByTestId('online-language').click();
        await joiner.locator(`[data-lang="${lang}"]`).click();
        await expect(joiner.locator(`[data-lang="${lang}"]`)).toBeFocused();
        await joiner.keyboard.press('Escape');
        await expect(joiner.getByTestId('online-language')).toBeFocused();
        await expect(joiner.getByTestId('online-name')).toHaveValue('Bo');
        await expect(joiner.getByTestId('online-code')).toHaveValue(code);
        await joiner.getByTestId('online-code').fill('ABC');
        await joiner.getByTestId('online-join-submit').click();
        await expect(joiner.getByTestId('online-error')).not.toBeEmpty();
        await scan(joiner, `${prefix}-error`, info);
        await joiner.getByTestId('online-back-title').click();
        await openTitleChoice(joiner, 'online-join');
        await joiner.getByTestId('online-name').fill('Bo');
        await joiner.getByTestId('online-code').fill(code);
        await joiner.getByTestId('online-join-submit').click();
        await expect(joiner.getByTestId('screen-lobby')).toBeVisible();
        await expect(page.getByTestId('lobby-seat-1')).toContainText('Bo');
        await expect(joiner.getByTestId('lobby-start')).toHaveCount(0);
        await expect(page.locator('.friends-seat.empty')).toHaveCount(2);
        await joiner.getByTestId('lobby-class-thief').click();
        await expect(joiner.getByTestId('lobby-class-thief')).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(joiner.getByTestId('lobby-class-thief')).toBeFocused();
        await expect(page.getByTestId('lobby-seat-1').locator('.portrait-thief')).toBeVisible();
        await scan(page, `${prefix}-lobby`, info);
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
        await page.getByTestId('online-copy-link').click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
          `${origin}/r/${code}`,
        );
        await page.getByTestId('audio-settings').click();
        await expect(page.getByTestId('audio-dialog')).toBeVisible();
        await page.getByTestId('audio-close').click();
        await expect(page.getByTestId('audio-settings')).toBeFocused();
      } finally {
        await guest.close();
      }
    });
  }
}
