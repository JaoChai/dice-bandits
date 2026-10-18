import { expect, test } from '@playwright/test';
import { assertMinFont, playOneStep, startTestGame } from './helpers';

const VIEWPORTS = [
  { width: 915, height: 412 },
  { width: 844, height: 390 },
  { width: 390, height: 844 },
  { width: 360, height: 780 },
  { width: 1280, height: 720 },
] as const;

const LANGS = ['th', 'en'] as const;

for (const lang of LANGS) {
  test(`results screen fits every viewport without inner scroll (${lang})`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.addInitScript((value) => localStorage.setItem('lang', value), lang);
    await startTestGame(page);
    let iterations = 0;
    while (!(await page.locator('[data-testid="results"]').isVisible()) && iterations < 3000) {
      await playOneStep(page);
      iterations += 1;
    }

    await expect(page.locator('[data-testid="results"]')).toBeVisible();
    expect(await page.evaluate(() => window.__db.getState().phase.kind)).toBe('gameOver');
    await expect(page.locator('.results-ranking li')).toHaveCount(4);
    test.info().annotations.push({ type: 'results-iterations', description: String(iterations) });

    for (const viewport of VIEWPORTS) {
      const label = `${lang} ${viewport.width}x${viewport.height}`;
      await page.setViewportSize(viewport);
      await page.waitForTimeout(250);

      // 1. Buttons fully inside the viewport AND the card's visible box, the
      // card never scrolls internally, and each button's centre hit-test
      // resolves to that button.
      const geometry = await page.evaluate(() => {
        const card = document.querySelector<HTMLElement>('[data-testid="results"]')!;
        const cardBox = card.getBoundingClientRect();
        const buttons = ['play-again', 'results-title'].map((id) => {
          const button = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
          const rect = button.getBoundingClientRect();
          const centreX = rect.left + rect.width / 2;
          const centreY = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(centreX, centreY);
          return {
            id,
            rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
            insideViewport:
              rect.left >= -0.5 &&
              rect.top >= -0.5 &&
              rect.right <= innerWidth + 0.5 &&
              rect.bottom <= innerHeight + 0.5,
            insideCard:
              rect.left >= cardBox.left - 0.5 &&
              rect.top >= cardBox.top - 0.5 &&
              rect.right <= cardBox.right + 0.5 &&
              rect.bottom <= cardBox.bottom + 0.5,
            hit: hit ? (hit === button || button.contains(hit) ? id : hit.tagName) : 'null',
          };
        });
        return {
          card: {
            rect: {
              left: cardBox.left,
              top: cardBox.top,
              right: cardBox.right,
              bottom: cardBox.bottom,
            },
            scrollHeight: card.scrollHeight,
            clientHeight: card.clientHeight,
          },
          buttons,
        };
      });

      for (const button of geometry.buttons) {
        expect(
          button.insideViewport,
          `${label}: ${button.id} not fully inside the viewport ${JSON.stringify(button.rect)}`,
        ).toBe(true);
        expect(
          button.insideCard,
          `${label}: ${button.id} not fully inside the card box ${JSON.stringify(button.rect)} vs ${JSON.stringify(geometry.card.rect)}`,
        ).toBe(true);
        expect(button.hit, `${label}: ${button.id} centre hit-test resolved to ${button.hit}`).toBe(
          button.id,
        );
      }
      expect(
        geometry.card.scrollHeight,
        `${label}: card scrolls internally (${geometry.card.scrollHeight} > ${geometry.card.clientHeight})`,
      ).toBeLessThanOrEqual(geometry.card.clientHeight + 1);

      // 2. The winner card and the rank rows never intersect.
      const overlap = await page.evaluate(() => {
        const winner = document.querySelector('.results-winner')?.getBoundingClientRect();
        if (!winner) return 'winner card missing';
        const area = (a: DOMRect, b: DOMRect) =>
          Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
          Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return [...document.querySelectorAll('.results-ranking li:not(.results-winner)')]
          .map((row, index) => ({ index, area: area(winner, row.getBoundingClientRect()) }))
          .filter((row) => row.area > 0.5)
          .map((row) => `rank row ${row.index} overlaps by ${Math.round(row.area)}px2`)
          .join(', ');
      });
      expect(overlap, `${label}: winner card and rank rows intersect`).toBe('');

      // 3. Readability: no text under 14px, every portrait painted, one li per player.
      await assertMinFont(page, '[data-testid="results"]', 14);
      const portraits = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.results-portrait')].map(
          (portrait) => getComputedStyle(portrait).backgroundImage,
        ),
      );
      expect(portraits, `${label}: one portrait per player`).toHaveLength(4);
      for (const image of portraits) {
        expect(image, `${label}: portrait background image`).not.toBe('none');
      }

      // 4. Mockup-A numbers: hero portrait ≥ 84px, winner value ≥ 28px, score
      // line ≥ 15px. Hero-only selectors are absent in the tie layout.
      const sizes = await page.evaluate(() => {
        const sizeOf = (selector: string, property: 'width' | 'fontSize'): number | null => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) return null;
          const value = getComputedStyle(element)[property];
          return value ? parseFloat(value) : null;
        };
        return {
          heroPortrait: sizeOf('.results-portrait-hero', 'width'),
          winnerValue: sizeOf('.results-winner-value', 'fontSize'),
          scoreline: sizeOf('.results-scoreline', 'fontSize'),
        };
      });
      expect(
        sizes.heroPortrait === null || sizes.heroPortrait >= 84,
        `${label}: hero portrait ${sizes.heroPortrait}px is under the 84px floor`,
      ).toBe(true);
      expect(
        sizes.winnerValue === null || sizes.winnerValue >= 28,
        `${label}: winner value font ${sizes.winnerValue}px is under the 28px floor`,
      ).toBe(true);
      expect(
        sizes.scoreline,
        `${label}: score line font ${sizes.scoreline}px is under the 15px floor`,
      ).toBeGreaterThanOrEqual(15);
    }
  });
}
