import { expect, test, type Page } from '@playwright/test';
import { playUntil, startTestGame } from './helpers';

/** Same console-error filter as console.spec.ts (headless GL driver noise is expected). */
function watchErrors(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('GL Driver')) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

test('sound settings persist across a reload', async ({ page }) => {
  await page.goto('/?seed=e2e-audio-settings&speed=0');
  await page.locator('[data-testid="audio-settings"]').click();
  await page.locator('[data-testid="audio-music-volume"]').fill('20');
  await expect(page.locator('[data-testid="audio-music-value"]')).toHaveText('20%');
  await page.locator('[data-testid="audio-mute"]').check();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="audio-dialog"]')).toHaveCount(0);

  await page.reload();
  await page.locator('[data-testid="audio-settings"]').click();
  await expect(page.locator('[data-testid="audio-music-volume"]')).toHaveValue('20');
  await expect(page.locator('[data-testid="audio-mute"]')).toBeChecked();
  const stored = await page.evaluate(() => localStorage.getItem('diceBandits.audio'));
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored ?? '{}')).toMatchObject({ muted: true, music: 0.2 });
});

test('board sound toggle flips aria-pressed', async ({ page }) => {
  await startTestGame(page);
  const toggle = page.locator('[data-testid="audio-toggle"]');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('full hot-seat game plays event sounds from clean audio responses', async ({ page }) => {
  // A whole game at speed=0 is ~100 UI actions. The M5a 1280x720
  // non-pixel-art canvas roughly doubles CPU-rasterized frame cost on 2-core
  // CI runners (whole journey ~90 s vs ~45 s at 640x360), so the budget
  // matches the visual-regressions family (150 s).
  test.setTimeout(150_000);
  const { consoleErrors, pageErrors } = watchErrors(page);
  const audioResponses: { url: string; status: number; contentType: string }[] = [];
  page.on('response', (response) => {
    if (!response.url().includes('/audio/')) return;
    audioResponses.push({
      url: response.url(),
      status: response.status(),
      contentType: response.headers()['content-type'] ?? '',
    });
  });

  await startTestGame(page, 0);
  await playUntil(page, (state) => state.phase.kind === 'gameOver');

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  const audioLog = await page.evaluate(() => window.__audioLog);
  expect(audioLog).toContain('dice');
  expect(audioLog).toContain('hit');

  expect(audioResponses.length, 'no /audio/ responses were observed').toBeGreaterThan(0);
  for (const response of audioResponses) {
    expect(response.status, response.url).toBe(200);
    expect(response.contentType, response.url).toMatch(/^audio\//);
  }
});
