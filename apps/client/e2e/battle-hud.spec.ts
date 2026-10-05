import { expect, test, type Page } from '@playwright/test';
import type Phaser from 'phaser';
import en from '../src/i18n/en.json' with { type: 'json' };
import th from '../src/i18n/th.json' with { type: 'json' };
import {
  assertInside,
  assertMinFont,
  assertNoEllipsis,
  observeBoardGame,
  startBattleJourney,
} from './helpers';

type Rect = { left: number; top: number; right: number; bottom: number };
const viewports = [
  { width: 1280, height: 720 },
  { width: 915, height: 412 },
  { width: 932, height: 388 },
];
const controls = ['menu-button', 'map-toggle', 'audio-toggle', 'world-chip', 'turn-ribbon'];

function overlap(a: Rect, b: Rect): number {
  return (
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  );
}

async function renderedExchange(page: Page) {
  return page.evaluate(async () => {
    const game = (window as unknown as Window & { __m5aGame: Phaser.Game }).__m5aGame;
    await new Promise<void>((resolve) => game.events.once('postrender', resolve));
    const scene = game.scene.getScene('BattleScene') as Phaser.Scene & {
      exchangeLabel: Phaser.GameObjects.Text;
    };
    const label = scene.exchangeLabel;
    const camera = scene.cameras.main;
    const canvas = game.canvas.getBoundingClientRect();
    const bounds = label.getBounds();
    const corners = [
      [bounds.left, bounds.top],
      [bounds.right, bounds.top],
      [bounds.right, bounds.bottom],
      [bounds.left, bounds.bottom],
    ].map(([x, y]) => {
      const point = camera.getViewMatrix().transformPoint(x!, y!);
      return {
        x: canvas.left + (point.x / game.canvas.width) * canvas.width,
        y: canvas.top + (point.y / game.canvas.height) * canvas.height,
      };
    });
    return {
      left: Math.min(...corners.map((point) => point.x)),
      right: Math.max(...corners.map((point) => point.x)),
      top: Math.min(...corners.map((point) => point.y)),
      bottom: Math.max(...corners.map((point) => point.y)),
      visible: label.visible && label.alpha > 0 && camera.visible,
      text: label.text,
    };
  });
}

async function domRect(page: Page, selector: string): Promise<Rect> {
  return page.locator(selector).evaluate((element) => {
    const { left, top, right, bottom } = element.getBoundingClientRect();
    return { left, top, right, bottom };
  });
}

for (const lang of ['th', 'en'] as const) {
  for (const viewport of viewports) {
    const name = `${viewport.width}x${viewport.height} ${lang}`;
    test.describe(name, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
        await observeBoardGame(page);
        await startBattleJourney(page);
        await page.evaluate(() => document.fonts.ready);
      });

      // Moving HP back into the controls' lane must fail, even when the
      // pointer-events:none HUD leaves the hidden buttons clickable.
      test('HP cards clear visible battle controls', async ({ page }, info) => {
        await expect(page.locator('.battle-hp-card')).toHaveCount(2);
        await expect(page.getByTestId('menu-button')).toBeVisible();
        await expect(page.getByTestId('audio-toggle')).toBeVisible();
        await expect(page.getByTestId('map-toggle')).toBeVisible();
        const ribbon = await domRect(page, '[data-testid="turn-ribbon"]');
        for (const control of ['menu-button', 'map-toggle', 'audio-toggle']) {
          const rect = await domRect(page, `.game-shell [data-testid="${control}"]`);
          expect(overlap(ribbon, rect), `ribbon intersects ${control}`).toBe(0);
        }
        const measurements = [];
        for (const side of ['left', 'right']) {
          const hp = await domRect(page, `.battle-hp-card.${side}`);
          for (const control of controls) {
            const selector = `.game-shell [data-testid="${control}"]`;
            if (!(await page.locator(selector).isVisible())) continue;
            const rect = await domRect(page, selector);
            measurements.push({ side, control, overlap: overlap(hp, rect) });
          }
        }
        console.log(`HP ${name}: ${JSON.stringify(measurements)}`);
        await info.attach('hp-geometry', {
          body: JSON.stringify(measurements, null, 2),
          contentType: 'application/json',
        });
        await page.screenshot({ path: info.outputPath(`battle-${lang}.png`) });
        for (const result of measurements) {
          expect.soft(result.overlap, `${result.side} HP intersects ${result.control}`).toBe(0);
        }
        await assertInside(page, '.battle-hp-card, .action-tray, .command-card', '.game-shell');
        const tray = await domRect(page, '.action-tray');
        console.log(
          `Bottom edge ${name}: ${JSON.stringify({ tray, clearance: viewport.height - tray.bottom })}`,
        );
        await info.attach('bottom-edge', {
          body: JSON.stringify({ tray, clearance: viewport.height - tray.bottom }, null, 2),
          contentType: 'application/json',
        });
        const bottomCanvas = await page.evaluate(async () => {
          const game = (window as unknown as Window & { __m5aGame: Phaser.Game }).__m5aGame;
          await new Promise<void>((resolve) => game.events.once('postrender', resolve));
          const scene = game.scene.getScene('BattleScene');
          const camera = scene.cameras.main;
          const canvas = game.canvas.getBoundingClientRect();
          return scene.children
            .getChildren()
            .filter((child) => child.type === 'Rectangle' && 'depth' in child && child.depth === 7)
            .map((child) => {
              const shape = child as Phaser.GameObjects.Rectangle;
              const bounds = shape.getBounds();
              const bottom = camera
                .getViewMatrix()
                .transformPoint(bounds.right, bounds.bottom + shape.lineWidth / 2);
              return {
                type: 'canvas dice-strip stroke',
                bottom: canvas.top + (bottom.y / game.canvas.height) * canvas.height,
                boundary: canvas.bottom,
              };
            });
        });
        console.log(`Canvas bottom ${name}: ${JSON.stringify(bottomCanvas)}`);
        expect(bottomCanvas).toHaveLength(1);
        for (const strip of bottomCanvas) {
          expect
            .soft(strip.bottom, 'dice-strip stroke clipped at bottom')
            .toBeLessThanOrEqual(strip.boundary);
        }
        await info.attach('canvas-bottom-check', {
          body: JSON.stringify(bottomCanvas, null, 2),
          contentType: 'application/json',
        });
        await page.getByTestId('menu-button').click();
        await expect(page.locator('.menu-panel')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.menu-panel')).toHaveCount(0);

        if (process.env.AXE_SOURCE) {
          await page.addScriptTag({ path: process.env.AXE_SOURCE });
          const result = await page.evaluate(async () => {
            const axe = (
              window as unknown as {
                axe: {
                  run: (options: unknown) => Promise<{ violations: Array<{ impact: string }> }>;
                };
              }
            ).axe;
            return axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
          });
          await info.attach('battle-axe', {
            body: JSON.stringify(result, null, 2),
            contentType: 'application/json',
          });
          const severe = result.violations.filter((issue) =>
            ['serious', 'critical'].includes(issue.impact),
          );
          console.log(`axe ${name}: ${severe.length} serious/critical`);
          expect(severe).toEqual([]);
        }
      });

      // Restoring the old 72px takeover row must fail on HP/card overlap;
      // merely moving it down must fail on card/card overlap on short phones.
      test('takeover seats clear HP, each other and the tray with a long-name ribbon', async ({
        page,
      }, info) => {
        const messages = lang === 'th' ? th : en;
        const longName = lang === 'th' ? 'ก'.repeat(18) : 'W'.repeat(18);
        // Test-only DOM fixture: the same badge element/data attribute/text
        // playerCard renders in hud.ts, on the real four battle seat cards.
        // The local deterministic journey has no online disconnect controller.
        await page.evaluate(
          ({ takeover, ribbon, name }) => {
            document.querySelectorAll('.seat-card').forEach((card, seat) => {
              const badge = document.createElement('small');
              badge.className = 'seat-status';
              badge.dataset.testid = `seat-takeover-${seat}`;
              badge.textContent = takeover;
              card.querySelector('.seat-details')!.append(badge);
              card.querySelector('strong')!.textContent = name;
            });
            document.querySelector('[data-testid="turn-ribbon"]')!.textContent = ribbon;
          },
          {
            takeover: messages['online.takeover'],
            ribbon: messages['turn.ribbon'].replace('{name}', longName),
            name: longName,
          },
        );
        const cards = page.locator('.battle-mode .seat-card:visible');
        await expect(cards).toHaveCount(4);
        const rects = await cards.evaluateAll((elements) =>
          elements.map((element) => {
            const { left, top, right, bottom } = element.getBoundingClientRect();
            return { left, top, right, bottom };
          }),
        );
        const tray = await domRect(page, '.action-tray');
        const ribbon = await domRect(page, '[data-testid="turn-ribbon"]');
        const measurements = [];
        for (const side of ['left', 'right']) {
          const hp = await domRect(page, `.battle-hp-card.${side}`);
          for (const [seat, rect] of rects.entries()) {
            measurements.push({ pair: `${side} HP / seat ${seat}`, overlap: overlap(hp, rect) });
          }
          measurements.push({ pair: `${side} HP / long ribbon`, overlap: overlap(hp, ribbon) });
        }
        for (const [seat, rect] of rects.entries()) {
          measurements.push({ pair: `seat ${seat} / tray`, overlap: overlap(rect, tray) });
          for (let other = seat + 1; other < rects.length; other++) {
            measurements.push({
              pair: `seat ${seat} / seat ${other}`,
              overlap: overlap(rect, rects[other]!),
            });
          }
        }
        const label = await renderedExchange(page);
        measurements.push({ pair: 'long ribbon / exchange', overlap: overlap(ribbon, label) });
        console.log(`Takeover ${name}: ${JSON.stringify({ rects, ribbon, measurements })}`);
        await info.attach('takeover-geometry', {
          body: JSON.stringify({ rects, ribbon, measurements }, null, 2),
          contentType: 'application/json',
        });
        await page.screenshot({ path: info.outputPath(`takeover-${lang}.png`) });
        for (const result of measurements) {
          expect.soft(result.overlap, result.pair).toBe(0);
        }
        await assertInside(page, '.seat-card:visible, [data-testid="turn-ribbon"]', '.game-shell');
        await assertMinFont(page, '.seat-card:visible', 12);
        for (let seat = 0; seat < 4; seat++) {
          await assertInside(
            page,
            `.seat-card:nth-child(${seat + 1}) .seat-details > *`,
            `.seat-card:nth-child(${seat + 1})`,
          );
          await assertNoEllipsis(page, `.seat-card:nth-child(${seat + 1})`);
        }
        if (process.env.AXE_SOURCE) {
          await page.addScriptTag({ path: process.env.AXE_SOURCE });
          const result = await page.evaluate(async () => {
            const axe = (
              window as unknown as {
                axe: {
                  run: (options: unknown) => Promise<{ violations: Array<{ impact: string }> }>;
                };
              }
            ).axe;
            return axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
          });
          await info.attach('takeover-axe', {
            body: JSON.stringify(result, null, 2),
            contentType: 'application/json',
          });
          const severe = result.violations.filter((issue) =>
            ['serious', 'critical'].includes(issue.impact),
          );
          console.log(`takeover axe ${name}: ${severe.length} serious/critical`);
          expect(severe).toEqual([]);
        }
      });

      // The real label projected through the live camera, not an authored Y
      // constant: camera zoom/resize/text-metric regressions must also fail.
      test('turn ribbon clears the rendered exchange label', async ({ page }, info) => {
        for (const size of [{ width: 1400, height: 800 }, viewport]) {
          await page.setViewportSize(size);
          const label = await renderedExchange(page);
          const ribbon = await domRect(page, '[data-testid="turn-ribbon"]');
          const area = overlap(label, ribbon);
          console.log(
            `Exchange ${name} at ${size.width}x${size.height}: ${JSON.stringify({ label, ribbon, overlap: area })}`,
          );
          await info.attach(`exchange-${size.width}x${size.height}`, {
            body: JSON.stringify({ label, ribbon, overlap: area }, null, 2),
            contentType: 'application/json',
          });
          expect(label.visible).toBe(true);
          expect(label.text.trim()).not.toBe('');
          expect.soft(area, 'turn ribbon intersects rendered exchange label').toBe(0);
          expect(label.left).toBeGreaterThanOrEqual(0);
          expect(label.top).toBeGreaterThanOrEqual(0);
          expect(label.right).toBeLessThanOrEqual(size.width);
          expect(label.bottom).toBeLessThanOrEqual(size.height);
          await expect(page.getByTestId('turn-ribbon')).toBeVisible();
          await assertInside(page, '[data-testid="turn-ribbon"]');
        }
      });
    });
  }
}
