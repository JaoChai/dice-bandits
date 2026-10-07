import { writeFile } from 'node:fs/promises';
import en from '../src/i18n/en.json' with { type: 'json' };
import th from '../src/i18n/th.json' with { type: 'json' };
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  assertInside,
  assertMinFont,
  assertNoEllipsis,
  startJourney,
  waitForBattleArt,
} from './helpers';

async function enableTips(page: Page, lang: 'en' | 'th' = 'en') {
  await page.addInitScript((locale) => {
    if (!localStorage.getItem('dicey-core-seeded')) {
      localStorage.setItem('dice-bandits:tips', JSON.stringify({ enabled: true, seen: [] }));
      localStorage.setItem('dicey-core-seeded', '1');
    }
    localStorage.setItem('lang', locale);
  }, lang);
}
async function measure(page: Page, phase: string, info: TestInfo) {
  await assertInside(page, '[data-testid="dicey-tip"]');
  await assertNoEllipsis(page, '[data-testid="dicey-tip"]');
  await assertMinFont(page, '[data-testid="dicey-tip"]', 12);
  const rows = await page.evaluate(() => {
    const tip = document.querySelector('[data-testid="dicey-tip"]')!.getBoundingClientRect();
    const selectors = [
      '.action-tray',
      '.seat-card',
      '.turn-ribbon',
      '[data-testid="menu-button"]',
      '[data-testid="map-toggle"]',
      '.battle-hud',
      '.battle-hp-card',
      '.game-topline > *',
      '.event-banner',
    ];
    return selectors.flatMap((selector) =>
      [...document.querySelectorAll(selector)].map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const visible =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0;
        return {
          control: `${selector}[${index}]`,
          visible,
          tip: { left: tip.left, top: tip.top, right: tip.right, bottom: tip.bottom },
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          overlap: visible
            ? Math.max(0, Math.min(tip.right, rect.right) - Math.max(tip.left, rect.left)) *
              Math.max(0, Math.min(tip.bottom, rect.bottom) - Math.max(tip.top, rect.top))
            : 0,
        };
      }),
    );
  });
  const evidence = JSON.stringify({ viewport: page.viewportSize(), rows }, null, 2);
  await writeFile(info.outputPath(`${phase}-overlap.json`), evidence);
  await info.attach(`${phase}-overlap`, { body: evidence, contentType: 'application/json' });
  for (const row of rows) expect(row.overlap, `${phase}: ${JSON.stringify(row)} px²`).toBe(0);
  const button = await page.getByTestId('dicey-tip-ok').boundingBox();
  expect(button!.height).toBeGreaterThanOrEqual(44);
  expect(button!.width).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath(`${phase}.png`) });
  if (process.env.AXE_SOURCE) {
    await page.addScriptTag({ path: process.env.AXE_SOURCE });
    const result = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: { run: (options: unknown) => Promise<{ violations: { impact: string }[] }> };
        }
      ).axe;
      return axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
    });
    await info.attach(`${phase}-axe`, {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });
    const serious = result.violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact),
    );
    console.log(`axe Dicey ${phase}: ${serious.length} serious/critical`);
    expect(serious).toEqual([]);
  }
}

test('initial local roll tips are non-blocking, dismissed and persistent on resume', async ({
  page,
}) => {
  await enableTips(page);
  await startJourney(page);
  await expect(page.getByTestId('dicey-tip')).toHaveAttribute('data-topic', 'roll');
  const before = await page.evaluate(() => JSON.stringify(window.__db!.getState()));
  await page.getByTestId('dicey-tip-ok').click();
  await expect(page.getByTestId('dicey-tip')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(window.__db!.getState()))).toBe(before);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dice-bandits:tips')!));
  expect(stored.seen).toContain('roll');
  await page.reload();
  await page.locator('[data-action="continue"]').click();
  await expect(page.getByTestId('screen-board')).toBeVisible();
  await expect(page.getByTestId('dicey-tip')).toHaveCount(0);
  await page.getByTestId('action-roll').click();
  await expect(page.getByTestId('dicey-tip')).toHaveAttribute('data-topic', 'battle');
  await expect(page.getByTestId('pick-attack')).toBeEnabled();
});

for (const lang of ['en', 'th'] as const) {
  test(`tip geometry, battle controls and all four takeover badges ${lang}`, async ({
    page,
  }, info) => {
    await enableTips(page, lang);
    await startJourney(page);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByTestId('dicey-tip')).toBeVisible();
    await expect(page.locator('.dicey-portrait')).toBeVisible({ timeout: 15_000 });
    await measure(page, `roll-${lang}`, info);
    // Visual copy fixture in the real bubble: every approved instruction must
    // fit in 1–2 lines; restore the real text before any game action.
    const lines = await page.evaluate(
      (messages) => {
        const text = document.querySelector<HTMLElement>('.dicey-text')!;
        const tip = text.closest<HTMLElement>('.dicey-tip')!;
        const original = text.textContent;
        const rows = Object.entries(messages)
          .filter(([key]) => key.startsWith('dicey.tip.'))
          .map(([key, value]) => {
            // Match the approved topic-specific bubble. Other topics no
            // longer share Roll's compact two-line width; keep the 2-line gate.
            tip.classList.toggle('dicey-anchored', key === 'dicey.tip.roll');
            text.textContent = value;
            return {
              key,
              lines:
                text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight),
            };
          });
        tip.classList.add('dicey-anchored');
        text.textContent = original;
        return rows;
      },
      lang === 'th' ? th : en,
    );
    for (const row of lines) expect(row.lines, row.key).toBeLessThanOrEqual(2);
    // Do not acknowledge: press the real action with Dicey still on screen.
    await page.getByTestId('action-roll').click();
    await waitForBattleArt(page);
    await expect(page.getByTestId('dicey-tip')).toHaveAttribute('data-topic', 'battle');
    await measure(page, `battle-${lang}`, info);
    // Same test-only visual fixture used by battle-hud.spec.ts, no state mutation.
    await page.evaluate(() => {
      document.querySelectorAll('.seat-card').forEach((card, seat) => {
        const badge = document.createElement('small');
        badge.className = 'seat-status';
        badge.dataset.testid = `seat-takeover-${seat}`;
        badge.textContent = 'Bot takeover';
        card.querySelector('.seat-details')!.append(badge);
      });
    });
    await measure(page, `takeover-${lang}`, info);
    await page.getByTestId('pick-attack').click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem('dice-bandits:tips')!).seen.includes('battle'),
        ),
      )
      .toBe(true);
  });
}

test('missing Dicey art leaves a readable, dismissible text-only tip', async ({ page }, info) => {
  await enableTips(page);
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.route('**/art/tutor/dicey.webp', (route) => route.abort());
  await startJourney(page);
  await expect(page.getByTestId('dicey-tip')).toBeVisible();
  await expect(page.locator('.dicey-portrait')).toBeHidden();
  await expect
    .poll(() => warnings.some((text) => text.includes('Dicey artwork unavailable')))
    .toBe(true);
  await measure(page, 'text-only', info);
  await page.getByTestId('dicey-tip-ok').click();
  await expect(page.getByTestId('dicey-tip')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('empty-dismissed.png') });
});

test('delayed Dicey art never delays a real game action', async ({ page }, info) => {
  await enableTips(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/art/tutor/dicey.webp', async (route) => {
    await pending;
    await route.continue();
  });
  await startJourney(page);
  await expect(page.getByTestId('dicey-tip')).toBeVisible();
  await expect(page.locator('.dicey-portrait')).toBeHidden();
  await page.screenshot({ path: info.outputPath('loading.png') });
  await page.getByTestId('action-roll').click();
  await expect(page.getByTestId('pick-attack')).toBeEnabled();
  release();
  await expect(page.locator('.dicey-portrait')).toBeVisible({ timeout: 15_000 });
});

test('online tips belong only to this human seat and acknowledgement sends no action', async ({
  page,
  browser,
}) => {
  await enableTips(page);
  const sent: string[] = [];
  page.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => {
      sent.push(String(payload));
    }),
  );
  await page.goto('http://127.0.0.1:8787/?speed=0');
  await page.getByTestId('online-create').click();
  await page.getByTestId('online-name').fill('Alice');
  await page.getByTestId('online-create-submit').click();
  await expect(page.getByTestId('screen-lobby')).toBeVisible();
  const code = (await page.locator('.room-code strong').textContent())!.trim();
  const other = await browser.newContext({
    storageState: 'e2e/storage-state.json',
    viewport: page.viewportSize()!,
  });
  try {
    const bob = await other.newPage();
    await enableTips(bob);
    await bob.goto(`http://127.0.0.1:8787/r/${code}?speed=0`);
    await bob.getByTestId('online-name').fill('Bob');
    await bob.getByTestId('online-join-submit').click();
    await expect(page.getByTestId('lobby-seat-1')).toContainText('Bob');
    await page.getByTestId('lobby-start').click();
    await expect(page.getByTestId('dicey-tip')).toHaveAttribute('data-topic', 'roll');
    await expect(bob.getByTestId('screen-board')).toBeVisible();
    await expect(bob.getByTestId('dicey-tip')).toHaveCount(0);
    const before = await page.evaluate(() => JSON.stringify(window.__db!.getState()));
    const actions = () => sent.filter((frame) => frame.includes('"type":"action"')).length;
    const count = actions();
    await page.getByTestId('dicey-tip-ok').click();
    expect(actions()).toBe(count);
    expect(await page.evaluate(() => JSON.stringify(window.__db!.getState()))).toBe(before);
    await page.getByTestId('action-roll').click();
    await expect.poll(actions).toBe(count + 1);
    await expect
      .poll(() => page.evaluate(() => JSON.stringify(window.__db!.getState())))
      .not.toBe(before);
  } finally {
    await other.close();
  }
});
