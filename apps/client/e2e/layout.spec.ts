import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const screenshotDir = join(process.env.TMPDIR ?? tmpdir(), 'm4a-fix27');

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
