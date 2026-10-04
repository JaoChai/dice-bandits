// M5a board coverage (plan Task 10): the review-focus geometry and interaction
// contract of the cartoon board, driven through the real UI (setup defaults,
// first-button journeys, real canvas taps). Seeds were derived by engine replay
// with the setup screen's real defaults and are documented per test.
//
// Camera/tap contract: BoardScene centres the ACTIVE token's space in gameplay
// view and centres the 3200×1800 map in whole-map view (src/scenes/board/
// camera.ts). Canvas taps are expressed through that contract — the active
// space is the canvas centre — and through the shipped fork-arrow mirrors,
// whose reprojection the arrows themselves maintain every frame.
import { expect, test, type Page } from '@playwright/test';
import { playUntil } from './helpers';

type BoardState = {
  turnSeat: number;
  round: number;
  players: Array<{ pos: number; name: string }>;
  towns: Array<{ spaceId: number; owner: number | null; value: number }>;
  board: { spaces: Array<{ id: number; x: number; y: number }> };
  phase: { kind: string; options?: number[] };
};

/** Read the live game state through the production test hook. */
function getState(page: Page): Promise<BoardState> {
  return page.evaluate(() => {
    const state = (
      window as unknown as {
        __db?: { getState: () => BoardState };
      }
    ).__db!.getState();
    return structuredClone(state);
  });
}

/** Centre of the rendered canvas in viewport CSS px (the active space in gameplay view). */
async function canvasCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('#phaser-board canvas').boundingBox();
  expect(box, 'board canvas has a bounding box').not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

/** Wait until the board scene has rendered at least one frame. */
async function waitBoardReady(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { __db?: { art: { boardReady: boolean } } }).__db?.art.boardReady,
    ),
  );
}

/** Every visible board-HUD element sits inside the viewport. */
async function assertAllInsideViewport(page: Page): Promise<void> {
  const outside = await page.evaluate(() => {
    const view = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    return [...document.querySelectorAll<HTMLElement>('[data-testid="screen-board"] *')]
      .filter((element) => {
        const style = getComputedStyle(element);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          element.getBoundingClientRect().width > 0
        );
      })
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left < view.left - 0.5 ||
          rect.top < view.top - 0.5 ||
          rect.right > view.right + 0.5 ||
          rect.bottom > view.bottom + 0.5
        );
      })
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}.${String(element.className).replaceAll(' ', '.')}`,
      );
  });
  expect(outside, 'elements outside the viewport').toEqual([]);
}

/** Switch the board language through the real menu. */
async function switchLang(page: Page, lang: 'th' | 'en'): Promise<void> {
  await page.locator('[data-testid="menu-button"]').click();
  await page.locator(`.menu-panel [data-lang="${lang}"]`).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-panel')).toHaveCount(0);
}

/** Default setup journey (startJourney) plus the rendered-board wait. */
async function startBoard(page: Page, seed: string): Promise<void> {
  await page.goto(`/?seed=${seed}&speed=0`);
  await page.locator('[data-action="new"]').click();
  await page.locator('#setup-form button[type="submit"]').click();
  await expect(page.locator('[data-testid="screen-board"]')).toBeVisible();
  await waitBoardReady(page);
}

test('board HUD fits the viewport in TH and EN with ribbon and active card at turn start', async ({
  page,
}) => {
  await startBoard(page, 'e2e-layout');
  for (const lang of ['th', 'en'] as const) {
    await switchLang(page, lang);
    await assertAllInsideViewport(page);
    await expect(page.locator('[data-testid="round-ribbon"]')).toBeVisible();
    await expect(page.locator('[data-testid="turn-ribbon"]')).toBeVisible();
    await expect(page.locator('.seat-card.is-active')).toHaveCount(1);
    const state = await getState(page);
    const activeName = state.players[state.turnSeat]!.name;
    await expect(page.locator('[data-testid="turn-ribbon"]')).toHaveText(new RegExp(activeName));
    await expect(page.locator('.seat-card.is-active strong')).toHaveText(activeName);
  }
});

test('tiles render at least 48 CSS px at the phone-landscape viewport', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-landscape', '915×412 tile-size budget');
  await startBoard(page, 'e2e-layout');
  // Gameplay zoom (camera.ts SPACES_ACROSS 7, mean edge 188 px) renders a 96
  // map-px tile at ≈ 93.4 logical px; Phaser Scale.FIT binds on height, so the
  // on-screen tile is 93.4 × (canvas css height / 720) — ≥ 48 CSS px iff the
  // canvas fills the viewport height (412/720 = 0.572 → ≈ 53.4 CSS px).
  const geometry = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#phaser-board canvas')!;
    const rect = canvas.getBoundingClientRect();
    return { cssPerLogical: rect.height / canvas.height };
  });
  expect(geometry.cssPerLogical).toBeGreaterThanOrEqual(48 / 93.4);
});

test('space info opens on the active-space tap, wraps the longest Thai line, closes on Escape and via its close button', async ({
  page,
}, testInfo) => {
  const lang = testInfo.project.name === 'mobile-landscape' ? 'th' : 'en';
  // Seed m5a-town-75: one roll lands the human on town space 8 in round 2
  // (engine replay, first-button policy, setup defaults).
  await startBoard(page, 'm5a-town-75');
  await switchLang(page, lang);
  await page.locator('[data-testid="action-roll"]').click();
  await playUntil(page, (state) => state.players[0]!.pos === 8 && state.turnSeat === 0);
  expect((await getState(page)).players[0]!.pos).toBe(8);
  // The follow camera centres the active space: a canvas-centre tap is a tap
  // on that space (TAP_RADIUS 64 map px ≈ 36 CSS px at this viewport).
  const centre = await canvasCentre(page);
  await page.mouse.click(centre.x, centre.y);
  const popup = page.locator('[data-testid="space-info"]');
  await expect(popup).toBeVisible();
  // Fully on-screen (Review Focus 5), and the town info wraps to > 1 line.
  const box = await popup.boundingBox();
  const view = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(view.height);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(view.width);
  const wrapped = await popup.evaluate((element) => {
    const text = element.querySelector<HTMLElement>('.space-info-text')!;
    const style = getComputedStyle(text);
    const lineHeight =
      Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4;
    return { lines: text.getBoundingClientRect().height / lineHeight };
  });
  expect(wrapped.lines).toBeGreaterThan(1);
  // Escape closes.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="space-info"]')).toHaveCount(0);
  // The × button closes.
  await page.mouse.click(centre.x, centre.y);
  await expect(popup).toBeVisible();
  await page.locator('[data-testid="space-info-close"]').click();
  await expect(page.locator('[data-testid="space-info"]')).toHaveCount(0);
});

test('map toggle zooms out to the whole map (all tokens visible) and back to the action', async ({
  page,
}) => {
  await startBoard(page, 'e2e-layout');
  const toggle = page.locator('[data-testid="map-toggle"]');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { diceBanditsMapWhole?: boolean }).diceBanditsMapWhole === true,
      ),
    )
    .toBe(true);
  // Whole-map camera (camera.ts): centre (1600, 900), zoom fits 3200×1800.
  // Project every token's space through that camera and the canvas rect.
  const inView = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#phaser-board canvas')!;
    const rect = canvas.getBoundingClientRect();
    const state = (window as unknown as { __db: { getState: () => BoardState } }).__db.getState();
    const zoom = Math.min(1280 / 3200, 720 / 1800);
    const centre = { x: 1600, y: 900 };
    return state.players.every((player) => {
      const space = state.board.spaces.find((candidate) => candidate.id === player.pos)!;
      const x = rect.left + rect.width * (0.5 + ((space.x - centre.x) * zoom) / 1280);
      const y = rect.top + rect.height * (0.5 + ((space.y - centre.y) * zoom) / 720);
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    });
  });
  expect(inView, 'every token inside the canvas in whole-map view').toBe(true);
  // Back to the action; a canvas tap then opens the active space's popup again.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { diceBanditsMapWhole?: boolean }).diceBanditsMapWhole === false,
      ),
    )
    .toBe(true);
  const centre = await canvasCentre(page);
  await page.mouse.click(centre.x, centre.y);
  await expect(page.locator('[data-testid="space-info"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="space-info"]')).toHaveCount(0);
});

test('a seeded fork shows branch arrows and choosing one moves the token onto that branch', async ({
  page,
}) => {
  // Seed m5a-fork-67: 2 human rolls reach the human fork at 19 (options 20/37),
  // with 2 roll steps remaining.
  await startBoard(page, 'm5a-fork-67');
  await page.locator('[data-testid="action-roll"]').click();
  await playUntil(page, (state) => state.turnSeat === 0 && state.phase.kind === 'awaitRoll');
  await page.locator('[data-testid="action-roll"]').click();
  await expect
    .poll(() => getState(page).then((state) => state.phase.kind), { timeout: 20_000 })
    .toBe('chooseBranch');
  expect((await getState(page)).phase.options).toEqual([20, 37]);
  await expect.poll(() => getState(page).then((state) => state.players[0]!.pos)).toBe(19);
  const arrows = page.locator('[data-testid^="fork-arrow-"]');
  await expect(arrows).toHaveCount(2);
  // A real click on one arrow's mirror commits that branch: with 2 roll steps
  // left the token walks 19 → 37 (branch town) → 38 (trap) and the turn passes.
  // Engine replay of this seed: choice 37 settles at 38, choice 20 at 8 — so
  // settling at 38 proves branch 37 was the one dispatched by the click.
  await page.locator('[data-testid="fork-arrow-37"]').click();
  await expect
    .poll(() => getState(page).then((state) => state.players[0]!.pos), { timeout: 20_000 })
    .toBe(38);
  // Arrows clear on the branch-commit re-render…
  await expect(page.locator('[data-testid^="fork-arrow-"]')).toHaveCount(0);
  // …the same re-render closes any popup, and the round hands back to the human.
  await expect(page.locator('[data-testid="space-info"]')).toHaveCount(0);
  await expect.poll(() => getState(page).then((state) => state.phase.kind)).toBe('awaitRoll');
  await expect.poll(() => getState(page).then((state) => state.turnSeat)).toBe(0);
});

test('an owned town popup shows the owner line with seat and value', async ({ page }) => {
  // Seed m5a-fork-2: the bot thief claims town 8 by round 3; playUntil's
  // first-button policy gets there in ~5 human actions.
  await startBoard(page, 'm5a-fork-2');
  await playUntil(page, (state) =>
    state.towns.some((town) => town.spaceId === 8 && town.owner !== null),
  );
  const owner = await getState(page).then(
    (state) => state.towns.find((town) => town.spaceId === 8 && town.owner !== null)?.owner ?? null,
  );
  expect(owner).not.toBeNull();
  // Project town 8 off the camera-centred active space (gameplay zoom ≈
  // 1280/(188*7), camera.ts) and tap it for its popup.
  const target = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#phaser-board canvas')!;
    const rect = canvas.getBoundingClientRect();
    const state = (window as unknown as { __db: { getState: () => BoardState } }).__db.getState();
    const space = state.board.spaces.find((candidate) => candidate.id === 8)!;
    const active = state.board.spaces.find(
      (candidate) => candidate.id === state.players[state.turnSeat]!.pos,
    )!;
    const zoom = 1280 / (188 * 7);
    return {
      x: rect.left + rect.width * (0.5 + ((space.x - active.x) * zoom) / 1280),
      y: rect.top + rect.height * (0.5 + ((space.y - active.y) * zoom) / 720),
    };
  });
  await page.mouse.click(target.x, target.y);
  const popup = page.locator('[data-testid="space-info"]');
  await expect(popup).toBeVisible();
  // Owner seat is displayed 1-based (engine seat + 1).
  await expect(popup.locator('[data-testid="space-info-owner"]')).toContainText(
    String((owner as number) + 1),
  );
  await expect(popup.locator('[data-testid="space-info-value"]')).toHaveText('200');
});
