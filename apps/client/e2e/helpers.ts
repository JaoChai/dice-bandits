import { expect, type Page } from '@playwright/test';

export async function startTestGame(page: Page): Promise<void> {
  await page.goto('/?seed=e2e-1&speed=0');
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
