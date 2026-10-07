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

test('fresh sound settings use quieter gains', async ({ page }, info) => {
  await page.goto('/?seed=e2e-audio-defaults&speed=0');
  await page.locator('[data-testid="audio-settings"]').click();
  await expect(page.getByTestId('audio-music-volume')).toHaveValue('20');
  await expect(page.getByTestId('audio-sfx-volume')).toHaveValue('60');
  await expect(page.getByTestId('audio-mute')).not.toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('diceBandits.audio'))).toBeNull();
  await page.screenshot({ path: info.outputPath('fresh-audio.png') });
});

test('existing saved gains and mute survive a reload unchanged', async ({ page }, info) => {
  await page.goto('/?seed=e2e-audio-saved&speed=0');
  await page.evaluate(() => {
    localStorage.setItem(
      'diceBandits.audio',
      JSON.stringify({ muted: true, music: 0.5, sfx: 0.8 }),
    );
  });
  await page.reload();
  await page.getByTestId('audio-settings').click();
  await expect(page.getByTestId('audio-music-volume')).toHaveValue('50');
  await expect(page.getByTestId('audio-sfx-volume')).toHaveValue('80');
  await expect(page.getByTestId('audio-mute')).toBeChecked();
  expect(
    JSON.parse((await page.evaluate(() => localStorage.getItem('diceBandits.audio'))) ?? '{}'),
  ).toEqual({ muted: true, music: 0.5, sfx: 0.8 });
  await page.screenshot({ path: info.outputPath('saved-audio.png') });
});

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
  // Keep the original journey budget: smooth 720p textures do not require MSAA.
  test.setTimeout(90_000);
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
