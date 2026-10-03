// Battle journeys on this spec use `startBattleJourney` (helpers.ts): a fixed
// seed whose engine replay reaches a battle involving the human knight after
// 1 UI action (first roll → meadow monster, round 1). The previous
// `startTestGame` + `playUntil` journeys spun ~10 CPU-bound bot turns first
// (e2e-1's first battle is a bot's town-guardian fight, not the human's) and
// their speed=1 bot loops raced runner timing in CI.
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  assertInside,
  assertMinFont,
  assertNoEllipsis,
  startBattleJourney,
  startJourney,
} from './helpers';

// The original four-seat overlap test below is retained unchanged.
test('board and battle fit the viewport without truncation', async ({ page }) => {
  await startJourney(page);
  for (const lang of ['en', 'th'] as const) {
    await page.locator(`.game-topline [data-lang="${lang}"]`).click();
    await assertInside(page, '[data-testid="screen-board"] *:visible');
    await assertNoEllipsis(page, '[data-testid="event-banner"]');
    await assertMinFont(page, '.seat-card', 12);
  }
  await startBattleJourney(page);
  await expect(page.locator('.battle-panel')).toBeVisible();
  await assertInside(page, '.battle-panel *:visible', '.battle-panel');
  const expected = await page.evaluate(() => {
    const state = window.__db!.getState();
    if (state.phase.kind !== 'battle') throw new Error('not in battle');
    const fighter = state.phase.battle.a;
    return `${fighter.hp}/${fighter.stats.maxHp}`;
  });
  await expect(page.locator('[data-testid="hp-left"]')).toHaveText(expected);
});

test('reduced motion disables shake and ambient loops', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    // Positive control: the same seed/assets must actually draw ambient loops,
    // and the real shake probe must reach an active BoardScene.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await startBattleJourney(page, 1);
    await expect.poll(() => page.evaluate(() => window.__db!.art.ambientRunning)).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          window.__db!.art.triggerShake!();
          return window.__db!.art.shakeCount;
        }),
      )
      .toBeGreaterThan(0);

    // Reload under reduce: both probes reset, and the board draws afresh with
    // the new media policy (ambientRunning is a sticky "ever played" flag).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startBattleJourney(page, 1);
    // BootScene starts BoardScene before launching BattleScene; main.ts also
    // emits the board state before launching battle. A rendered backdrop thus
    // proves the board's ambient branch ran, unlike the earlier DOM-only wait.
    await expect
      .poll(() => page.evaluate(() => window.__db!.art.backdropKey))
      .toBe('backdrop-meadow');
    await expect.poll(() => page.evaluate(() => window.__db!.art.ambientRunning)).toBe(false);
    await page.evaluate(() => window.__db!.art.triggerShake!());
    expect(await page.evaluate(() => window.__db!.art.shakeCount)).toBe(0);
  } finally {
    await context.close();
  }
});

test('normal motion runs ambient loops at normal speed', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'no-preference' });
  try {
    const page = await context.newPage();
    await startBattleJourney(page, 1);
    await expect.poll(() => page.evaluate(() => window.__db!.art.ambientRunning)).toBe(true);
    expect(await page.evaluate(() => window.diceBanditsSpeed)).toBe(1);
    expect(await page.evaluate(() => window.__db!.art.ambientRunning)).toBe(true);
    await page.evaluate(() => window.__db!.art.triggerShake!());
    expect(await page.evaluate(() => window.__db!.art.shakeCount)).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test('mobile battle trace measures animation frame cadence', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-landscape', 'mobile emulation only');
  await startBattleJourney(page);
  const measurement = page.evaluate(
    () =>
      new Promise<{ frames: number; seconds: number; fps: number }>((resolve) => {
        let first = 0;
        let frames = 0;
        const sample = (time: number) => {
          if (!first) first = time;
          frames += 1;
          if (time - first < 2_000) requestAnimationFrame(sample);
          else {
            const seconds = (time - first) / 1_000;
            resolve({ frames, seconds, fps: (frames - 1) / seconds });
          }
        };
        requestAnimationFrame(sample);
      }),
  );
  // Switch from instant setup to animated combat while the frame sample runs.
  await page.evaluate(() => {
    window.diceBanditsSpeed = 1;
  });
  const choice = page.locator('[data-testid^="pick-"]:visible:enabled').first();
  if (await choice.count()) await choice.click();
  const result = await measurement;
  testInfo.annotations.push({ type: 'battle-raf-fps', description: JSON.stringify(result) });
  console.log(
    `Mobile battle rAF cadence: ${result.fps.toFixed(1)} FPS (${result.frames} callbacks / ${result.seconds.toFixed(3)} s)`,
  );
  // The frame cadence is hardware-dependent on the GPU-less CI runner; keep
  // recording it there, and enforce the interactive budget on local hardware.
  if (!process.env.CI) expect(result.fps).toBeGreaterThanOrEqual(30);
});

const screenshotDir = join(process.env.TMPDIR ?? tmpdir(), 'm4a', 'layout');

test('four-player hot-seat HUD controls fit without overlap at readable sizes', async ({
  page,
}) => {
  await mkdir(screenshotDir, { recursive: true });
  await page.goto('/?seed=e2e-layout&speed=0');
  await page.locator('[data-action="new"]').click();
  for (let seat = 1; seat < 4; seat += 1) {
    await page.locator(`[data-seat="${seat}"] select[data-field="control"]`).selectOption('human');
  }
  await page.locator('#setup-form button[type="submit"]').click();
  await expect(page.locator('[data-testid="screen-board"]')).toBeVisible();
  await expect(page.locator('.seat-card')).toHaveCount(4);

  for (const lang of ['th', 'en'] as const) {
    await page.locator(`.game-topline [data-lang="${lang}"]`).click();
    const layout = await page.evaluate(() => {
      const shell = document.querySelector('.game-shell')!;
      const elements = [
        ...Array.from(shell.querySelectorAll<HTMLElement>('.game-topline > *')).filter(
          (element) =>
            getComputedStyle(element).display !== 'none' &&
            element.getBoundingClientRect().width > 0,
        ),
        shell.querySelector<HTMLElement>('[data-testid="event-banner"]')!,
        ...Array.from(shell.querySelectorAll<HTMLElement>('.seat-card')),
        shell.querySelector<HTMLElement>('[data-testid="action-tray"]')!,
      ];
      const boxes = elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return {
          name: element.className || element.dataset.testid || element.tagName,
          x,
          y,
          width,
          height,
        };
      });
      const textNodes: Array<{ text: string; fontSize: number; element: string }> = [];
      const walker = document.createTreeWalker(shell, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent?.trim() || !node.parentElement) continue;
        const element = node.parentElement;
        const rect = element.getBoundingClientRect();
        if (
          rect.width === 0 ||
          rect.height === 0 ||
          getComputedStyle(element).visibility === 'hidden'
        )
          continue;
        textNodes.push({
          text: node.textContent.trim(),
          fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
          element: `${element.tagName}.${element.className}`,
        });
      }
      return { boxes, textNodes, width: innerWidth, height: innerHeight };
    });

    for (const box of layout.boxes) {
      expect(box.x, `${box.name} left`).toBeGreaterThanOrEqual(0);
      expect(box.y, `${box.name} top`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${box.name} right`).toBeLessThanOrEqual(layout.width);
      expect(box.y + box.height, `${box.name} bottom`).toBeLessThanOrEqual(layout.height);
    }
    for (let first = 0; first < layout.boxes.length; first += 1) {
      for (let second = first + 1; second < layout.boxes.length; second += 1) {
        const a = layout.boxes[first]!;
        const b = layout.boxes[second]!;
        const intersects =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;
        expect(intersects, `${a.name} intersects ${b.name}`).toBe(false);
      }
    }
    for (const text of layout.textNodes) {
      expect(text.fontSize, `${lang}: ${text.element} text “${text.text}”`).toBeGreaterThanOrEqual(
        12,
      );
    }
    await page.screenshot({
      path: join(screenshotDir, `${test.info().project.name}-${lang}.png`),
      fullPage: true,
    });
  }
});
