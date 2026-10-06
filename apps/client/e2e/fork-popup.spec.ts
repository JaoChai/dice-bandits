import { createGame, type GameState } from '@dice-bandits/engine';
import { expect, test, type Page } from '@playwright/test';
import { observeBoardGame, renderedBoardGeometry } from './helpers';

function savedFork(): GameState {
  const state = createGame({
    seed: 'rf3-fork-19',
    rounds: 12,
    seats: [
      { name: 'Ada', classId: 'knight', control: 'human', personality: null },
      { name: 'Lin', classId: 'thief', control: 'human', personality: null },
    ],
  });
  state.players[0]!.pos = 19;
  state.phase = { kind: 'chooseBranch', remaining: 1, options: [20, 37] };
  return state;
}

async function continueSave(page: Page, state: GameState): Promise<void> {
  await observeBoardGame(page);
  await page.addInitScript((saved) => {
    localStorage.setItem('diceBandits.save', JSON.stringify({ version: 2, state: saved }));
    localStorage.setItem('diceBandits.lang', 'en');
  }, state);
  await page.goto('/?speed=0&seed=rf3-fork-19');
  await page.locator('[data-action="continue"]').click();
  await expect(page.locator('[data-testid="screen-board"] canvas')).toBeVisible();
  // Canvas mounts before Boot finishes loading art; use the same scene-ready
  // wait as renderer.spec.ts rather than the shorter DOM assertion poll.
  await page.waitForFunction(() => window.__db?.art.boardReady);
  await expect.poll(() => page.evaluate(() => window.__db?.getState().players[0]?.pos)).toBe(19);
}

async function tapCurrentSpace(page: Page): Promise<void> {
  const canvas = await page.locator('canvas').boundingBox();
  expect(canvas).not.toBeNull();
  // The active space is centred in the inset gameplay camera, not the canvas.
  // Project its REAL rendered tile through that camera and the canvas CSS scale.
  const space = await page.evaluate(() => {
    const state = window.__db!.getState();
    return state.board.spaces.find(
      (candidate) => candidate.id === state.players[state.turnSeat]!.pos,
    )!;
  });
  const geometry = await renderedBoardGeometry(page);
  const tile = geometry.tiles.find(
    (image) => image.world.x === space.x && image.world.y === space.y,
  );
  expect(tile, 'active space has a rendered tile').toBeDefined();
  expect(tile!.visible).toBe(true);
  console.log('real fork tap', JSON.stringify({ space: space.id, point: tile!.centre }));
  // No force, test dispatch or DOM click: exercise the shipped Phaser hit-test.
  await page.mouse.click(tile!.centre.x, tile!.centre.y);
  await expect(page.locator('[data-testid="space-info"]')).toBeVisible();
}

test('RF3: saved fork 19 stays clickable while space info is open', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await continueSave(page, savedFork());
  await tapCurrentSpace(page);
  const arrow = page.locator('[data-testid="fork-arrow-37"]');
  // No force, programmatic DOM click, or test-hook dispatch: hit-testing must work.
  await arrow.click({ timeout: 5_000 });
  await expect.poll(() => page.evaluate(() => window.__db!.getState().players[0]!.pos)).toBe(37);
  await expect(page.locator('[data-testid^="fork-arrow-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="space-info"]')).toHaveCount(0);
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
  expect(errors).toEqual([]);
});

test('rolling from fork 19 draws and positions branch controls without scrolling', async ({
  page,
}) => {
  const state = savedFork();
  state.phase = { kind: 'awaitRoll' };
  await continueSave(page, state);
  await page.locator('[data-testid="action-roll"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__db!.getState().phase.kind))
    .toBe('chooseBranch');
  const arrows = page.locator('[data-testid^="fork-arrow-"]');
  await expect(arrows).toHaveCount(2);
  const canvas = (await page.locator('canvas').boundingBox())!;
  const boxes = await arrows.evaluateAll((markers) =>
    markers.map((marker) => {
      const rect = marker.getBoundingClientRect();
      const style = getComputedStyle(marker);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        position: style.position,
      };
    }),
  );
  for (const box of boxes) {
    expect(box.position).toBe('fixed');
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(canvas.x);
    expect(box.y).toBeGreaterThanOrEqual(canvas.y);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  }
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
});

test('exiting a fork removes popup and branch controls before returning to title', async ({
  page,
}) => {
  await continueSave(page, savedFork());
  await tapCurrentSpace(page);
  await expect(page.locator('[data-testid^="fork-arrow-"]')).toHaveCount(2);
  await page.keyboard.press('Escape'); // close the space-info popup first
  await expect(page.locator('[data-testid="space-info"]')).toHaveCount(0);
  await page.locator('[data-testid="menu-button"]').click();
  await page.locator('.menu-panel [data-action="exit"]').click();
  await expect(page.locator('[data-testid="screen-title"]')).toBeVisible();
  await expect(page.locator('[data-testid="space-info"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="fork-arrow-"]')).toHaveCount(0);
});
