import { expect, test } from '@playwright/test';
import { startBattleJourney } from './helpers';

// Removing the label's opaque surface must fail on the blue command cards.
for (const lang of ['th', 'en']) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`battle pick-card labels have readable contrast (${lang}, ${colorScheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
      await startBattleJourney(page);
      const labels = page.locator('.command-card .card-label');
      await expect(labels).toHaveCount(3);
      for (const label of await labels.all()) {
        await expect(label).toBeVisible();
        const contrast = await label.evaluate((element) => {
          const luminance = (color: string) => {
            const linear = color
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number)
              .map((value) => {
                const normalized = value / 255;
                return normalized <= 0.04045
                  ? normalized / 12.92
                  : ((normalized + 0.055) / 1.055) ** 2.4;
              });
            return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
          };
          // Labels may inherit a transparent surface; measure the actual
          // opaque ancestor rather than treating transparent as black.
          let surface: Element | null = element;
          while (surface) {
            const style = getComputedStyle(surface);
            const channels = style.backgroundColor.match(/[\d.]+/g)!.map(Number);
            if (channels.length === 3 || channels[3] === 1) {
              if (style.backgroundImage !== 'none') throw new Error('Unexpected gradient surface');
              const foreground = luminance(getComputedStyle(element).color);
              const background = luminance(style.backgroundColor);
              return (
                (Math.max(foreground, background) + 0.05) /
                (Math.min(foreground, background) + 0.05)
              );
            }
            if (channels[3] !== 0) throw new Error('Unexpected translucent surface');
            surface = surface.parentElement;
          }
          throw new Error('No opaque label surface');
        });
        expect(contrast, (await label.textContent()) ?? 'card label').toBeGreaterThanOrEqual(4.5);
      }
    });
  }
}

test('board, menu and world-rule controls have readable text contrast', async ({ page }) => {
  await page.goto('/?seed=e2e-layout&speed=0');
  await page.locator('[data-action="new"]').click();
  await page.locator('#setup-form button[type="submit"]').click();
  await expect(page.locator('[data-testid="screen-board"]')).toBeVisible();

  for (const selector of [
    '.world-chip',
    '.action-button',
    '.menu-panel .selected',
    '.world-info-card .primary',
  ]) {
    if (selector.includes('.menu-panel')) await page.locator('[data-testid="menu-button"]').click();
    if (selector.includes('.world-info-card')) {
      await page.keyboard.press('Escape');
      await page.locator('[data-testid="world-chip"]').click();
    }
    const control = page.locator(selector).first();
    await expect(control).toBeVisible();
    const contrast = await control.evaluate((element) => {
      const luminance = (color: string) => {
        const rgb = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
        const linear = rgb.map((value) => {
          const normalized = value / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
      };
      const style = getComputedStyle(element);
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(contrast, selector).toBeGreaterThanOrEqual(4.5);
  }
});
