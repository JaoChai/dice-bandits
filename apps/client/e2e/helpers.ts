import { expect, type Page } from '@playwright/test';
import type { GameState } from '@dice-bandits/engine';
import type Phaser from 'phaser';

type BoardProbeWindow = Window & { __m5aGame?: Phaser.Game };

/** Test-runner-only instrumentation: retain the real Game constructed by the
 * shipped bundle. No app hook/source change, fake camera, or geometry constants.
 * Fail explicitly if bundling changes the unique construction seam. */
export async function observeBoardGame(page: Page): Promise<void> {
  await page.route('**/assets/index-*.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const construction = /new [\w.$]+\.Game\(\{/g;
    expect(body.match(construction), 'one real Phaser Game construction').toHaveLength(1);
    await route.fulfill({
      response,
      body: body.replace(construction, (match) => `window.__m5aGame=${match}`),
    });
  });
}

/** Actual display-object bounds projected through the live rendered matrix,
 * then through the canvas's measured CSS scale. Wait for postrender so the
 * camera matrix cannot lag behind a just-clicked toggle. */
export async function renderedBoardGeometry(page: Page) {
  return page.evaluate(async () => {
    const game = (window as BoardProbeWindow).__m5aGame!;
    await new Promise<void>((resolve) => game.events.once('postrender', resolve));
    const scene = game.scene.getScene('BoardScene');
    const camera = scene.cameras.main;
    const canvas = game.canvas.getBoundingClientRect();
    const project = (x: number, y: number) => {
      const point = camera.getViewMatrix().transformPoint(x, y);
      return {
        x: canvas.left + (point.x / game.canvas.width) * canvas.width,
        y: canvas.top + (point.y / game.canvas.height) * canvas.height,
      };
    };
    const images = scene.children.getChildren().filter((child) => 'texture' in child) as Array<
      Phaser.GameObjects.Image | Phaser.GameObjects.Sprite
    >;
    const bounds = (image: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite) => {
      const rect = image.getBounds();
      const corners = [
        project(rect.left, rect.top),
        project(rect.right, rect.top),
        project(rect.right, rect.bottom),
        project(rect.left, rect.bottom),
      ];
      const left = Math.min(...corners.map((point) => point.x));
      const right = Math.max(...corners.map((point) => point.x));
      const top = Math.min(...corners.map((point) => point.y));
      const bottom = Math.max(...corners.map((point) => point.y));
      return {
        left,
        right,
        top,
        bottom,
        width: right - left,
        height: bottom - top,
        centre: project(image.x, image.y),
        visible: image.visible && image.alpha > 0 && camera.visible,
        world: { x: image.x, y: image.y },
        frame: image.frame.name,
      };
    };
    return {
      zoom: camera.zoom,
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
      canvas: { left: canvas.left, top: canvas.top, right: canvas.right, bottom: canvas.bottom },
      tiles: images.filter((image) => image.texture.key === 'art:tiles').map(bounds),
      tokens: images.filter((image) => image.texture.key.startsWith('token-')).map(bounds),
    };
  });
}

/** Opt-in mutation sanity checks alter REAL rendered objects/scene, never the
 * measured result. Normal runs leave gameplay unchanged. */
export async function mutateBoardForCoverage(
  page: Page,
  mutation: string | undefined,
): Promise<void> {
  if (!mutation) return;
  await page.evaluate((kind) => {
    const scene = (window as BoardProbeWindow).__m5aGame!.scene.getScene('BoardScene');
    if (kind === 'tile-size') {
      for (const child of scene.children.getChildren()) {
        if ('texture' in child) {
          const image = child as Phaser.GameObjects.Image;
          if (image.texture.key === 'art:tiles') image.setDisplaySize(32, 32);
        }
      }
    } else if (kind === 'camera-toggle') {
      // Equivalent to removing toggleWholeMap's applyCamera call: the real
      // handler/button/wholeMap flag still run, but the camera never moves.
      const board = scene as Phaser.Scene & { applyCamera: (...args: unknown[]) => void };
      board.applyCamera = () => {};
    } else {
      throw new Error(`Unknown coverage mutation: ${kind}`);
    }
  }, mutation);
}

/** Every rendered box in the selection must remain inside its containing box. */
export async function assertInside(
  page: Page,
  selector: string,
  container?: string,
): Promise<void> {
  const boxes = await page.locator(selector).evaluateAll((elements, containerSelector) => {
    const boundary = containerSelector
      ? document.querySelector(containerSelector)?.getBoundingClientRect()
      : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    if (!boundary) throw new Error(`Missing layout container: ${containerSelector}`);
    return elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        name: `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? `.${element.className.replaceAll(' ', '.')}` : ''}`,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        boundary: {
          left: boundary.left,
          top: boundary.top,
          right: boundary.right,
          bottom: boundary.bottom,
        },
      };
    });
  }, container);
  expect(boxes.length, `No visible elements match ${selector}`).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.left, `${box.name} left`).toBeGreaterThanOrEqual(box.boundary.left - 0.5);
    expect(box.top, `${box.name} top`).toBeGreaterThanOrEqual(box.boundary.top - 0.5);
    expect(box.right, `${box.name} right`).toBeLessThanOrEqual(box.boundary.right + 0.5);
    expect(box.bottom, `${box.name} bottom`).toBeLessThanOrEqual(box.boundary.bottom + 0.5);
  }
}

/** Assert every visible text box fits rather than relying on CSS ellipsis. */
export async function assertNoEllipsis(page: Page, selector: string): Promise<void> {
  const overflow = await page.locator(selector).evaluate((root) =>
    [root, ...root.querySelectorAll('*')]
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.clientWidth > 0;
      })
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map(
        (element) =>
          `${element.tagName}.${element.className}: ${element.scrollWidth} > ${element.clientWidth}`,
      ),
  );
  expect(overflow, `${selector} contains horizontally truncated text`).toEqual([]);
}

export async function assertMinFont(page: Page, selector: string, minimum: number): Promise<void> {
  const fonts = await page.locator(selector).evaluateAll((roots) =>
    roots
      .flatMap((root) => [root, ...root.querySelectorAll('*')])
      .filter((element) => element.textContent?.trim() && element.getBoundingClientRect().width > 0)
      .map((element) => ({
        text: element.textContent?.trim().slice(0, 60),
        size: parseFloat(getComputedStyle(element).fontSize),
      })),
  );
  expect(fonts.length, `${selector} has no visible text`).toBeGreaterThan(0);
  for (const font of fonts) expect(font.size, `Text ${font.text}`).toBeGreaterThanOrEqual(minimum);
}

export async function playUntil(
  page: Page,
  predicate: (state: GameState) => boolean,
): Promise<void> {
  for (let step = 0; step < 300; step += 1) {
    if (predicate(await page.evaluate(() => window.__db!.getState()))) return;
    await playOneStep(page);
  }
  throw new Error('Game did not reach requested phase within 300 actions');
}

export async function startTestGame(page: Page, speed = 0): Promise<void> {
  await page.goto(`/?seed=e2e-1&speed=${speed}`);
  await page.locator('[data-action="new"]').click();
  for (let seat = 1; seat < 4; seat += 1) {
    await page.locator(`[data-seat="${seat}"] select[data-field="control"]`).selectOption('bot');
  }
  await page.locator('[data-seat="0"] select[data-field="classId"]').selectOption('knight');
  await page.locator('#setup-form button[type="submit"]').click();
  await expect(page.locator('[data-testid="screen-board"]')).toBeVisible();
}

/**
 * Actionable-button selectors in the same precedence order `playOneStep`
 * clicks them: dialogs first (their shade intercepts pointer events), then
 * the HUD action tray, pick rows, and the pass/ready button.
 */
const ACTION_SELECTORS = [
  '.dialog-shade button:visible:enabled',
  '[data-testid^="action-"]:visible:enabled',
  '[data-testid^="pick-"]:visible:enabled',
  '[data-testid="pass-ready"]:visible:enabled',
] as const;

/**
 * Perform one UI action.
 *
 * Bot seats act on their own: while a bot plays — its roll, moves and battles
 * resolve asynchronously at speed > 0 — the human action tray is legitimately
 * empty, so poll for the next actionable button instead of failing on sight.
 * At speed=0 the tray is populated synchronously and the wait never engages.
 */
export async function playOneStep(page: Page): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    for (const selector of ACTION_SELECTORS) {
      const button = page.locator(selector).first();
      if (await button.count()) {
        try {
          await button.click({ timeout: 5_000 });
          return;
        } catch {
          break; // state changed mid-click (overlay closed/moved); re-poll
        }
      }
    }
    if (Date.now() > deadline) {
      throw new Error(
        'No visible enabled game action, pick, reward, perk, shop, or pass button found within 15s',
      );
    }
    await page.waitForTimeout(150);
  }
}

export async function playSteps(page: Page, count: number): Promise<void> {
  for (let step = 0; step < count; step += 1) {
    await playOneStep(page);
  }
}

/**
 * Start a game on the deterministic battle-journey seed and stop as soon as
 * the board is visible (phase awaitRoll, round 1, seat 0 to roll). `m5ab-1`
 * was derived by engine replay of the setup screen's real defaults (human
 * knight + greedy bot thief/mage/cleric): its first roll lands seat 0 on a
 * meadow monster — a battle involving the human, so at speed=0 the controller
 * parks on the pick cards and playUntil's "any visible button" polling cannot
 * resolve past it. No runner-speed dependence, and the journey is 1 click
 * instead of ~10.
 */
export async function startJourney(page: Page, speed = 0): Promise<void> {
  await page.goto(`/?seed=m5ab-1&speed=${speed}`);
  await page.locator('[data-action="new"]').click();
  for (let seat = 1; seat < 4; seat += 1) {
    await page.locator(`[data-seat="${seat}"] select[data-field="control"]`).selectOption('bot');
  }
  await page.locator('[data-seat="0"] select[data-field="classId"]').selectOption('knight');
  await page.locator('#setup-form button[type="submit"]').click();
  await expect(page.locator('[data-testid="screen-board"]')).toBeVisible();
}

/** `startJourney` + play until the deterministic human battle. */
export async function startBattleJourney(page: Page, speed = 0): Promise<void> {
  await startJourney(page, speed);
  await playUntil(page, (state) => state.phase.kind === 'battle');
  await waitForBattleArt(page);
}

/** The DOM/controller can enter battle while Phaser is still loading assets. */
export async function waitForBattleArt(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__db?.art.boardReady && window.__db.art.battleReady);
}
