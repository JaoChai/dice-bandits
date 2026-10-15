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

// The four toasts a real game shows while the collapsed banner is on screen:
// the frenzy line from round 10 plus the event toasts. The collapsed banner
// must render each of them in whole words — no mid-word fragment like the
// 44px lane's "Final / Frenz" or "ศึก / เดือด".
const eventKeys = ['FrenzyStarted', 'GoldStolen', 'TownClaimed', 'BattleEnded'] as const;

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

type CollapsedBannerReading = {
  expanded: boolean;
  textBox: { top: number; bottom: number; left: number; right: number };
  lineHeight: number;
  bannerWidth: number;
  chars: Array<{ index: number; top: number; bottom: number; left: number; right: number }>;
  wordStarts: number[];
};

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

/**
 * Collapses the banner (never `.expanded`), puts one real event toast into
 * `.event-text` and measures where every character actually rendered: its
 * line (rounded rect top) and its rect, plus the banner's own boxes. The
 * browser's own Intl.Segmenter supplies the word-start offsets, because Thai
 * has no spaces and the dictionary — not whitespace — defines word
 * boundaries.
 */
async function measureCollapsedBanner(
  page: Page,
  text: string,
  lang: 'en' | 'th',
): Promise<CollapsedBannerReading> {
  await page.evaluate((value) => {
    const banner = document.querySelector<HTMLElement>('[data-testid="event-banner"]')!;
    banner.classList.remove('expanded');
    banner.querySelector<HTMLElement>('.event-text')!.textContent = value;
  }, text);
  await expect(page.getByTestId('event-banner')).toBeVisible();
  return page.evaluate(
    ({ value, locale }) => {
      const banner = document.querySelector<HTMLElement>('[data-testid="event-banner"]')!;
      const et = banner.querySelector<HTMLElement>('.event-text')!;
      const box = et.getBoundingClientRect();
      const chars: CollapsedBannerReading['chars'] = [];
      const node = et.firstChild;
      if (node instanceof Text) {
        const range = document.createRange();
        for (let i = 0; i < node.length; i += 1) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0);
          const first = rects[0];
          if (!first) continue; // combining marks carry no box of their own
          chars.push({
            index: i,
            top: first.top,
            bottom: first.bottom,
            left: first.left,
            right: first.right,
          });
        }
      }
      const wordStarts: number[] = [];
      if ('Segmenter' in Intl) {
        const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
        for (const segment of segmenter.segment(value)) {
          if (segment.isWordLike) wordStarts.push(segment.index);
        }
      }
      return {
        expanded: banner.classList.contains('expanded'),
        textBox: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
        lineHeight: parseFloat(getComputedStyle(et).lineHeight) || 0,
        bannerWidth: Math.round(banner.getBoundingClientRect().width),
        chars,
        wordStarts,
      };
    },
    { value: text, locale: lang },
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

      // The frenzy state is the real chip-row-sharing case: from round 10 the
      // game itself puts t('event.FrenzyStarted') into .event-text, and the
      // banner stops hiding itself (:has(.event-text:empty) no longer
      // matches). Populate it exactly like topline-portrait.spec.ts does, so
      // the chip is measured against a live row mate, not an empty lane.
      test(`world chip fits every rule label in two lines with the frenzy banner visible ${label}`, async ({
        page,
      }, info) => {
        await page.evaluate((frenzy) => {
          const text = document.querySelector<HTMLElement>(
            '[data-testid="event-banner"] .event-text',
          )!;
          text.textContent = frenzy;
        }, translations[lang]['event.FrenzyStarted']);
        await expect(page.getByTestId('event-banner')).toBeVisible();
        const rowMate = await page.evaluate(() => {
          const banner = document
            .querySelector('[data-testid="event-banner"]')!
            .getBoundingClientRect();
          const chip = document
            .querySelector('[data-testid="world-chip"]')!
            .getBoundingClientRect();
          return { bannerWidth: Math.round(banner.width), chipWidth: Math.round(chip.width) };
        });
        const readings = await measureChips(page, lang);
        console.log(
          `chip geometry banner-visible ${label} (banner ${rowMate.bannerWidth}px, chip ${rowMate.chipWidth}px): ${JSON.stringify(readings)}`,
        );
        await info.attach(`chip-banner-${label}`, {
          body: JSON.stringify({ rowMate, readings }, null, 2),
          contentType: 'application/json',
        });
        for (const reading of readings) {
          expect
            .soft(
              reading.lines,
              `${label}: ${reading.label} fits two lines with the banner visible`,
            )
            .toBeLessThanOrEqual(2);
          expect
            .soft(
              reading.overlap,
              `${label}: ${reading.label} bar stays above the first card with the banner visible`,
            )
            .toBe(0);
        }
        // The 44px controls stay on the chip's row: nothing wraps to a third
        // row just because the banner joined it.
        const chipTop = await page.evaluate(
          () => document.querySelector('[data-testid="world-chip"]')!.getBoundingClientRect().top,
        );
        const buttons = await measureToplineButtons(page);
        expect(
          buttons.length,
          `${label}: topline buttons rendered (banner visible)`,
        ).toBeGreaterThanOrEqual(3);
        for (const button of buttons) {
          expect
            .soft(button.width, `${label}: ${button.name} width (banner visible)`)
            .toBeGreaterThanOrEqual(44);
          expect
            .soft(button.height, `${label}: ${button.name} height (banner visible)`)
            .toBeGreaterThanOrEqual(44);
          expect
            .soft(button.top, `${label}: ${button.name} on the chip's row (banner visible)`)
            .toBeGreaterThanOrEqual(chipTop - 2);
          expect
            .soft(
              button.top,
              `${label}: ${button.name} not wrapped to a third row (banner visible)`,
            )
            .toBeLessThanOrEqual(chipTop + 12);
        }
      });

      // The collapsed banner is what a player reads during the last rounds:
      // every character must stay inside the banner's box (nothing clamped
      // away) and every rendered line break must land on a word boundary —
      // whole words only, never a mid-word fragment like "Final / Frenz"
      // or "ศึก / เดือด". Word boundaries come from the browser's own
      // Intl.Segmenter (Thai has no spaces) plus whitespace runs for English.
      test(`collapsed event banner shows whole words with no mid-word split ${label}`, async ({
        page,
      }, info) => {
        for (const key of eventKeys) {
          const text = translations[lang][`event.${key}`];
          const reading = await measureCollapsedBanner(page, text, lang);
          // Chromium's per-glyph range rects use the font's ascent/descent,
          // which hangs a couple of pixels above and below the 16px line box
          // (measured: rect 85-104 vs box 87-103 in Mitr 12px). Only a rect
          // that reaches a whole line past the box is really clamped away.
          const outside = reading.chars.filter((char) => {
            const overhang =
              Math.max(0, Math.ceil(char.bottom - char.top) - reading.lineHeight) + 1;
            return (
              char.bottom > reading.textBox.bottom + overhang ||
              char.top < reading.textBox.top - overhang ||
              char.left < reading.textBox.left - 1.5 ||
              char.right > reading.textBox.right + 1.5
            );
          });
          // A rendered break between consecutive characters must land where
          // a word may start: whitespace or a dictionary word start. Gaps
          // wider than one index are combining marks, not breaks.
          const validStarts = new Set(reading.wordStarts);
          for (const match of text.matchAll(/\S+/g)) validStarts.add(match.index);
          const badBreaks: Array<{ at: number; context: string }> = [];
          const sorted = [...reading.chars].sort((a, b) => a.index - b.index);
          for (let i = 1; i < sorted.length; i += 1) {
            const prev = sorted[i - 1]!;
            const curr = sorted[i]!;
            if (curr.index - prev.index > 3) continue;
            if (Math.round(prev.top) === Math.round(curr.top)) continue;
            const at = curr.index;
            const boundary = at >= text.length || /\s/.test(text[at] ?? '') || validStarts.has(at);
            if (!boundary) {
              badBreaks.push({ at, context: text.slice(Math.max(0, at - 8), at + 8) });
            }
          }
          const lineTops = new Set(reading.chars.map((char) => Math.round(char.top)));
          console.log(
            `collapsed banner ${label} ${key}: banner ${reading.bannerWidth}px, box ${Math.round(reading.textBox.right - reading.textBox.left)}x${Math.round(reading.textBox.bottom - reading.textBox.top)}, lines ${lineTops.size}, charsOutside ${outside.length}, badBreaks ${JSON.stringify(badBreaks)}`,
          );
          await info.attach(`collapsed-banner-${label}-${key}`, {
            body: JSON.stringify(reading, null, 2),
            contentType: 'application/json',
          });
          expect.soft(reading.expanded, `${label}: ${key} banner stays collapsed`).toBe(false);
          expect
            .soft(
              outside.map((char) => char.index),
              `${label}: ${key} every rendered character stays inside the banner box`,
            )
            .toEqual([]);
          expect
            .soft(
              badBreaks.map((bad) => bad.at),
              `${label}: ${key} no rendered line break lands mid-word`,
            )
            .toEqual([]);
          // Every event shares space with every world rule, not only frenzy.
          const chips = await measureChips(page, lang);
          for (const chip of chips) {
            expect.soft(chip.lines, `${label}: ${key} / ${chip.label}`).toBeLessThanOrEqual(2);
            expect.soft(chip.overlap, `${label}: ${key} bar/card overlap`).toBe(0);
          }
          const chipTop = await page
            .getByTestId('world-chip')
            .evaluate((chip) => chip.getBoundingClientRect().top);
          const buttons = await measureToplineButtons(page);
          expect(buttons.length).toBeGreaterThanOrEqual(3);
          for (const button of buttons) {
            expect
              .soft(button.width, `${label}: ${key} / ${button.name} width`)
              .toBeGreaterThanOrEqual(44);
            expect
              .soft(button.height, `${label}: ${key} / ${button.name} height`)
              .toBeGreaterThanOrEqual(44);
            expect
              .soft(button.top, `${label}: ${key} / ${button.name} row top`)
              .toBeGreaterThanOrEqual(chipTop - 2);
            expect
              .soft(button.top, `${label}: ${key} / ${button.name} row bottom`)
              .toBeLessThanOrEqual(chipTop + 12);
          }
          await page.getByTestId('event-banner').click();
          await expect(page.getByTestId('event-banner')).toHaveClass(/expanded/);
          const panel = await page.locator('.event-banner .event-text').evaluate((text) => {
            const rect = text.getBoundingClientRect();
            const bar = document.querySelector('.game-topline')!.getBoundingClientRect();
            const top = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            );
            return {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              barBottom: bar.bottom,
              onTop: top === text || (top !== null && text.contains(top)),
            };
          });
          expect.soft(panel.left, `${label}: ${key} expanded left`).toBeGreaterThanOrEqual(0);
          expect
            .soft(panel.right, `${label}: ${key} expanded right`)
            .toBeLessThanOrEqual(viewport.width);
          expect
            .soft(panel.top, `${label}: ${key} expanded below bar`)
            .toBeGreaterThanOrEqual(panel.barBottom);
          expect.soft(panel.onTop, `${label}: ${key} expanded panel is not obscured`).toBe(true);
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
