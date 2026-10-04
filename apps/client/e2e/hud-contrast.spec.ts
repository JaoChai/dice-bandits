import { expect, test } from '@playwright/test';

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
