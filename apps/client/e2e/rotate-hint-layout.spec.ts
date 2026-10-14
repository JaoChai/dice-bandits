import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createGame, startBattle } from '@dice-bandits/engine';
import { join } from 'node:path';
import { startJourney, waitForBattleArt } from './helpers';

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
