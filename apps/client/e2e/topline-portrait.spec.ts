import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { join } from 'node:path';
import { openTitleChoice } from './helpers';

/** Portrait board top bar (B1): the round/turn lane must stay one readable
 * row, the chips/buttons must move to their own row, and the seat rail must
 * start below the bar's real height — the bar may never cover a player card
 * and cards may never touch the roll control, prompt, rotate hint or any
 * other board button. Landscape/desktop keep the U2a single-row bar; battle
 * mode is untouched (not exercised here). */

const viewports = [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
];

/** Setup-screen names are capped at maxlength=18 (screens.ts). Seat 1 is the
 * first seat row (data-seat="0", the human whose name fills the turn ribbon). */
const longNames = {
  th: 'สมชายใจดีมากที่สุด',
  en: 'Sir Brambling XVII',
} as const;

type Box = {
  x: number;
  y: number;
  w: number;
  h: number;
  right: number;
  bottom: number;
};

type Geometry = {
  topline: Box | null;
  ribbon: Box | null;
  ribbonWordBreak: string;
  ribbonText: string;
  cards: Array<{ name: string; rect: Box }>;
  obstacles: Array<{ name: string; rect: Box }>;
  toplineButtons: Array<{ name: string; rect: Box }>;
};

async function startBoard(page: Page, lang: 'th' | 'en', name?: string): Promise<void> {
  await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
  await page.goto('/?seed=m5ab-1&speed=0');
  await openTitleChoice(page, 'new');
  for (let seat = 1; seat < 4; seat += 1) {
    await page.locator(`[data-seat="${seat}"] select[data-field="control"]`).selectOption('bot');
  }
  await page.locator('[data-seat="0"] select[data-field="classId"]').selectOption('knight');
  if (name) {
    const input = page.locator('[data-seat="0"] input[data-field="name"]');
    await input.fill(name);
    await expect(input).toHaveValue(name);
  }
  await page.locator('#setup-form button[type="submit"]').click();
  await expect(page.locator('[data-testid="screen-board"]')).toBeVisible();
}

async function measureTopline(page: Page): Promise<Geometry> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const rect = (element: Element | null): Box | null => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        w: box.width,
        h: box.height,
        right: box.right,
        bottom: box.bottom,
      };
    };
    const visible = (element: Element): boolean => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden';
    };
    const label = (element: Element): string =>
      element.getAttribute('data-testid') ?? element.className.toString();
    const topline = document.querySelector('.game-topline');
    const ribbon = document.querySelector<HTMLElement>('[data-testid="turn-ribbon"]');
    // Buttons the seat rail must never touch: the roll control, tray buttons
    // and any other board button — the bar's own buttons and the cards' own
    // seat-detail buttons are excluded (they live in the measured elements).
    const controlSelector = '.game-shell button:not(.game-topline button):not(.seat-card button)';
    return {
      topline: rect(topline),
      ribbon: rect(ribbon),
      ribbonWordBreak: ribbon ? getComputedStyle(ribbon).wordBreak : '',
      ribbonText: ribbon?.textContent?.trim() ?? '',
      cards: [...document.querySelectorAll('.seat-hud .seat-card')]
        .filter(visible)
        .map((element) => ({ name: label(element), rect: rect(element)! })),
      obstacles: [
        ...[...document.querySelectorAll(controlSelector)].filter(visible),
        ...[document.querySelector('[data-testid="action-tray"]')].filter(
          (element): element is Element => element !== null && visible(element),
        ),
        ...[document.querySelector('.action-tray > span')].filter(
          (element): element is Element => element !== null && visible(element),
        ),
        ...[document.querySelector('[data-testid="rotate-hint"]')].filter(
          (element): element is Element => element !== null && visible(element),
        ),
      ].map((element) => ({ name: label(element), rect: rect(element)! })),
      toplineButtons: [...document.querySelectorAll('.game-topline button')]
        .filter(visible)
        .map((element) => ({ name: label(element), rect: rect(element)! })),
    };
  });
}

function intersection(a: Box, b: Box): number {
  return (
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y))
  );
}

async function assertToplineClear(page: Page, label: string, info: TestInfo): Promise<void> {
  await expect(page.getByTestId('action-roll')).toBeVisible();
  const geometry = await measureTopline(page);
  console.log(`topline geometry ${label}: ${JSON.stringify(geometry)}`);
  await info.attach(`topline-${label}`, {
    body: JSON.stringify(geometry, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath(`${label}.png`) });
  if (process.env.TOPLINE_EVIDENCE_DIR) {
    await page.screenshot({
      path: join(process.env.TOPLINE_EVIDENCE_DIR, `${info.project.name}-${label}.png`),
    });
  }
  expect(geometry.topline, 'board top bar is rendered').not.toBeNull();
  expect(geometry.cards, 'four seat cards are rendered').toHaveLength(4);
  expect(geometry.ribbonText, 'turn text is populated').not.toBe('');
  // The bar must not cover any player card.
  for (const card of geometry.cards) {
    expect
      .soft(intersection(geometry.topline!, card.rect), `${label}: topline / ${card.name}`)
      .toBe(0);
    // …and the rail must stay clear of every board control.
    for (const obstacle of geometry.obstacles) {
      expect
        .soft(intersection(card.rect, obstacle.rect), `${label}: card / ${obstacle.name}`)
        .toBe(0);
    }
  }
  // The turn text reads normally: at most two lines, never broken mid-word.
  expect(geometry.ribbon!.h, `${label}: turn ribbon height`).toBeLessThanOrEqual(40);
  expect(geometry.ribbonWordBreak, `${label}: turn ribbon word-break`).not.toBe('break-all');
  // Every bar control stays visible and tappable.
  for (const button of geometry.toplineButtons) {
    expect.soft(button.rect.w, `${label}: ${button.name} width`).toBeGreaterThanOrEqual(44);
    expect.soft(button.rect.h, `${label}: ${button.name} height`).toBeGreaterThanOrEqual(44);
  }
}

for (const viewport of viewports) {
  for (const lang of ['th', 'en'] as const) {
    for (const long of [false, true]) {
      const name = long ? longNames[lang] : undefined;
      const label = `${viewport.width}x${viewport.height}-${lang}-${long ? 'long-name' : 'default'}`;
      test(`board topline never covers the player cards ${label}`, async ({ page }, info) => {
        await page.setViewportSize(viewport);
        await startBoard(page, lang, name);
        await assertToplineClear(page, label, info);
      });
    }
  }
}

test('expanded event banner opens under the bar in portrait', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await startBoard(page, 'th');
  // The banner hides itself while its text is empty (round < 10 frenzy
  // banner): populate the app's own event-text span, then use the real
  // click toggle so the expanded panel is exercised as a player would.
  await page.evaluate(() => {
    const text = document.querySelector<HTMLElement>('[data-testid="event-banner"] .event-text')!;
    text.textContent = 'เวทีบ้าบอเริ่มแล้ว! ลุยกันต่อเลย';
  });
  await expect(page.getByTestId('event-banner')).toBeVisible();
  await page.getByTestId('event-banner').click();
  await expect(page.locator('.game-topline .event-banner.expanded')).toHaveCount(1);
  const rects = await page.evaluate(() => {
    const bar = document.querySelector('.game-topline')!.getBoundingClientRect();
    const panel = document
      .querySelector('.game-topline .event-banner .event-text')!
      .getBoundingClientRect();
    return { bar: bar.toJSON(), panel: panel.toJSON() };
  });
  console.log(`event banner geometry: ${JSON.stringify(rects)}`);
  await info.attach('event-banner', {
    body: JSON.stringify(rects, null, 2),
    contentType: 'application/json',
  });
  expect(rects.panel.height).toBeGreaterThan(0);
  expect(rects.panel.top).toBeGreaterThanOrEqual(rects.bar.bottom);
});
