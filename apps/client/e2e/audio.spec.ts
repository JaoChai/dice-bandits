import { expect, test, type Page } from '@playwright/test';
import { playUntil, startJourney, startTestGame } from './helpers';

type MusicProbeWindow = Window & {
  __musicStarts: Array<{ duration: number; sampleRate: number; loop: boolean; state: string }>;
};

/** Observe real Web Audio starts; only emulate the browser's missing OGG capability. */
async function observeMp3Fallback(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = window as unknown as MusicProbeWindow;
    scope.__musicStarts = [];
    const canPlayType = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (type) {
      return type.includes('ogg') ? '' : canPlayType.call(this, type);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      start.apply(this, args);
      if (this.loop && this.buffer) {
        scope.__musicStarts.push({
          duration: this.buffer.duration,
          sampleRate: this.buffer.sampleRate,
          loop: this.loop,
          state: this.context.state,
        });
      }
    };
  });
}

test('MP3 fallback decodes and starts both looping tracks only after a gesture', async ({
  page,
}) => {
  await observeMp3Fallback(page);
  const { consoleErrors, pageErrors } = watchErrors(page);
  const musicResponses: { path: string; status: number; contentType: string }[] = [];
  page.on('response', (response) => {
    if (!response.url().includes('/audio/music/')) return;
    musicResponses.push({
      path: new URL(response.url()).pathname,
      status: response.status(),
      contentType: response.headers()['content-type'] ?? '',
    });
  });

  await page.goto('/?seed=m5ab-1&speed=0');
  await expect(page.getByTestId('title-play')).toBeVisible();
  expect(musicResponses).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as MusicProbeWindow).__musicStarts)).toEqual(
    [],
  );

  await startJourney(page);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as MusicProbeWindow).__musicStarts.length))
    .toBe(1);
  await playUntil(page, (state) => state.phase.kind === 'battle');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as MusicProbeWindow).__musicStarts.length))
    .toBe(2);

  const starts = await page.evaluate(() => (window as unknown as MusicProbeWindow).__musicStarts);
  expect(starts[0].duration).toBeCloseTo(97.45, 0);
  expect(starts[1].duration).toBeCloseTo(94.8, 0);
  for (const started of starts) {
    expect(started.loop).toBe(true);
    expect(started.state).toBe('running');
    expect(started.sampleRate).toBeGreaterThanOrEqual(44_100);
  }
  expect(musicResponses.map((response) => response.path)).toEqual([
    '/audio/music/board.mp3',
    '/audio/music/battle.mp3',
  ]);
  for (const response of musicResponses) {
    expect(response.status, response.path).toBe(200);
    expect(response.contentType, response.path).toMatch(/^audio\/mpeg/);
  }
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('failed MP3 music loads do not stop the hot-seat battle journey or SFX', async ({ page }) => {
  await observeMp3Fallback(page);
  const pageErrors: string[] = [];
  const warnings: string[] = [];
  const failedMusic: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.route('**/audio/music/*.mp3', (route) => {
    failedMusic.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Music unavailable' });
  });

  await startJourney(page);
  await playUntil(page, (state) => state.phase.kind === 'battle');
  await expect.poll(() => failedMusic).toContain('/audio/music/board.mp3');
  await expect.poll(() => failedMusic).toContain('/audio/music/battle.mp3');
  for (const path of ['/audio/music/board.mp3', '/audio/music/battle.mp3']) {
    await expect.poll(() => warnings).toContain(`[audio] fetch failed for ${path}: HTTP 503`);
  }
  expect(await page.evaluate(() => (window as unknown as MusicProbeWindow).__musicStarts)).toEqual(
    [],
  );
  await expect.poll(() => page.evaluate(() => window.__audioLog)).toContain('dice');
  expect(await page.evaluate(() => window.__db.getState().phase.kind)).toBe('battle');
  expect(pageErrors).toEqual([]);
});

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
