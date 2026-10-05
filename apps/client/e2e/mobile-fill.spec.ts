import type Phaser from 'phaser';
import { expect, test, type Page } from '@playwright/test';
import {
  assertInside,
  assertMinFont,
  assertNoEllipsis,
  observeBoardGame,
  playUntil,
  renderedBoardGeometry,
  startJourney,
  waitForBattleArt,
} from './helpers';

type ProbeWindow = Window & { __m5aGame?: Phaser.Game };
const viewports = [
  { width: 915, height: 412 },
  { width: 932, height: 388 },
  { width: 1280, height: 720 },
];

/** Screenshot pixels, not a canvas-only read that would miss stage pillarboxing. */
async function edgePixels(page: Page) {
  const png = await page.screenshot();
  return page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height).data;
    return ['left', 'right'].map((side) => {
      let forbidden = 0;
      for (let y = 0; y < image.height; y++) {
        for (let column = 0; column < 8; column++) {
          const x = side === 'left' ? column : image.width - 1 - column;
          const i = (y * image.width + x) * 4;
          if (
            (data[i] === 228 && data[i + 1] === 213 && data[i + 2] === 174) ||
            (data[i] === 39 && data[i + 1] === 52 && data[i + 2] === 73)
          )
            forbidden++;
        }
      }
      return { side, forbidden, samples: image.height * 8 };
    });
  }, png.toString('base64'));
}

async function fillMeasurement(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      (window as ProbeWindow).__m5aGame!.events.once('postrender', resolve),
    );
  });
  return page.evaluate(() => {
    const stage = document.querySelector('.board-stage')!.getBoundingClientRect();
    const canvas = document.querySelector('canvas')!.getBoundingClientRect();
    return { stage: stage.toJSON(), canvas: canvas.toJSON() };
  });
}

async function hudMeasurement(page: Page) {
  const geometry = await renderedBoardGeometry(page);
  const chrome = await page
    .locator(
      '.seat-card, .game-topline > :not(.menu-slot), .menu-button, .action-tray, .event-banner, .turn-ribbon',
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) > 0
          );
        })
        .map((element) => ({
          name: element.className,
          ...element.getBoundingClientRect().toJSON(),
        })),
    );
  const cards = chrome.filter((rect) => rect.name.includes('seat-card'));
  // Union of intersections: overlapping chrome must not be double-counted.
  const coverage = geometry.tokens.map((token) => {
    const boxes = chrome
      .map((rect) => ({
        left: Math.max(token.left, rect.left),
        right: Math.min(token.right, rect.right),
        top: Math.max(token.top, rect.top),
        bottom: Math.min(token.bottom, rect.bottom),
      }))
      .filter((box) => box.right > box.left && box.bottom > box.top);
    const xs = [...new Set(boxes.flatMap((box) => [box.left, box.right]))].sort((a, b) => a - b);
    let area = 0;
    for (let i = 1; i < xs.length; i++) {
      const intervals = boxes
        .filter((box) => box.left < xs[i]! && box.right > xs[i - 1]!)
        .map((box) => [box.top, box.bottom] as const)
        .sort((a, b) => a[0] - b[0]);
      let end = -Infinity;
      let height = 0;
      for (const [top, bottom] of intervals) {
        height += Math.max(0, bottom - Math.max(top, end));
        end = Math.max(end, bottom);
      }
      area += (xs[i]! - xs[i - 1]!) * height;
    }
    return { world: token.world, percent: (100 * area) / (token.width * token.height) };
  });
  return {
    cards,
    area: cards.reduce((sum, card) => sum + card.width * card.height, 0),
    coverage,
    chrome,
  };
}

for (const viewport of viewports) {
  for (const lang of ['th', 'en'] as const) {
    test(`canvas fill and compact HUD ${viewport.width}x${viewport.height} ${lang}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
      await observeBoardGame(page);
      await startJourney(page);
      await page.waitForFunction(() => window.__db?.art.boardReady);
      await page.evaluate(() => document.fonts.ready);
      const hud = await hudMeasurement(page);
      console.log(`HUD ${viewport.width}x${viewport.height} ${lang}: ${JSON.stringify(hud)}`);
      await testInfo.attach('hud', { body: JSON.stringify(hud), contentType: 'application/json' });
      if (viewport.width < 1000) {
        // Measured on unmodified main 4dedfb0 with m5ab-1, fonts ready:
        // 915x412 TH 80961.470703125 / EN 96236.9609375 CSS px²;
        // 932x388 TH/EN 82465.0244140625 CSS px².
        const baseline =
          viewport.width === 915
            ? lang === 'th'
              ? 80961.470703125
              : 96236.9609375
            : 82465.0244140625;
        expect
          .soft(hud.area, 'seat cards reduced by at least 25% from main')
          .toBeLessThanOrEqual(baseline * 0.75);
        expect(hud.coverage).toHaveLength(4);
        for (const token of hud.coverage)
          expect.soft(token.percent, 'hero chrome coverage <=3%').toBeLessThanOrEqual(3);
      }
      await assertMinFont(page, '.seat-card', 12);
      await assertInside(page, '.seat-card *:visible', '.game-shell');
      for (const card of await page.locator('.seat-card').all()) {
        await assertNoEllipsis(
          page,
          `.${(await card.getAttribute('class'))!.split(' ').filter(Boolean).join('.')}`,
        );
      }
      for (const mode of ['board-start', 'whole-map', 'board-return', 'battle'] as const) {
        if (mode === 'whole-map' || mode === 'board-return')
          await page.locator('[data-testid="map-toggle"]').click();
        if (mode === 'battle') {
          await playUntil(page, (state) => state.phase.kind === 'battle');
          await waitForBattleArt(page);
        }
        const fill = await fillMeasurement(page);
        const pixels = await edgePixels(page);
        console.log(
          `Fill ${viewport.width}x${viewport.height} ${lang} ${mode}: ${JSON.stringify({ fill, pixels })}`,
        );
        await testInfo.attach(mode, {
          body: JSON.stringify({ fill, pixels }),
          contentType: 'application/json',
        });
        await page.screenshot({ path: testInfo.outputPath(`${mode}.png`) });
        for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
          expect
            .soft(Math.abs(fill.canvas[edge] - fill.stage[edge]), `canvas ${edge} fills stage`)
            .toBeLessThanOrEqual(1);
        }
        for (const column of pixels)
          expect.soft(column.forbidden, `${mode} ${column.side} background pixels`).toBe(0);
      }
    });
  }
}
