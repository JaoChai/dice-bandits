import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createGame } from '@dice-bandits/engine';
import { writeFile } from 'node:fs/promises';
import { assertInside, assertMinFont, assertNoEllipsis } from './helpers';

const evidence = process.env.TITLE_EVIDENCE_DIR;
const savedState = createGame({
  seed: 'title-save',
  rounds: 12,
  seats: [
    { name: 'Human', classId: 'knight', control: 'human', personality: null },
    { name: 'Bot', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
});
async function scan(page: Page, name: string, info: TestInfo) {
  await page.evaluate(() => document.fonts.ready);
  await assertInside(
    page,
    '.title-screen button:visible, .title-sheet-card:visible, .title-centre:visible > *',
  );
  await assertMinFont(page, '.title-screen', 14);
  await assertNoEllipsis(page, '.title-screen');
  const targets = await page.locator('.title-screen button:visible').evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return {
        text: button.textContent,
        width: box.width,
        height: box.height,
        hit: button === hit || button.contains(hit),
      };
    }),
  );
  for (const target of targets) {
    expect(target.width, JSON.stringify(target)).toBeGreaterThanOrEqual(44);
    expect(target.height, JSON.stringify(target)).toBeGreaterThanOrEqual(44);
    expect(target.hit, JSON.stringify(target)).toBe(true);
  }
  const path = evidence ? `${evidence}/${name}.png` : info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
  // Same opt-in external axe source as dicey.spec.ts; no new dependency.
  if (!process.env.AXE_SOURCE) return;
  await page.addScriptTag({ path: process.env.AXE_SOURCE });
  const result = await page.evaluate(async () =>
    (
      window as unknown as {
        axe: {
          run: (
            context: string,
            options: unknown,
          ) => Promise<{ violations: { id: string; impact: string }[] }>;
        };
      }
    ).axe.run('.title-screen', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }),
  );
  if (evidence) await writeFile(`${evidence}/${name}-axe.json`, JSON.stringify(result, null, 2));
  await info.attach(`${name}-axe`, {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  const serious = result.violations.filter((issue) =>
    ['serious', 'critical'].includes(issue.impact),
  );
  const contrast = result.violations.filter((issue) => issue.id === 'color-contrast');
  console.log(`${name}: axe serious/critical=${serious.length}, color-contrast=${contrast.length}`);
  expect(serious).toEqual([]);
  expect(contrast).toEqual([]);
}

test('keyboard language change keeps immediate Escape reachable in the chooser', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('lang', 'en');
    localStorage.setItem('dice-bandits:intro-seen', '1');
  });
  await page.goto('/?speed=0');
  await page.getByTestId('title-play').press('Enter');
  await page.getByTestId('title-language').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-lang="th"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('title-back')).toHaveAccessibleName('กลับหน้าหลัก');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('title-chooser')).toBeHidden();
  await expect(page.getByTestId('title-play')).toBeFocused();
});

for (const lang of ['th', 'en'] as const) {
  test(`keyboard language change preserves landing focus for ${lang}`, async ({ page }) => {
    await page.addInitScript((lang) => {
      localStorage.clear();
      localStorage.setItem('lang', lang === 'th' ? 'en' : 'th');
      localStorage.setItem('dice-bandits:intro-seen', '1');
    }, lang);
    await page.goto('/?speed=0');
    await page.getByTestId('title-language').focus();
    await page.keyboard.press('Enter');
    await page.locator(`[data-lang="${lang}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`[data-lang="${lang}"]`)).toBeFocused();
    await expect(page.locator(`[data-lang="${lang}"]`)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#title-languages')).toBeHidden();
    await expect(page.getByTestId('title-language')).toBeFocused();
    await expect(page.getByTestId('title-play')).toBeVisible();
  });
}

for (const [lang, width, height] of [
  ['th', 915, 412],
  ['th', 932, 388],
  ['en', 1280, 720],
  ['en', 390, 844],
] as const) {
  for (const saved of [false, true]) {
    test(`title chooser ${lang} ${width}x${height} ${saved ? 'saved' : 'new'}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(
        ({ lang, state }) => {
          localStorage.clear();
          localStorage.setItem('lang', lang);
          localStorage.setItem('dice-bandits:intro-seen', '1');
          if (state)
            localStorage.setItem('diceBandits.save', JSON.stringify({ version: 2, state }));
        },
        { lang, state: saved ? savedState : null },
      );
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/?speed=0');
      await expect(page.getByTestId('title-play')).toBeVisible();
      await expect(page.locator('.title-screen .primary:visible')).toHaveCount(1);
      await expect(page.locator('[data-action="new"]')).toBeHidden();
      const prefix = `${lang}-${width}x${height}-${saved ? 'saved' : 'new'}`;
      await scan(page, `${prefix}-title`, info);
      expect(
        await page.getByTestId('title-play').evaluate((el) => getComputedStyle(el).animationName),
      ).toBe('none');
      await page.getByTestId('title-play').click();
      await expect(page.getByTestId('title-back')).toBeFocused();
      await expect(page).toHaveURL(/\/?\?speed=0$/);
      await expect(page.locator('[data-action="continue"]')).toHaveCount(saved ? 1 : 0);
      await expect(page.getByTestId('title-recommended')).toHaveCount(saved ? 0 : 1);
      await scan(page, `${prefix}-chooser`, info);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('title-play')).toBeFocused();
      await page.getByTestId('title-play').click();
      await page.getByTestId('title-back').click();
      await expect(page.getByTestId('title-play')).toBeFocused();
      await page.getByTestId('title-language').click();
      await page.locator(`[data-lang="${lang === 'th' ? 'en' : 'th'}"]`).click();
      await expect(page.getByTestId('title-play')).toHaveText(lang === 'th' ? 'Play' : 'เล่น');
      await page.getByTestId('title-play').click();
      await page.getByTestId('title-friends').click();
      await expect(page.getByTestId('online-create')).toBeVisible();
      await expect(page.getByTestId('online-join')).toBeVisible();
      await scan(page, `${prefix}-friends`, info);
      await page.getByTestId('title-back').click();
      await expect(page.getByTestId('title-play')).toBeFocused();
      await page.getByTestId('title-play').click();
      await page.locator('[data-action="new"]').click();
      await expect(page.getByTestId('screen-setup')).toBeVisible();
    });
  }
  test(`title saved game plus room ${lang} ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(
      ({ lang, state }) => {
        localStorage.clear();
        localStorage.setItem('lang', lang);
        localStorage.setItem('dice-bandits:intro-seen', '1');
        localStorage.setItem('diceBandits.save', JSON.stringify({ version: 2, state }));
        localStorage.setItem(
          'dice-bandits:room:ABCDE',
          JSON.stringify({
            session: { code: 'ABCDE', seat: 0, token: 'synthetic-offline-sentinel', name: 'Human' },
            savedAt: 1,
          }),
        );
      },
      { lang, state: savedState },
    );
    await page.goto('/?speed=0');
    await page.getByTestId('title-play').click();
    await expect(page.getByTestId('online-back')).toBeVisible();
    await scan(page, `${lang}-${width}x${height}-saved-room`, info);
    await page.getByTestId('audio-settings').click();
    await expect(page.getByTestId('audio-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('audio-settings')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('title-play')).toBeFocused();
  });
}
