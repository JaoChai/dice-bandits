import { expect, type Page } from '@playwright/test';
import type { GameState } from '@dice-bandits/engine';

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

export async function playOneStep(page: Page): Promise<void> {
  const modalButton = page.locator('.dialog-shade button:visible:enabled').first();
  if (await modalButton.count()) {
    await modalButton.click();
    return;
  }

  const action = page.locator('[data-testid^="action-"]:visible:enabled').first();
  if (await action.count()) {
    await action.click();
    return;
  }
  const pick = page.locator('[data-testid^="pick-"]:visible:enabled').first();
  if (await pick.count()) {
    await pick.click();
    return;
  }
  const pass = page.locator('[data-testid="pass-ready"]:visible:enabled').first();
  if (await pass.count()) {
    await pass.click();
    return;
  }

  throw new Error('No visible enabled game action, pick, reward, perk, shop, or pass button found');
}

export async function playSteps(page: Page, count: number): Promise<void> {
  for (let step = 0; step < count; step += 1) {
    await playOneStep(page);
  }
}
