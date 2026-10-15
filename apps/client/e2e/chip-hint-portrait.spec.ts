import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { startJourney } from './helpers';

/** Portrait board chip+hint: every world-rule label must fit inside the world
 * chip in at most two lines while the top bar stays clear of the seat cards,
 * and the portrait rotate hint must be readable — WCAG AA (>= 4.5:1) against
 * its own background composited over both black and white (the darkest and
 * lightest map pixels that can sit behind the 93%-alpha chip) — while staying
 * clear of every board control, the action tray and the bottom prompt
 * (same approach as rotate-hint-layout.spec.ts). Landscape, desktop and
 * battle mode are not exercised here; their rects are diffed separately. */

const viewports = [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
];

const ruleKeys = [
  'goldRush',
  'taxHoliday',
  'monsterSurge',
  'slipperyRoads',
  'blackMarket',
  'cursedCapital',
] as const;

// Per the card, each rule is forced by setting the chip's text to the app's
// own translated label (a real seeded game is still started first, so the
// bar, rail, tray and hint are the live portrait layout).
const translations = {
  en: JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')),
  th: JSON.parse(readFileSync(new URL('../src/i18n/th.json', import.meta.url), 'utf8')),
} as Record<'en' | 'th', Record<string, string>>;

type Box = { x: number; y: number; w: number; h: number; right: number; bottom: number };

type ChipReading = {
  label: string;
  lines: number;
  width: number;
  height: number;
  barBottom: number;
  firstCardTop: number;
  overlap: number;
};

type ButtonReading = { name: string; width: number; height: number; top: number };

type HintReading = {
  color: string;
  background: string;
  fontSize: number;
  contrastOverBlack: number;
  contrastOverWhite: number;
  rect: Box;
  collisions: Array<{ name: string; intersection: number }>;
  targetCount: number;
};

async function measureChips(page: Page, lang: 'en' | 'th'): Promise<ChipReading[]> {
  const labels = ruleKeys.map((key) => translations[lang][`worldRule.${key}`]);
  return page.evaluate((ruleLabels) => {
    const chip = document.querySelector<HTMLElement>('[data-testid="world-chip"]')!;
    const bar = document.querySelector('.game-topline')!;
    const firstCard = document.querySelector('.seat-hud .seat-card')!;
    const lineHeight = parseFloat(getComputedStyle(chip).lineHeight) || 16;
    const original = chip.textContent;
    const readings = ruleLabels.map((label) => {
      chip.textContent = label;
      const box = chip.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(chip);
      const text = range.getBoundingClientRect();
      const barBox = bar.getBoundingClientRect();
      const cardBox = firstCard.getBoundingClientRect();
      return {
        label,
        lines: Math.round(text.height / lineHeight),
        width: Math.round(box.width),
        height: Math.round(box.height),
        barBottom: barBox.bottom,
        firstCardTop: cardBox.top,
        overlap: Math.max(0, barBox.bottom - cardBox.top),
      };
    });
    chip.textContent = original;
    return readings;
  }, labels);
}

async function measureToplineButtons(page: Page): Promise<ButtonReading[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.game-topline button')]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && style.visibility !== 'hidden';
      })
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          name: element.getAttribute('data-testid') ?? element.className.toString(),
          width: Math.round(box.width),
          height: Math.round(box.height),
          top: box.top,
        };
      }),
  );
}

async function measureHint(page: Page): Promise<HintReading> {
  return page.evaluate(() => {
    const parse = (value: string): number[] => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = (rgb: number[]): number => {
      const channel = (v: number): number => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    };
    const contrast = (a: number[], b: number[]): number => {
      const l1 = luminance(a);
      const l2 = luminance(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const hint = document.querySelector<HTMLElement>('[data-testid="rotate-hint"]')!;
    const style = getComputedStyle(hint);
    const fg = parse(style.color);
    const bg = parse(style.backgroundColor);
    const bgAlpha = bg.length > 3 ? bg[3] : 1;
    // Composite the background over the darkest and lightest likely map
    // pixels, then measure the (solid) text colour against each composite.
    const composite = (base: number[]): number[] =>
      [0, 1, 2].map((i) => bg[i] * bgAlpha + base[i] * (1 - bgAlpha));
    const box = hint.getBoundingClientRect();
    const rect = {
      x: box.x,
      y: box.y,
      w: box.width,
      h: box.height,
      right: box.right,
      bottom: box.bottom,
    };
    const selector = '.game-shell button, .action-tray, .action-tray > span, .online-status > *';
    const targets = [...document.querySelectorAll<HTMLElement>(selector)].filter((element) => {
      const targetBox = element.getBoundingClientRect();
      const targetStyle = getComputedStyle(element);
      return targetBox.width > 0 && targetBox.height > 0 && targetStyle.visibility !== 'hidden';
    });
    const collisions = targets
      .map((element) => {
        const targetBox = element.getBoundingClientRect();
        return {
          name: element.getAttribute('data-testid') ?? element.className.toString(),
          intersection:
            Math.max(0, Math.min(rect.right, targetBox.right) - Math.max(rect.x, targetBox.x)) *
            Math.max(0, Math.min(rect.bottom, targetBox.bottom) - Math.max(rect.y, targetBox.y)),
        };
      })
      .filter((collision) => collision.intersection > 0);
    return {
      color: style.color,
      background: style.backgroundColor,
      fontSize: parseFloat(style.fontSize),
      contrastOverBlack: contrast(fg.slice(0, 3), composite([0, 0, 0])),
      contrastOverWhite: contrast(fg.slice(0, 3), composite([255, 255, 255])),
      rect,
      collisions,
      targetCount: targets.length,
    };
  });
}

for (const viewport of viewports) {
  for (const lang of ['th', 'en'] as const) {
    const label = `${viewport.width}x${viewport.height}-${lang}`;
    test.describe(label, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
        await startJourney(page);
        // Fonts must be real before any width/line measurement (Mitr loads late).
        await page.evaluate(async () => {
          await document.fonts.ready;
          await document.fonts.load('600 12px Mitr');
          await document.fonts.load('700 14px Mitr');
        });
      });

      test(`world chip fits every rule label in two lines ${label}`, async ({ page }, info) => {
        const readings = await measureChips(page, lang);
        console.log(`chip geometry ${label}: ${JSON.stringify(readings)}`);
        await info.attach(`chip-${label}`, {
          body: JSON.stringify(readings, null, 2),
          contentType: 'application/json',
        });
        for (const reading of readings) {
          expect
            .soft(reading.lines, `${label}: ${reading.label} fits two lines`)
            .toBeLessThanOrEqual(2);
          expect
            .soft(reading.overlap, `${label}: ${reading.label} bar stays above the first card`)
            .toBe(0);
        }
        // The bar row keeps every control visible, tappable and on the chip's row.
        const chipTop = await page.evaluate(
          () => document.querySelector('[data-testid="world-chip"]')!.getBoundingClientRect().top,
        );
        const buttons = await measureToplineButtons(page);
        expect(buttons.length, `${label}: topline buttons rendered`).toBeGreaterThanOrEqual(3);
        for (const button of buttons) {
          expect.soft(button.width, `${label}: ${button.name} width`).toBeGreaterThanOrEqual(44);
          expect.soft(button.height, `${label}: ${button.name} height`).toBeGreaterThanOrEqual(44);
          expect
            .soft(button.top, `${label}: ${button.name} on the chip's row`)
            .toBeGreaterThanOrEqual(chipTop - 2);
          expect
            .soft(button.top, `${label}: ${button.name} not wrapped to a third row`)
            .toBeLessThanOrEqual(chipTop + 12);
        }
      });

      test(`rotate hint is readable and clear of controls ${label}`, async ({ page }, info) => {
        const reading = await measureHint(page);
        console.log(`hint geometry ${label}: ${JSON.stringify(reading)}`);
        await info.attach(`hint-${label}`, {
          body: JSON.stringify(reading, null, 2),
          contentType: 'application/json',
        });
        expect(reading.targetCount, `${label}: controls measured`).toBeGreaterThan(0);
        expect
          .soft(
            Math.min(reading.contrastOverBlack, reading.contrastOverWhite),
            `${label}: hint text contrast over black and white`,
          )
          .toBeGreaterThanOrEqual(4.5);
        expect.soft(reading.fontSize, `${label}: hint font size`).toBeGreaterThanOrEqual(14);
        for (const collision of reading.collisions) {
          expect.soft(collision.intersection, `${label}: hint clear of ${collision.name}`).toBe(0);
        }
        expect(reading.rect.x, `${label}: hint left edge`).toBeGreaterThanOrEqual(0);
        expect(reading.rect.right, `${label}: hint right edge`).toBeLessThanOrEqual(viewport.width);
        expect(reading.rect.bottom, `${label}: hint bottom edge`).toBeLessThanOrEqual(
          viewport.height,
        );
      });
    });
  }
}
