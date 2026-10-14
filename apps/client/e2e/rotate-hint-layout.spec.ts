import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createGame, startBattle } from '@dice-bandits/engine';
import { join } from 'node:path';
import type Phaser from 'phaser';
import { observeBoardGame, startJourney, waitForBattleArt } from './helpers';

const viewports = [
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 360, height: 780 },
];

async function measure(page: Page, selectors: string) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate((selectors) => {
    const hint = document.querySelector<HTMLElement>('[data-testid="rotate-hint"]')!;
    const a = hint.getBoundingClientRect();
    const targets = [...document.querySelectorAll<HTMLElement>(selectors)].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden';
    });
    return {
      hint: a.toJSON(),
      font: parseFloat(getComputedStyle(hint).fontSize),
      text: hint.textContent,
      targets: targets.map((element) => {
        const b = element.getBoundingClientRect();
        return {
          name: element.dataset.testid ?? element.className,
          rect: b.toJSON(),
          intersection:
            Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
        };
      }),
    };
  }, selectors);
}

async function assertClear(page: Page, selectors: string, label: string, info: TestInfo) {
  await expect(page.getByTestId('rotate-hint')).toBeVisible();
  const geometry = await measure(page, selectors);
  console.log(`rotate geometry ${label}: ${JSON.stringify(geometry)}`);
  await info.attach(label, {
    body: JSON.stringify(geometry, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath(`${label}.png`) });
  if (process.env.ROTATE_EVIDENCE_DIR) {
    await page.screenshot({
      path: join(process.env.ROTATE_EVIDENCE_DIR, `${info.project.name}-${label}.png`),
    });
  }
  expect(geometry.targets.length).toBeGreaterThan(0);
  expect(geometry.text?.trim()).toBeTruthy();
  expect(geometry.font).toBeGreaterThanOrEqual(14);
  expect(geometry.hint.left).toBeGreaterThanOrEqual(0);
  expect(geometry.hint.right).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(geometry.hint.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
  for (const target of geometry.targets) {
    expect.soft(target.intersection, `${label}: hint / ${target.name}`).toBe(0);
    expect.soft(target.rect.top, `${label}: ${target.name} top`).toBeGreaterThanOrEqual(0);
    expect
      .soft(target.rect.bottom, `${label}: ${target.name} bottom`)
      .toBeLessThanOrEqual(page.viewportSize()!.height);
  }
}

// Moving the portrait tray into either fighter or the turn ring must fail.
// Like town-guardian/battle-hud, project live bounds through the rendered
// camera. Graphics has no getBounds: rasterise the ring's actual commands,
// including its stroke, rather than duplicating production ellipse metrics.
async function assertFightersClear(page: Page, label: string, info: TestInfo) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as Window & { __m5aGame: Phaser.Game }).__m5aGame.scene.getScene(
            'BattleScene',
          ).cameras.main.zoom,
      ),
    )
    .toBeCloseTo(1.12, 5);
  const geometry = await page.evaluate(async () => {
    const game = (window as unknown as Window & { __m5aGame: Phaser.Game }).__m5aGame;
    await new Promise<void>((resolve) => game.events.once('postrender', resolve));
    const scene = game.scene.getScene('BattleScene');
    const canvas = game.canvas.getBoundingClientRect();
    const matrix = scene.cameras.main.getViewMatrix();
    const project = (left: number, top: number, right: number, bottom: number) => {
      const tl = matrix.transformPoint(left, top);
      const br = matrix.transformPoint(right, bottom);
      return {
        left: canvas.left + (tl.x / game.canvas.width) * canvas.width,
        top: canvas.top + (tl.y / game.canvas.height) * canvas.height,
        right: canvas.left + (br.x / game.canvas.width) * canvas.width,
        bottom: canvas.top + (br.y / game.canvas.height) * canvas.height,
      };
    };
    const fighters = scene.children.getChildren().filter((child) => child.type === 'Sprite');
    const objects = fighters.map((child, side) => {
      const sprite = child as Phaser.GameObjects.Sprite;
      const bounds = sprite.getBounds();
      return {
        name: `fighter-${side}`,
        rect: project(bounds.left, bounds.top, bounds.right, bounds.bottom),
      };
    });
    const ring = scene.children.getByName('battle-picker-ring') as Phaser.GameObjects.Graphics;
    const surface = document.createElement('canvas');
    surface.width = Math.ceil(scene.cameras.main.width);
    surface.height = Math.ceil(scene.cameras.main.height);
    ring.generateTexture(surface, surface.width, surface.height);
    const pixels = surface
      .getContext('2d', { willReadFrequently: true })!
      .getImageData(0, 0, surface.width, surface.height).data;
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (let y = 0; y < surface.height; y++) {
      for (let x = 0; x < surface.width; x++) {
        if (!pixels[(y * surface.width + x) * 4 + 3]) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }
    objects.push({
      name: 'picker-ring',
      rect: project(left + ring.x, top + ring.y, right + ring.x, bottom + ring.y),
    });
    const tray = document.querySelector('.action-tray')!.getBoundingClientRect();
    return {
      tray: tray.toJSON(),
      objects: objects.map((object) => ({
        ...object,
        intersection:
          Math.max(
            0,
            Math.min(object.rect.right, tray.right) - Math.max(object.rect.left, tray.left),
          ) *
          Math.max(
            0,
            Math.min(object.rect.bottom, tray.bottom) - Math.max(object.rect.top, tray.top),
          ),
      })),
      cards: [...document.querySelectorAll('.command-card')].map((card) => {
        const { width, height } = card.getBoundingClientRect();
        return { width, height };
      }),
    };
  });
  console.log(`fighter geometry ${label}: ${JSON.stringify(geometry)}`);
  await info.attach(`fighters-${label}`, {
    body: JSON.stringify(geometry, null, 2),
    contentType: 'application/json',
  });
  expect(geometry.objects).toHaveLength(3);
  for (const object of geometry.objects) {
    expect(object.rect.right).toBeGreaterThan(object.rect.left);
    expect(object.rect.bottom).toBeGreaterThan(object.rect.top);
    expect.soft(object.intersection, `${label}: tray / ${object.name}`).toBe(0);
  }
  for (const card of geometry.cards) {
    expect(card.height).toBeGreaterThanOrEqual(88);
    // The face-down card must not squeeze the three commands into slivers.
    expect(card.width).toBeGreaterThanOrEqual(88);
  }
}

for (const viewport of viewports) {
  for (const lang of ['th', 'en'] as const) {
    const label = `${viewport.width}x${viewport.height}-${lang}`;
    test.describe(label, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
      });

      test(`board controls and bottom prompt clear the rotate hint ${label}`, async ({
        page,
      }, info) => {
        await startJourney(page);
        await expect(page.getByTestId('action-roll')).toBeVisible();
        await assertClear(
          page,
          '.game-shell button, .action-tray, .action-tray span, .online-status > *',
          `board-${label}`,
          info,
        );
        // Also cover the disabled controls during a real pending roll, not only
        // the idle tray. The same lane carries the bot/awaiting prompt text.
        await page.evaluate(() => {
          window.diceBanditsSpeed = 1;
        });
        await page.getByTestId('action-roll').click();
        await expect(page.getByTestId('dice-roll')).toBeVisible();
        await assertClear(
          page,
          '.game-shell button, .action-tray, .action-tray span, .dice-roll-label',
          `board-rolling-${label}`,
          info,
        );
        const botState = createGame({
          seed: 'rotate-hint-bot-prompt',
          rounds: 12,
          seats: [
            { name: 'Ada', classId: 'knight', control: 'bot', personality: 'greedy' },
            { name: 'Ben', classId: 'cleric', control: 'human', personality: null },
          ],
        });
        // A long real bot action delay holds the genuine waiting prompt in
        // place while measuring it; no DOM replacement or controller mock.
        await page.goto('/?speed=100');
        await page.evaluate(
          (state) =>
            document
              .querySelector('#app')!
              .dispatchEvent(new CustomEvent('dice-bandits:continue', { detail: state })),
          botState,
        );
        await expect(page.locator('.action-tray > span')).toBeVisible();
        await assertClear(
          page,
          '.game-shell button, .action-tray, .action-tray > span',
          `board-prompt-${label}`,
          info,
        );
      });

      test(`human battle cards and descriptions clear the rotate hint ${label}`, async ({
        page,
      }, info) => {
        const state = createGame({
          seed: 'rotate-hint-layout',
          rounds: 12,
          seats: [
            { name: 'Ada', classId: 'knight', control: 'human', personality: null },
            { name: 'Ben', classId: 'cleric', control: 'human', personality: null },
          ],
        });
        const rival = state.players[1]!;
        const battle = startBattle(state, {
          context: 'pvp',
          spaceId: state.players[0]!.pos,
          opponent: {
            kind: 'player',
            seat: 1,
            monsterId: null,
            level: 1,
            hp: rival.hp,
            stats: rival.stats,
            secretUsed: false,
            buffs: { ironSkin: false, poison: false, halveNext: false },
          },
        }).state;
        await observeBoardGame(page);
        await page.goto('/?speed=0');
        await page.evaluate(
          (state) =>
            document
              .querySelector('#app')!
              .dispatchEvent(new CustomEvent('dice-bandits:continue', { detail: state })),
          battle,
        );
        await waitForBattleArt(page);
        for (const role of ['attack', 'defense'] as const) {
          await page.getByTestId('pass-ready').click();
          // Fresh fighters offer two normal picks plus their unused Secret.
          await expect(page.locator('.command-card')).toHaveCount(3);
          await expect(page.locator('.card-description')).toHaveCount(3);
          await assertFightersClear(page, `battle-${role}-${label}`, info);
          await assertClear(
            page,
            '.action-tray, .command-card, .card-description',
            `battle-${role}-${label}`,
            info,
          );
          await page.getByTestId(role === 'attack' ? 'pick-attack' : 'pick-defend').click();
        }
      });
    });
  }
}
