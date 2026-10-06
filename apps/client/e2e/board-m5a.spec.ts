// M5a Task 10: real UI journeys and live Phaser display-object/camera geometry.
// Mutation switches change the rendered objects, not assertion inputs.
import type Phaser from 'phaser';
import { createGame, type GameState } from '@dice-bandits/engine';
import { expect, test, type Page } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };
import th from '../src/i18n/th.json' with { type: 'json' };
import {
  assertInside,
  assertNoEllipsis,
  mutateBoardForCoverage,
  observeBoardGame,
  playUntil,
  renderedBoardGeometry,
  renderedOwnedFlags,
} from './helpers';

type Lang = 'th' | 'en';
const texts = { th, en };
const popupSelector = '[data-testid="space-info"]';

test.beforeEach(async ({ page }) => {
  await observeBoardGame(page);
});

async function getState(page: Page): Promise<GameState> {
  return page.evaluate(() => structuredClone(window.__db!.getState()));
}

async function waitBoardReady(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="screen-board"]')).toBeVisible();
  await page.waitForFunction(() => window.__db?.art.boardReady);
}

/** Setup journey; select each locale explicitly, independent of saved defaults. */
async function startBoard(page: Page, seed: string, lang: Lang): Promise<void> {
  await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
  await page.goto(`/?seed=${seed}&speed=0`);
  await page.locator('[data-action="new"]').click();
  await page.locator('#setup-form button[type="submit"]').click();
  await waitBoardReady(page);
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
}

async function tapTile(page: Page, kind: string, spaceId?: number): Promise<void> {
  const space =
    spaceId === undefined
      ? undefined
      : (await getState(page)).board.spaces.find((candidate) => candidate.id === spaceId);
  const geometry = await renderedBoardGeometry(page);
  const tile = geometry.tiles.find(
    (candidate) =>
      candidate.frame === kind &&
      (!space || (candidate.world.x === space.x && candidate.world.y === space.y)) &&
      candidate.visible &&
      candidate.left >= geometry.canvas.left &&
      candidate.right <= geometry.canvas.right &&
      candidate.top >= geometry.canvas.top &&
      candidate.bottom <= geometry.canvas.bottom,
  );
  expect(tile, `rendered ${kind} tile in viewport`).toBeDefined();
  await page.mouse.click(tile!.centre.x, tile!.centre.y);
}

async function popupFits(page: Page, lang: Lang): Promise<void> {
  const popup = page.locator(popupSelector);
  await expect(popup).toBeVisible();
  await expect(popup.locator('.space-info-text')).toHaveText(texts[lang]['space.town.info']);
  await expect(popup).toHaveAttribute('aria-label', texts[lang]['space.town.name']);
  await assertInside(page, popupSelector);
  await assertInside(page, `${popupSelector} *`, popupSelector);
  await assertNoEllipsis(page, popupSelector);
  const overflow = await popup.evaluate((element) =>
    [element, ...element.querySelectorAll<HTMLElement>('*')]
      .filter((child) => child.clientHeight > 0 && child.scrollHeight > child.clientHeight + 1)
      .map((child) => child.className),
  );
  expect(overflow, 'popup children vertically clipped').toEqual([]);
}

function separatedSave(): GameState {
  const state = createGame({
    seed: 'm5a-separated-tokens',
    rounds: 12,
    seats: (['knight', 'thief', 'mage', 'cleric'] as const).map((classId, seat) => ({
      name: `P${seat + 1}`,
      classId,
      control: 'human' as const,
      personality: null,
    })),
  });
  // Legal extremes: north 21/20, south 12 and west/start 0 (review round 1).
  [21, 20, 12, 0].forEach((pos, seat) => {
    state.players[seat]!.pos = pos;
  });
  // Every generated town owns a real flag, not a fabricated graphics fixture.
  state.towns.forEach((town, index) => {
    town.owner = index % 4;
  });
  return state;
}

async function continueSave(page: Page, lang: Lang): Promise<void> {
  await page.addInitScript(
    ({ state, locale }) => {
      localStorage.setItem('diceBandits.save', JSON.stringify({ version: 2, state }));
      localStorage.setItem('lang', locale);
    },
    { state: separatedSave(), locale: lang },
  );
  await page.goto('/?speed=0&seed=m5a-separated-tokens');
  await page.locator('[data-action="continue"]').click();
  await waitBoardReady(page);
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
}

type Geometry = Awaited<ReturnType<typeof renderedBoardGeometry>>;
async function renderedPlayfield(page: Page) {
  return page.evaluate(() => {
    const game = (window as Window & { __m5aGame: Phaser.Game }).__m5aGame;
    const camera = game.scene.getScene('BoardScene').cameras.main;
    const rect = game.canvas.getBoundingClientRect();
    return {
      left: rect.left + (camera.x * rect.width) / game.canvas.width,
      right: rect.left + ((camera.x + camera.width) * rect.width) / game.canvas.width,
      top: rect.top + (camera.y * rect.height) / game.canvas.height,
      bottom: rect.top + ((camera.y + camera.height) * rect.height) / game.canvas.height,
    };
  });
}

function fitsCanvas(
  token: Pick<Geometry['tokens'][number], 'visible' | 'left' | 'right' | 'top' | 'bottom'>,
  canvas: Pick<Geometry['canvas'], 'left' | 'right' | 'top' | 'bottom'>,
): boolean {
  return (
    token.visible &&
    token.left >= canvas.left &&
    token.right <= canvas.right &&
    token.top >= canvas.top &&
    token.bottom <= canvas.bottom
  );
}

for (const lang of ['th', 'en'] as const) {
  test(`board HUD stays inside viewport and panels with ribbon and active card (${lang})`, async ({
    page,
  }) => {
    await startBoard(page, 'e2e-layout', lang);
    await assertInside(page, '[data-testid="screen-board"] *:visible');
    const panelOverflow = await page
      .locator('.seat-card, .game-topline, .action-tray, .turn-ribbon')
      .evaluateAll((panels) =>
        panels.flatMap((panel) => {
          const boundary = panel.getBoundingClientRect();
          return [...panel.querySelectorAll<HTMLElement>('*')]
            .filter((child) => {
              const rect = child.getBoundingClientRect();
              const style = getComputedStyle(child);
              return (
                rect.width > 0 &&
                style.visibility !== 'hidden' &&
                (rect.left < boundary.left - 0.5 ||
                  rect.top < boundary.top - 0.5 ||
                  rect.right > boundary.right + 0.5 ||
                  rect.bottom > boundary.bottom + 0.5 ||
                  (child.clientWidth > 0 && child.scrollWidth > child.clientWidth + 1))
              );
            })
            .map((child) => ({
              panel: panel.className,
              child: child.tagName + '.' + child.className,
              rect: child.getBoundingClientRect().toJSON(),
              boundary: boundary.toJSON(),
              scroll: [child.scrollWidth, child.scrollHeight],
              client: [child.clientWidth, child.clientHeight],
              text: child.textContent,
            }));
        }),
      );
    expect(panelOverflow, 'HUD child containment and clipping').toEqual([]);
    await expect(page.locator('[data-testid="round-ribbon"]')).toBeVisible();
    await expect(page.locator('[data-testid="turn-ribbon"]')).toBeVisible();
    await expect(page.locator('.seat-card.is-active')).toHaveCount(1);
    const state = await getState(page);
    const activeName = state.players[state.turnSeat]!.name;
    await expect(page.locator('[data-testid="turn-ribbon"]')).toContainText(activeName);
    await expect(page.locator('.seat-card.is-active strong')).toHaveText(activeName);
  });

  test(`rendered tiles are at least 48 CSS px with the live gameplay camera (${lang})`, async ({
    page,
  }) => {
    await startBoard(page, 'e2e-layout', lang);
    await mutateBoardForCoverage(page, process.env.M5A_MUTATION);
    const geometry = await renderedBoardGeometry(page);
    const visibleTiles = geometry.tiles.filter((tile) => fitsCanvas(tile, geometry.canvas));
    expect(geometry.tiles).toHaveLength((await getState(page)).board.spaces.length);
    expect(visibleTiles.length, 'nonempty rendered on-screen tiles').toBeGreaterThan(0);
    for (const tile of visibleTiles) {
      expect(tile.width, 'actual tile width in CSS px').toBeGreaterThanOrEqual(48);
      expect(tile.height, 'actual tile height in CSS px').toBeGreaterThanOrEqual(48);
    }
  });

  test(`space info shows translated town text, fits and wraps, closes on Escape and close button (${lang})`, async ({
    page,
  }) => {
    // m5a-town-75 reaches human town 8 after one roll (setup defaults).
    await startBoard(page, 'm5a-town-75', lang);
    await page.locator('[data-testid="action-roll"]').click();
    await playUntil(page, (state) => state.players[0]!.pos === 8 && state.turnSeat === 0);
    await tapTile(page, 'town', 8);
    await popupFits(page, lang);
    if (lang === 'th') {
      // Review Focus 5: the actual longest shipped Thai space info, not any text.
      const info = Object.entries(th).filter(([key]) => /^space\.[^.]+\.info$/.test(key));
      const longest = info.sort((a, b) => b[1].length - a[1].length)[0]!;
      expect(longest[0]).toBe('space.town.info');
      const lines = await page.locator('.space-info-text').evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          element.getBoundingClientRect().height /
          (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4)
        );
      });
      expect(lines).toBeGreaterThan(1);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator(popupSelector)).toHaveCount(0);
    await tapTile(page, 'town', 8);
    await page.locator('[data-testid="space-info-close"]').click();
    await expect(page.locator(popupSelector)).toHaveCount(0);
  });

  test(`space info closes on a real outside tap without a game action (${lang})`, async ({
    page,
  }) => {
    await startBoard(page, 'e2e-layout', lang);
    await tapTile(page, 'castle');
    const popup = page.locator(popupSelector);
    await expect(popup).toBeVisible();
    const before = await getState(page);
    await tapTile(page, 'monster', 1);
    await expect(popup.locator('.space-info-text')).toHaveText(texts[lang]['space.monster.info']);
    await expect(popup).toHaveCount(1);
    expect(await getState(page)).toEqual(before);
    const canvas = (await page.locator('#phaser-board canvas').boundingBox())!;
    const outside = { x: canvas.x + 16, y: canvas.y + canvas.height / 2 };
    const box = (await popup.boundingBox())!;
    expect(outside.x).toBeLessThan(box.x);
    await page.mouse.click(outside.x, outside.y);
    expect(await getState(page)).toEqual(before);
    await expect(popup).toHaveCount(0);
  });

  for (const viewport of [undefined, { width: 915, height: 412 }, { width: 932, height: 388 }]) {
    test(`map toggle changes actual camera out and back with all separated tokens visible (${lang}, ${viewport?.width ?? 'project'})`, async ({
      page,
    }, info) => {
      if (viewport) await page.setViewportSize(viewport);
      await continueSave(page, lang);
      const beforeState = await getState(page);
      expect(new Set(beforeState.players.map((player) => player.pos)).size).toBe(4);
      const before = await renderedBoardGeometry(page);
      expect(before.tokens).toHaveLength(4);
      expect(before.tokens.some((token) => !fitsCanvas(token, before.canvas))).toBe(true);
      await mutateBoardForCoverage(page, process.env.M5A_MUTATION);
      const toggle = page.locator('[data-testid="map-toggle"]');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      const whole = await renderedBoardGeometry(page);
      expect(whole.zoom, 'live camera zoomed out').toBeLessThan(before.zoom);
      expect([whole.scrollX, whole.scrollY]).not.toEqual([before.scrollX, before.scrollY]);
      expect(whole.tokens).toHaveLength(4);
      const flags = await renderedOwnedFlags(page);
      const safe = await renderedPlayfield(page);
      expect(safe.left).toBeGreaterThanOrEqual(8);
      expect(safe.top).toBeGreaterThanOrEqual(58);
      for (const object of [...whole.tokens, ...whole.tiles, ...flags])
        expect(
          fitsCanvas(object, safe),
          'whole-map actors/path fit safe main-camera viewport',
        ).toBe(true);
      console.log(
        `Whole-map ${info.project.name} ${lang} ${viewport?.width ?? 'project'}: ${JSON.stringify({ tokens: whole.tokens, flags })}`,
      );
      await info.attach('whole-map-extremes', {
        body: JSON.stringify({ whole, flags }),
        contentType: 'application/json',
      });
      await page.screenshot({ path: info.outputPath('whole-map-extremes.png') });
      for (const token of whole.tokens)
        expect
          .soft(fitsCanvas(token, whole.canvas), `hero at ${JSON.stringify(token.world)}`)
          .toBe(true);
      expect(whole.tiles).toHaveLength(beforeState.board.spaces.length);
      for (const tile of whole.tiles)
        expect
          .soft(fitsCanvas(tile, whole.canvas), `tile at ${JSON.stringify(tile.world)}`)
          .toBe(true);
      expect(flags).toHaveLength(beforeState.towns.length);
      for (const flag of flags)
        expect
          .soft(fitsCanvas(flag, whole.canvas), `owned flag ${JSON.stringify(flag)}`)
          .toBe(true);
      expect(whole.tokens[0]!.width).toBeLessThan(before.tokens[0]!.width);
      if (viewport) {
        await page.setViewportSize({ width: 1280, height: 720 });
        await renderedBoardGeometry(page);
        await page.setViewportSize(viewport);
        const resized = await renderedBoardGeometry(page);
        const resizedSafe = await renderedPlayfield(page);
        for (const object of [
          ...resized.tokens,
          ...resized.tiles,
          ...(await renderedOwnedFlags(page)),
        ]) {
          expect(
            fitsCanvas(object, resizedSafe),
            'safe viewport remains contained after live resize',
          ).toBe(true);
          expect(
            fitsCanvas(object, resized.canvas),
            'gameplay remains contained after live resize',
          ).toBe(true);
        }
      }
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      const after = await renderedBoardGeometry(page);
      expect(after.zoom).toBeCloseTo(before.zoom, 6);
      expect(after.scrollX).toBeCloseTo(before.scrollX, 6);
      expect(after.scrollY).toBeCloseTo(before.scrollY, 6);
      expect(after.tokens[0]!.width).toBeCloseTo(before.tokens[0]!.width, 6);
      expect(after.tokens.some((token) => !fitsCanvas(token, after.canvas))).toBe(true);
      expect(await getState(page)).toEqual(beforeState);
    });
  }

  test(`seeded fork arrows dispatch the selected branch (${lang})`, async ({ page }) => {
    // Two rolls reach fork 19 with options 20/37 and two steps remaining.
    await startBoard(page, 'm5a-fork-67', lang);
    await page.locator('[data-testid="action-roll"]').click();
    await playUntil(page, (state) => state.turnSeat === 0 && state.phase.kind === 'awaitRoll');
    await page.locator('[data-testid="action-roll"]').click();
    await expect.poll(() => getState(page).then((state) => state.phase.kind)).toBe('chooseBranch');
    const fork = await getState(page);
    expect(fork.phase.kind === 'chooseBranch' && fork.phase.options).toEqual([20, 37]);
    expect(fork.players[0]!.pos).toBe(19);
    await expect(page.locator('[data-testid^="fork-arrow-"]')).toHaveCount(2);
    await assertInside(page, '[data-testid^="fork-arrow-"]');
    // Real mirror click walks 19 -> 37 -> 38; choosing 20 instead settles at 8.
    // fork-popup.spec.ts separately covers arrows with an open popup.
    await page.locator('[data-testid="fork-arrow-37"]').click();
    await expect.poll(() => getState(page).then((state) => state.players[0]!.pos)).toBe(38);
    await expect(page.locator('[data-testid^="fork-arrow-"]')).toHaveCount(0);
    await expect.poll(() => getState(page).then((state) => state.phase.kind)).toBe('awaitRoll');
    await expect.poll(() => getState(page).then((state) => state.turnSeat)).toBe(0);
  });

  test(`owned town popup displays owner and value (${lang})`, async ({ page }) => {
    await startBoard(page, 'm5a-fork-2', lang);
    await playUntil(page, (state) =>
      state.towns.some((town) => town.spaceId === 8 && town.owner !== null),
    );
    const town = (await getState(page)).towns.find((candidate) => candidate.spaceId === 8)!;
    expect(town.owner).not.toBeNull();
    await tapTile(page, 'town', 8);
    await popupFits(page, lang);
    const popup = page.locator(popupSelector);
    await expect(popup.locator('[data-testid="space-info-owner"]')).toContainText(
      String(town.owner! + 1),
    );
    await expect(popup.locator('[data-testid="space-info-value"]')).toHaveText(String(town.value));
  });
}
