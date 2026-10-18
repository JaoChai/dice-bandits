import { expect, test, type Page } from '@playwright/test';
import { playOneStep, startTestGame } from './helpers';

const VIEWPORTS = [
  { width: 915, height: 412 },
  { width: 844, height: 390 },
  { width: 390, height: 844 },
  { width: 360, height: 780 },
  { width: 1280, height: 720 },
] as const;

const LANGS = ['th', 'en'] as const;

/** Longest legal player names: the setup screen caps names at 18 characters. */
const LONG_NAMES = [
  'Bartholomew Thorne',
  'Maximilian Kowalsk',
  'Wolfgang Amadeus M',
  'Christopher Robins',
] as const;

/**
 * Every per-viewport fit rule for the results screen, collected into one
 * violation list so a single failure names every broken viewport instead of
 * stopping at the first: buttons fully visible and hit-testable, no inner
 * card scroll, no winner/rank overlap, language pills on their own reserved
 * row, readable fonts, painted portraits, and the mockup-A size floors.
 */
async function expectResultsLayoutFits(page: Page, label: string): Promise<void> {
  const violations = await page.evaluate(() => {
    const problems: string[] = [];
    const card = document.querySelector<HTMLElement>('[data-testid="results"]')!;
    const cardBox = card.getBoundingClientRect();

    // 1. Buttons fully inside the viewport AND the card's visible box, the
    // card never scrolls internally, and each button's centre hit-test
    // resolves to that button.
    for (const id of ['play-again', 'results-title']) {
      const button = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const box = JSON.stringify({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      });
      const insideViewport =
        rect.left >= -0.5 &&
        rect.top >= -0.5 &&
        rect.right <= innerWidth + 0.5 &&
        rect.bottom <= innerHeight + 0.5;
      const insideCard =
        rect.left >= cardBox.left - 0.5 &&
        rect.top >= cardBox.top - 0.5 &&
        rect.right <= cardBox.right + 0.5 &&
        rect.bottom <= cardBox.bottom + 0.5;
      if (!insideViewport) problems.push(`${id} not fully inside the viewport ${box}`);
      if (!insideCard) {
        problems.push(
          `${id} not fully inside the card box ${box} vs ${JSON.stringify({
            left: cardBox.left,
            top: cardBox.top,
            right: cardBox.right,
            bottom: cardBox.bottom,
          })}`,
        );
      }
      if (!hit || !(hit === button || button.contains(hit))) {
        problems.push(`${id} centre hit-test resolved to ${hit ? hit.tagName : 'null'}`);
      }
    }
    if (card.scrollHeight > card.clientHeight + 1) {
      problems.push(`card scrolls internally (${card.scrollHeight} > ${card.clientHeight})`);
    }

    // 2. The winner card and the rank rows never intersect.
    const area = (a: DOMRect, b: DOMRect) =>
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const winner = document.querySelector('.results-winner')?.getBoundingClientRect();
    if (!winner) {
      problems.push('winner card missing');
    } else {
      [...document.querySelectorAll('.results-ranking li:not(.results-winner)')].forEach(
        (row, index) => {
          const overlap = area(winner, row.getBoundingClientRect());
          if (overlap > 0.5) {
            problems.push(`rank row ${index} overlaps winner card by ${Math.round(overlap)}px2`);
          }
        },
      );
    }

    // 2b. The language pills keep reserved space: they never intersect the
    // winner card, any rank row, or the crown.
    const pills = document.querySelector('.results-langs')?.getBoundingClientRect();
    if (!pills) {
      problems.push('language pills missing');
    } else {
      for (const element of document.querySelectorAll(
        '.results-winner, .results-ranking li.results-rank, .results-crown',
      )) {
        const overlap = area(pills, element.getBoundingClientRect());
        if (overlap > 0.5) {
          problems.push(
            `${element.className} overlaps language pills by ${Math.round(overlap)}px2`,
          );
        }
      }
    }

    // 2c. Nothing spills past the viewport or out of the card. The card
    // clips its content (overflow hidden), so document.scrollWidth alone
    // stays clean while content is silently cut — assert element edges
    // directly: left >= 0 and right <= innerWidth for the layout root, the
    // language pills, the winner card, every rank row, honour badge and the
    // score line, and every one of them inside the card's visible box.
    if (document.documentElement.scrollWidth > innerWidth + 0.5) {
      problems.push(
        `document scrolls horizontally (${document.documentElement.scrollWidth} > ${innerWidth})`,
      );
    }
    for (const selector of [
      '.results-layout',
      '.results-langs',
      '.results-winner',
      '.results-rank',
      '.results-honour',
      '.results-scoreline',
    ]) {
      document.querySelectorAll(selector).forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        const where = JSON.stringify({
          left: rect.left,
          right: rect.right,
          viewport: innerWidth,
        });
        if (rect.left < -0.5) problems.push(`${selector} crosses the left edge ${where}`);
        if (rect.right > innerWidth + 0.5) {
          problems.push(`${selector} crosses the right edge ${where}`);
        }
        const insideCard =
          rect.left >= cardBox.left - 0.5 &&
          rect.top >= cardBox.top - 0.5 &&
          rect.right <= cardBox.right + 0.5 &&
          rect.bottom <= cardBox.bottom + 0.5;
        if (!insideCard) problems.push(`${selector} sits outside the card box ${where}`);
      });
    }

    // 3. Readability: no text under 14px, every portrait painted.
    for (const element of [card, ...card.querySelectorAll<HTMLElement>('*')]) {
      if (
        element.textContent?.trim() &&
        element.getBoundingClientRect().width > 0 &&
        parseFloat(getComputedStyle(element).fontSize) < 14
      ) {
        problems.push(
          `text under 14px: "${element.textContent.trim().slice(0, 60)}" at ${getComputedStyle(element).fontSize}`,
        );
      }
    }
    const portraits = [...card.querySelectorAll<HTMLElement>('.results-portrait')];
    if (portraits.length !== 4) {
      problems.push(`expected one portrait per player, found ${portraits.length}`);
    }
    for (const portrait of portraits) {
      if (getComputedStyle(portrait).backgroundImage === 'none') {
        problems.push('portrait background image is none');
      }
    }

    // 4. Mockup-A numbers: hero portrait ≥ 84px, winner value ≥ 28px, score
    // line ≥ 15px. Hero-only selectors are absent in the tie layout.
    const sizeOf = (selector: string, property: 'width' | 'fontSize'): number | null => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const value = getComputedStyle(element)[property];
      return value ? parseFloat(value) : null;
    };
    const heroPortrait = sizeOf('.results-portrait-hero', 'width');
    if (heroPortrait !== null && heroPortrait < 84) {
      problems.push(`hero portrait ${heroPortrait}px is under the 84px floor`);
    }
    const winnerValue = sizeOf('.results-winner-value', 'fontSize');
    if (winnerValue !== null && winnerValue < 28) {
      problems.push(`winner value font ${winnerValue}px is under the 28px floor`);
    }
    const scoreline = sizeOf('.results-scoreline', 'fontSize');
    if (scoreline === null || scoreline < 15) {
      problems.push(`score line font ${scoreline}px is under the 15px floor`);
    }
    return problems;
  });
  expect(violations, `${label}: results layout violations`).toEqual([]);
}

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
      await expectResultsLayoutFits(page, label);
    }
  });

  test(`worst legal content fits every viewport (18-char names + 3 honours) (${lang})`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.addInitScript((value) => localStorage.setItem('lang', value), lang);
    await startTestGame(page);

    // Deterministic worst case: a real reached game state, mutated to the
    // widest legal content the setup screen allows (names maxlength=18) with
    // every honour present, then handed back through the same production
    // continue path the title screen uses.
    const state = await page.evaluate(() => window.__db!.getState());
    state.players.forEach((player, index) => {
      player.name = LONG_NAMES[index]!;
    });
    state.phase = {
      kind: 'gameOver',
      ranking: [0, 1, 2, 3],
      winners: [0],
      highlights: [
        { key: 'biggestRobbery', seat: 1, value: 1234 },
        { key: 'mostKod', seat: 3, value: 12 },
        { key: 'hotTown', spaceId: state.towns[0]!.spaceId, flips: 7 },
      ],
    };
    await page.evaluate((injected) => {
      document
        .getElementById('app')!
        .dispatchEvent(new CustomEvent('dice-bandits:continue', { detail: injected }));
    }, state);
    await expect(page.locator('[data-testid="results"]')).toBeVisible();
    await page.locator(`[data-lang="${lang}"]`).click();
    // A gameOver state takes startGame's early return (results without a
    // controller), so window.__db stays stale — assert the worst-case
    // content through the DOM instead: winner name, all 3 honours, 4 rows.
    await expect(page.locator('.results-winner-name')).toHaveText(new RegExp(LONG_NAMES[0]));
    await expect(page.locator('.results-honour')).toHaveCount(3);
    await expect(page.locator('.results-ranking li')).toHaveCount(4);

    for (const viewport of VIEWPORTS) {
      const label = `worst ${lang} ${viewport.width}x${viewport.height}`;
      await page.setViewportSize(viewport);
      await page.waitForTimeout(250);
      await expectResultsLayoutFits(page, label);
    }
  });
}
