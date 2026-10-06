import { createGame, data, legalActions, step, type GameState } from '@dice-bandits/engine';
import { expect, test, type Page } from '@playwright/test';
import { assertInside, assertMinFont, assertNoEllipsis } from './helpers';

function saved(): GameState {
  return createGame({
    seed: 'ux-18',
    rounds: 12,
    seats: [
      { name: 'A', classId: 'knight', control: 'human', personality: null },
      { name: 'B', classId: 'thief', control: 'human', personality: null },
      { name: 'C', classId: 'mage', control: 'human', personality: null },
      { name: 'D', classId: 'cleric', control: 'human', personality: null },
    ],
  });
}
function beforeShop() {
  const state = saved();
  const shop = state.board.spaces.find(
    (space) =>
      space.kind === 'shop' &&
      state.board.spaces.some((from) => from.next.length === 1 && from.next[0] === space.id),
  )!;
  state.players[0]!.pos = state.board.spaces.find(
    (from) => from.next.length === 1 && from.next[0] === shop.id,
  )!.id;
  state.players[0]!.forcedRoll = 1;
  state.players[0]!.gold = 5000;
  state.players[0]!.items = data.ITEMS.map((item) => item.id);
  return state;
}
async function start(page: Page, state: GameState, lang: 'th' | 'en', speed = 0) {
  await page.addInitScript(
    ({ state, lang }) => {
      localStorage.setItem('diceBandits.save', JSON.stringify({ version: 2, state }));
      localStorage.setItem('lang', lang);
      localStorage.setItem('dice-bandits:tips', JSON.stringify({ enabled: true, seen: [] }));
    },
    { state, lang },
  );
  await page.goto(`/?speed=${speed}`);
  await page.locator('[data-action="continue"]').click();
  await page.waitForFunction(() => window.__db?.art.boardReady);
  await page.evaluate(() => document.fonts.ready);
}
async function clearGeometry(page: Page) {
  await assertInside(page, '.dicey-tip, .game-dialog');
  for (const selector of ['.dicey-tip', '.game-dialog']) {
    if (await page.locator(selector).count()) await assertNoEllipsis(page, selector);
  }
  await assertMinFont(page, '.dicey-tip, .game-dialog', 12);
  const result = await page.evaluate(() => {
    const visible = (element: Element) => {
      const r = element.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const boxes = [
      ...document.querySelectorAll(
        '.game-topline, .seat-card, .action-tray, .dicey-tip, .game-dialog',
      ),
    ]
      .filter(visible)
      .map((element) => ({ name: element.className, rect: element.getBoundingClientRect() }));
    const overlaps = boxes.flatMap((a, i) =>
      boxes.slice(i + 1).flatMap((b) => {
        const area =
          Math.max(0, Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left)) *
          Math.max(0, Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top));
        return area ? [{ a: a.name, b: b.name, area }] : [];
      }),
    );
    const controls = [
      ...document.querySelectorAll('.dicey-ok, .game-dialog button, .action-tray button'),
    ]
      .filter(visible)
      .filter((element) => {
        const clip = element.closest('.phase-choices, .reward-dialog');
        if (!clip) return true;
        const r = element.getBoundingClientRect();
        const c = clip.getBoundingClientRect();
        return r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5;
      })
      .map((element) => {
        const r = element.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { width: r.width, height: r.height, hit: hit === element || element.contains(hit) };
      });
    const coverage =
      (boxes.reduce((sum, box) => sum + box.rect.width * box.rect.height, 0) /
        (innerWidth * innerHeight)) *
      100;
    return { overlaps, controls, coverage };
  });
  expect(result.overlaps).toEqual([]);
  for (const control of result.controls) {
    expect(control.width).toBeGreaterThanOrEqual(44);
    expect(control.height).toBeGreaterThanOrEqual(44);
    expect(control.hit).toBe(true);
  }
  return result;
}
for (const viewport of [
  { width: 915, height: 412 },
  { width: 932, height: 388 },
  { width: 1280, height: 720 },
]) {
  for (const lang of ['th', 'en'] as const) {
    test(`anchored truthful guide ${viewport.width} ${lang}`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await start(page, saved(), lang);
      await expect(page.locator('.dicey-pointer')).toBeVisible();
      await expect(page.locator('.dicey-text')).toHaveText(
        lang === 'th' ? 'แตะปุ่มทอยเต๋าเพื่อดูแต้มที่ได้' : 'Tap Roll to see your dice total.',
      );
      const geometry = await clearGeometry(page);
      if (viewport.width === 915) expect(geometry.coverage).toBeLessThanOrEqual(22);
      console.log(`U3 ordinary ${viewport.width} ${lang}: ${JSON.stringify(geometry)}`);
      await page.screenshot({ path: info.outputPath('A-start-tip.png') });
      for (const width of [viewport.width + 17, viewport.width]) {
        await page.setViewportSize({ ...viewport, width });
        await expect
          .poll(() =>
            page.evaluate(() => {
              const tip = document.querySelector<HTMLElement>('.dicey-tip')!;
              const roll = document
                .querySelector('[data-testid="action-roll"]')!
                .getBoundingClientRect();
              return Math.abs(
                parseFloat(tip.style.getPropertyValue('--dicey-cta-x')) -
                  (roll.left + roll.width / 2),
              );
            }),
          )
          .toBeLessThan(1);
        await clearGeometry(page);
      }
      const before = await page.evaluate(() => window.__db!.getState());
      await page.getByTestId('dicey-tip-ok').click();
      expect(await page.evaluate(() => window.__db!.getState())).toEqual(before);
      await page.getByTestId('action-roll').click();
      await expect(page.getByTestId('dicey-tip')).not.toHaveAttribute('data-topic', 'roll');
    });
    test(`single reachable modal choices ${viewport.width} ${lang}`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      const initial = saved();
      const shop = initial.board.spaces.find(
        (space) =>
          space.kind === 'shop' &&
          initial.board.spaces.some((from) => from.next.length === 1 && from.next[0] === space.id),
      )!;
      initial.players[0]!.pos = initial.board.spaces.find(
        (from) => from.next.length === 1 && from.next[0] === shop.id,
      )!.id;
      initial.players[0]!.forcedRoll = 1;
      initial.players[0]!.gold = 5000;
      initial.players[0]!.items = data.ITEMS.map((item) => item.id);
      await start(page, initial, lang);
      await page.getByTestId('action-roll').click();
      await expect(page.getByTestId('dicey-tip')).toHaveAttribute('data-topic', 'shop');
      await expect(page.locator('.action-tray')).toBeHidden();
      await expect(page.locator('.action-tray button')).toHaveCount(0);
      const state = await page.evaluate(() => window.__db!.getState());
      expect(state.phase.kind).toBe('shop');
      await expect(page.locator('[data-choice]')).toHaveCount(legalActions(state, 0).length);
      const choices = page.locator('.phase-choices button');
      await assertInside(page, '.phase-choices button:nth-child(-n+2)', '.phase-choices');
      await clearGeometry(page);
      await page.screenshot({ path: info.outputPath('D-shop-open.png') });
      const leave = page.getByTestId('shop-leave-leave');
      const pinned = await leave.boundingBox();
      for (let i = 0; i < (await choices.count()); i++) {
        await choices.nth(i).scrollIntoViewIfNeeded();
        await assertInside(page, `.phase-choices button:nth-child(${i + 1})`, '.phase-choices');
        expect(await leave.boundingBox()).toEqual(pinned);
        const hit = await choices.nth(i).evaluate((element) => {
          const r = element.getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === element;
        });
        expect(hit).toBe(true);
      }
      await choices.first().scrollIntoViewIfNeeded();
      // Offscreen rows are intentionally scrollable, not visible hit targets.
      await page.getByTestId('dicey-tip-ok').click();
      await leave.click();
      await expect(page.locator('.game-dialog')).toHaveCount(0);
      await expect(page.locator('.action-tray')).toBeVisible();
      await page.screenshot({ path: info.outputPath('E-restored-tray.png') });
      // Real HUD/controller phase fixtures, identical to existing continue tests.
      for (const kind of ['levelUp', 'pvpReward', 'townManage'] as const) {
        const fixture = saved();
        fixture.phase =
          kind === 'levelUp'
            ? {
                kind,
                seat: 0,
                choices: data.PERKS.slice(0, 6).map((perk) => perk.id),
                then: 'endTurn',
              }
            : kind === 'pvpReward'
              ? { kind, winner: 0, loser: 1 }
              : { kind, spaceId: fixture.towns[0]!.spaceId };
        if (kind === 'townManage') fixture.towns[0]!.owner = 0;
        await page.evaluate(
          (state) =>
            document
              .getElementById('app')!
              .dispatchEvent(new CustomEvent('dice-bandits:continue', { detail: state })),
          fixture,
        );
        const modal = kind !== 'townManage';
        await expect(page.locator('.game-dialog')).toHaveCount(modal ? 1 : 0);
        if (modal) await expect(page.locator('.action-tray')).toBeHidden();
        else await expect(page.locator('.action-tray')).toBeVisible();
        const actions = legalActions(fixture, 0);
        await expect(page.locator(modal ? '[data-choice]' : '[data-action-index]')).toHaveCount(
          actions.length,
        );
        if (modal) await expect(page.locator('.action-tray button')).toHaveCount(0);
        const choice = page.locator(modal ? '[data-choice]' : '[data-action-index]').first();
        const expected = step(fixture, actions[0]!).state;
        await choice.click();
        await expect.poll(() => page.evaluate(() => window.__db!.getState())).toEqual(expected);
      }
    });
    test(`A–E evidence and artwork fallback ${viewport.width} ${lang}`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      let release: () => void = () => {};
      const loading = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/art/tutor/dicey.webp', async (route) => {
        await loading;
        await route.abort();
      });
      const initial = beforeShop();
      initial.players[0]!.items = [];
      await start(page, initial, lang, 1);
      await expect(page.getByTestId('dicey-tip-ok')).toBeVisible();
      await expect(page.locator('.dicey-portrait')).toBeHidden();
      await page.screenshot({ path: info.outputPath('loading-text-only.png') });
      release();
      await clearGeometry(page);
      await page.screenshot({ path: info.outputPath('error-text-only.png') });
      await page.unroute('**/art/tutor/dicey.webp');
      await page.reload();
      await page.locator('[data-action="continue"]').click();
      await expect(page.locator('.dicey-portrait')).toBeVisible();
      await page.screenshot({ path: info.outputPath('A-start-tip.png') });
      await page.getByTestId('action-roll').click();
      await expect(page.getByTestId('dice-roll')).toHaveAttribute('data-stage', 'rolling');
      await page.screenshot({ path: info.outputPath('B-rolling.png') });
      await expect(page.getByTestId('dice-roll')).toHaveAttribute('data-stage', 'result');
      await page.screenshot({ path: info.outputPath('C-result.png') });
      await expect(page.locator('.phase-dialog')).toBeVisible();
      await clearGeometry(page);
      await page.screenshot({ path: info.outputPath('D-shop-open.png') });
      if (process.env.AXE_SOURCE) {
        await page.addScriptTag({ path: process.env.AXE_SOURCE });
        const report = await page.evaluate(async () =>
          (
            window as unknown as {
              axe: {
                run: (
                  root: Document,
                  options: unknown,
                ) => Promise<{ violations: { id: string; impact: string }[] }>;
              };
            }
          ).axe.run(document, {
            runOnly: {
              type: 'tag',
              values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
            },
          }),
        );
        await info.attach('axe-shop', {
          body: JSON.stringify(report),
          contentType: 'application/json',
        });
        expect(
          report.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact)),
        ).toEqual([]);
        console.log(`U3 axe shop ${viewport.width} ${lang}: 0 serious/critical`);
      }
      await page.getByTestId('dicey-tip-ok').click();
      await page.getByTestId('shop-leave-leave').click();
      // Resume mode has no private-card pass screen for a board-only turn.
      await expect(page.getByTestId('action-roll')).toBeVisible();
      await expect(page.getByTestId('dicey-tip')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('E-normal-turn.png') });
      if (process.env.AXE_SOURCE) {
        const report = await page.evaluate(async () =>
          (
            window as unknown as {
              axe: {
                run: (
                  root: Document,
                  options: unknown,
                ) => Promise<{ violations: { impact: string }[] }>;
              };
            }
          ).axe.run(document, {
            runOnly: {
              type: 'tag',
              values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
            },
          }),
        );
        await info.attach('axe-empty-guide', {
          body: JSON.stringify(report),
          contentType: 'application/json',
        });
        expect(
          report.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact)),
        ).toEqual([]);
        console.log(`U3 axe ordinary ${viewport.width} ${lang}: 0 serious/critical`);
      }
    });
  }
}
