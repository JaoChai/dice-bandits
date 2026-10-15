import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openTitleChoice } from './helpers';

const viewports = [
  { width: 474, height: 448 },
  { width: 480, height: 448 },
  { width: 568, height: 320 },
  { width: 640, height: 360 },
];
const names = {
  '18W': 'WWWWWWWWWWWWWWWWWW',
  '18TH': 'ก'.repeat(18),
  '11EN': 'Supachai_TH',
  default: null,
};
const events = ['empty', 'FrenzyStarted', 'GoldStolen', 'TownClaimed', 'BattleEnded'] as const;
const translations = Object.fromEntries(
  ['th', 'en'].map((lang) => [
    lang,
    JSON.parse(readFileSync(new URL(`../src/i18n/${lang}.json`, import.meta.url), 'utf8')),
  ]),
) as Record<'th' | 'en', Record<string, string>>;

async function settledLayout(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

// Removing the clamp or restoring break-all must expose the bar/card collision
// or >2 visible lines. Names come from the real setup, never a replaced ribbon.
// Split by viewport, locale AND name so five event states stay well below 15s.
for (const viewport of viewports) {
  for (const lang of ['th', 'en'] as const) {
    for (const [name, value] of Object.entries(names)) {
      test(`landscape turn clears seat 1 ${viewport.width}x${viewport.height} ${lang} ${name}`, async ({
        page,
      }, info) => {
        await page.setViewportSize(viewport);
        await page.addInitScript((locale) => {
          localStorage.setItem('lang', locale);
          localStorage.setItem('dice-bandits:intro-seen', '1');
        }, lang);
        await page.goto('/?seed=m5ab-1&speed=0');
        await openTitleChoice(page, 'new');
        for (let seat = 1; seat < 4; seat += 1) {
          await page
            .locator(`[data-seat="${seat}"] select[data-field="control"]`)
            .selectOption('bot');
        }
        await page.locator('[data-seat="0"] select[data-field="classId"]').selectOption('knight');
        const input = page.locator('[data-seat="0"] input[data-field="name"]');
        if (value !== null) {
          await input.fill(value);
          await expect(input).toHaveValue(value);
        }
        const actualName = await input.inputValue();
        expect(actualName.length, 'real setup name is populated').toBeGreaterThan(0);
        await page.locator('#setup-form button[type="submit"]').click();
        await expect(page.getByTestId('action-roll')).toBeVisible();
        const ribbon = page.getByTestId('turn-ribbon');
        await expect(ribbon).toContainText(actualName);
        await expect(ribbon).toHaveAttribute('role', 'status');
        const fullTurnText = await ribbon.textContent();
        await page.evaluate(async () => {
          await document.fonts.ready;
          await document.fonts.load('600 12px Mitr');
          await document.fonts.load('700 14px Mitr');
        });
        const rows = [];
        for (const event of events) {
          // Real translated toasts occupy the same banner as production events;
          // leave the seeded controller parked on the human's first turn.
          await page.locator('.event-banner').evaluate(
            (banner, text) => {
              banner.classList.remove('expanded');
              banner.querySelector('.event-text')!.textContent = text;
            },
            translations[lang][`event.${event}`] ?? '',
          );
          await settledLayout(page);
          const geometry = await page.evaluate(() => {
            const bar = document.querySelector('.game-topline')!.getBoundingClientRect();
            const card = document.querySelector('.seat-hud .seat-card')!.getBoundingClientRect();
            const turn = document.querySelector<HTMLElement>('[data-testid="turn-ribbon"]')!;
            const rect = turn.getBoundingClientRect();
            const style = getComputedStyle(turn);
            return {
              barBottom: bar.bottom,
              cardTop: card.top,
              intersection:
                Math.max(0, Math.min(bar.right, card.right) - Math.max(bar.left, card.left)) *
                Math.max(0, Math.min(bar.bottom, card.bottom) - Math.max(bar.top, card.top)),
              lines: rect.height / parseFloat(style.lineHeight),
              wordBreak: style.wordBreak,
              scrollWidth: document.documentElement.scrollWidth,
              clientWidth: document.documentElement.clientWidth,
              centre: { x: card.x + card.width / 2, y: card.y + card.height / 2 },
            };
          });
          // Coordinate tap deliberately bypasses locator auto-wait scrolling or
          // retries: a covering bar must receive this click and fail the test.
          if (info.project.use.hasTouch)
            await page.touchscreen.tap(geometry.centre.x, geometry.centre.y);
          else await page.mouse.click(geometry.centre.x, geometry.centre.y);
          await settledLayout(page);
          const tap = await page.getByTestId('seat-detail-panel').isVisible();
          rows.push({ viewport, lang, name, actualName, event, ...geometry, tap });
          if (tap) {
            await expect(page.getByTestId('seat-detail-panel')).toContainText(actualName);
            await page.getByTestId('seat-detail-close').click();
          }
          const context = `${viewport.width}x${viewport.height}/${lang}/${name}/${event}`;
          expect
            .soft(geometry.barBottom, `${context}: bar bottom vs card top`)
            .toBeLessThanOrEqual(geometry.cardTop);
          expect.soft(geometry.intersection, `${context}: actual intersection`).toBe(0);
          expect.soft(geometry.lines, `${context}: visible ribbon lines`).toBeGreaterThan(0);
          expect.soft(geometry.lines, `${context}: visible ribbon lines`).toBeLessThanOrEqual(2);
          expect.soft(geometry.wordBreak, `${context}: whole-word wrapping`).toBe('normal');
          expect.soft(tap, `${context}: centre tap opens seat dialog`).toBe(true);
          expect
            .soft(geometry.scrollWidth, `${context}: no document overflow`)
            .toBe(geometry.clientWidth);
          await expect(ribbon).toHaveText(fullTurnText!);
        }
        console.log(`landscape geometry: ${JSON.stringify(rows)}`);
        await info.attach('landscape-geometry', {
          body: JSON.stringify(rows),
          contentType: 'application/json',
        });
      });
    }
  }
}
