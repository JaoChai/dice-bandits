import { expect, test } from '@playwright/test';
import { assertInside, assertNoEllipsis } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

const captions = {
  en: [
    'King Bart opens the royal treasure chest… only moths fly out!',
    "Baron Raccoon runs off with the Golden Pig — the kingdom's piggy bank!",
    '“Whoever brings back the most gold wins the crown!” Dicey will guide you.',
    "The heroes dash off… and Mint is already picking Sir Bram's pocket!",
  ],
  th: [
    'หีบสมบัติของราชาบาร์ตเหลือแต่ผีเสื้อกลางคืน!',
    'บารอนแรคคูนแบกหมูทองคำ กระปุกออมสินของอาณาจักร หนีไปกลางดึก',
    '“ใครหาเงินคืนอาณาจักรได้มากที่สุด จะได้มงกุฎ!” ไดซี่จะคอยนำทาง',
    'เหล่าฮีโร่ออกวิ่งทันที… แต่มินต์ล้วงกระเป๋าเซอร์แบรมตั้งแต่ยังไม่พ้นประตูเมือง!',
  ],
};

for (const lang of ['en', 'th'] as const) {
  test(`${lang} comic shows four panels, fits, finishes and replays`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.addInitScript((lang) => localStorage.setItem('lang', lang), lang);
    await page.goto('/?speed=0');
    await expect(page.getByTestId('intro-comic')).toBeVisible();
    for (let panel = 0; panel < 4; panel++) {
      await expect(page.getByTestId('intro-caption')).toHaveText(captions[lang][panel]!);
      await expect
        .poll(() =>
          page
            .getByTestId('intro-panel')
            .evaluate(
              (node) =>
                (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0,
            ),
        )
        .toBe(true);
      await assertInside(page, '[data-testid="intro-comic"]');
      await assertInside(page, '[data-testid="intro-comic"] button, [data-testid="intro-caption"]');
      await assertNoEllipsis(page, '[data-testid="intro-caption"]');
      expect(
        await page
          .getByTestId('intro-caption')
          .evaluate((node) => node.scrollHeight <= node.clientHeight),
      ).toBe(true);
      await expect(page.getByTestId('intro-skip')).toBeVisible();
      const imageWidth = await page
        .getByTestId('intro-panel')
        .evaluate((node) => (node as HTMLImageElement).naturalWidth);
      expect(imageWidth).toBe(testInfo.project.name === 'mobile-landscape' ? 960 : 1600);
      if (lang === 'th' && (panel === 0 || panel === 3)) {
        await page.screenshot({ path: testInfo.outputPath(`comic-th-panel-${panel + 1}.png`) });
      }
      if (panel < 3) await page.getByTestId('intro-next').click();
    }
    await page.getByTestId('intro-done').click();
    await expect(page.getByTestId('intro-comic')).toHaveCount(0);
    // Only completing the first-visit story offers the real practice invitation.
    await expect(page.getByTestId('practice-begin')).toBeVisible();
    await expect(page.getByTestId('practice-begin')).toBeFocused();
    await page.getByTestId('practice-back').click();
    await expect(page.getByTestId('title-practice')).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem('dice-bandits:intro-seen'))).toBe('1');
    await page.reload();
    await expect(page.getByTestId('screen-title')).toBeVisible();
    await expect(page.getByTestId('intro-comic')).toHaveCount(0);
    await page.getByTestId('title-story').click();
    await expect(page.getByTestId('intro-caption')).toHaveText(captions[lang][0]!);
    await page.getByTestId('intro-skip').click();
    await expect(page.getByTestId('practice-dialog')).toHaveCount(0);
    await page.getByTestId('title-story').click();
    for (let panel = 0; panel < 3; panel++) await page.getByTestId('intro-next').click();
    await page.getByTestId('intro-done').click();
    await expect(page.getByTestId('practice-dialog')).toHaveCount(0);
    await expect(page.getByTestId('title-story')).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test('skip persists across reload and keyboard focus is trapped and restored', async ({ page }) => {
  await page.goto('/?speed=0');
  const dialog = page.getByTestId('intro-comic');
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('intro-next')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('intro-skip')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('intro-next')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('intro-skip')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('title-story')).toBeFocused();
  await expect(page.getByTestId('practice-dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('screen-title')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('title-story').click();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('intro-caption')).toHaveText(captions.en[1]!);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('intro-caption')).toHaveText(captions.en[1]!);
  await page.getByTestId('intro-panel').click();
  await expect(page.getByTestId('intro-caption')).toHaveText(captions.en[2]!);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('an empty-storage room deep link does not show the comic', async ({ page }) => {
  await page.goto('/r/ABCDE?speed=0');
  await expect(page.getByRole('alert')).toHaveText('Room not found or no longer available.');
  await expect(page.getByTestId('intro-comic')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('dice-bandits:intro-seen'))).toBeNull();
});

for (const policy of ['speed-zero', 'reduced', 'normal'] as const) {
  test(`${policy} motion policy applies to pan and swaps`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: policy === 'reduced' ? 'reduce' : 'no-preference' });
    await page.goto(policy === 'speed-zero' ? '/?speed=0' : '/');
    await expect
      .poll(() =>
        page
          .getByTestId('intro-panel')
          .evaluate(
            (node) =>
              (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0,
          ),
      )
      .toBe(true);
    const animations = await page
      .getByTestId('intro-panel')
      .evaluate((node) => getComputedStyle(node).animationName);
    expect(animations.includes('intro-pan')).toBe(policy === 'normal');
    await page.getByTestId('intro-next').click();
    await expect
      .poll(() =>
        page
          .getByTestId('intro-panel')
          .evaluate(
            (node) =>
              (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0,
          ),
      )
      .toBe(true);
    const swap = await page
      .getByTestId('intro-panel')
      .evaluate((node) => getComputedStyle(node).animationName);
    expect(swap.includes('intro-fade')).toBe(policy === 'normal');
    await page.keyboard.press('Escape');
  });
}
