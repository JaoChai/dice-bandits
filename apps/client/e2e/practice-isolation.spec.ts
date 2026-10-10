import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { TUTORIAL_SCRIPT } from '../src/tutor/script';
import { writeFile } from 'node:fs/promises';
import { assertInside, assertNoEllipsis, startBattleJourney } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

async function bytes(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .sort()
        .map((key) => [key, localStorage.getItem(key)]),
    ),
  );
}

async function capture(page: Page, name: string, info: TestInfo): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await assertInside(page, '.practice-invitation');
  await assertNoEllipsis(page, '.practice-invitation');
  const screenshot = info.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot });
  await info.attach(name, { path: screenshot, contentType: 'image/png' });
  if (!process.env.AXE_SOURCE) {
    info.annotations.push({ type: 'axe-not-run', description: `${name}: AXE_SOURCE not supplied` });
    return;
  }
  await page.addScriptTag({ path: process.env.AXE_SOURCE });
  const result = await page.evaluate(async () =>
    (
      window as unknown as {
        axe: { run(): Promise<{ violations: { id: string; impact: string }[] }> };
      }
    ).axe.run(),
  );
  await info.attach(`${name}-axe`, {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  expect(result.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
}

async function complete(page: Page, unchanged: () => Promise<void>): Promise<void> {
  let decisions = 0;
  while (!(await page.getByTestId('practice-setup').count())) {
    await page.waitForFunction(
      () => {
        const button = document.querySelector<HTMLButtonElement>('.practice-highlight');
        return (
          (button && !button.disabled) ||
          document.querySelector('[data-testid="practice-setup"], [data-testid="practice-retry"]')
        );
      },
      null,
      { timeout: 20_000 },
    );
    await expect(page.getByTestId('practice-retry')).toHaveCount(0);
    if (await page.getByTestId('practice-setup').count()) break;
    await unchanged();
    await page.locator('.practice-highlight').click();
    expect(++decisions).toBeLessThanOrEqual(31);
  }
  expect(decisions).toBe(31);
  await expect(page.locator('.practice-track')).toHaveAttribute('aria-valuenow', '8');
  await unchanged();
}

test('real saved game survives completion, replay, exit, setup Back and Continue byte-for-byte', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const lang = info.project.name === 'mobile-landscape' ? 'th' : 'en';
  const errors: string[] = [];
  const connections: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('request', (r) => {
    if (/\/api\/rooms|\/r\/[A-Z0-9]{5}/i.test(r.url())) connections.push(r.url());
  });
  page.on('websocket', (socket) => connections.push(socket.url()));
  await page.addInitScript((locale) => {
    // Once per browser, so reload cannot conceal practice corruption by reseeding.
    if (!localStorage.getItem('dice-bandits:intro-seen')) {
      localStorage.setItem('dice-bandits:intro-seen', '1');
      localStorage.setItem('dice-bandits:tips', '{"enabled":false,"seen":["roll"]}');
      localStorage.setItem('lang', locale);
    }
  }, lang);
  // Make the sentinel through the actual setup and first human battle, not a
  // fixture/continue event. All later practice entry/actions are real controls.
  await startBattleJourney(page);
  const savedState = await page.evaluate(() => window.__db!.getState());
  expect(savedState.config.seed).toBe('m5ab-1');
  expect(savedState.phase.kind).toBe('battle');
  const saved = await page.evaluate(() => localStorage.getItem('diceBandits.save'));
  expect(JSON.parse(saved!).state).toEqual(savedState);
  await page.evaluate((raw) => {
    // Preserve the exact canonical bytes produced by the normal UI/controller.
    localStorage.setItem('diceBandits.save', raw!);
    localStorage.setItem('dice-bandits:tips', '{"enabled":true,"seen":["roll"]}');
    // Synthetic preexisting offline session; never connect to or create a room.
    localStorage.setItem(
      'dice-bandits:room:ABCDE',
      '{"session":{"code":"ABCDE","seat":0,"token":"synthetic-offline-sentinel","name":"Saved seat"},"savedAt":1}',
    );
  }, saved);
  await page.reload();
  await expect(page.getByTestId('title-practice')).toBeVisible();
  const original = await bytes(page);
  await page.evaluate(() => {
    const probe = window as unknown as { __practiceStorageWrites: string[] };
    probe.__practiceStorageWrites = [];
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    const clear = Storage.prototype.clear;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage) probe.__practiceStorageWrites.push(`set:${key}`);
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (this === localStorage) probe.__practiceStorageWrites.push(`remove:${key}`);
      return remove.call(this, key);
    };
    Storage.prototype.clear = function () {
      if (this === localStorage) probe.__practiceStorageWrites.push('clear');
      return clear.call(this);
    };
  });
  const unchanged = async () => {
    expect(await bytes(page)).toEqual(original);
    expect(
      await page.evaluate(
        () => (window as unknown as { __practiceStorageWrites: string[] }).__practiceStorageWrites,
      ),
    ).toEqual([]);
    expect(connections).toEqual([]);
  };
  const enter = async () => {
    await page.getByTestId('title-practice').click();
    await expect(page.getByTestId('practice-begin')).toBeFocused();
    await unchanged();
    await page.getByTestId('practice-begin').click();
    await page.waitForFunction(() => window.__db?.art.boardReady);
    await expect(page.locator('.practice-track')).toHaveAttribute('aria-valuenow', '0');
    await unchanged();
  };
  await enter();
  // Exit while a real roll is in flight; retired scene/bot callbacks cannot save.
  await page.getByTestId('action-roll').click();
  await page.getByTestId('practice-exit').click();
  await page.getByTestId('practice-leave').click();
  await expect(page.getByTestId('title-practice')).toBeFocused();
  await unchanged();
  await enter();
  await complete(page, unchanged);
  await capture(page, 'saved-game-completion', info);
  await page.getByTestId('practice-replay').click();
  await expect(page.locator('.practice-track')).toHaveAttribute('aria-valuenow', '0');
  expect((await page.evaluate(() => window.__db!.getState())).config).toEqual(
    TUTORIAL_SCRIPT.config,
  );
  await unchanged();
  await complete(page, unchanged);
  await page.getByTestId('practice-setup').click();
  await expect(page.locator('#setup-form')).toBeVisible();
  await unchanged();
  await page.locator('[data-action="back"]').click();
  await expect(page.getByTestId('title-practice')).toHaveCount(1);
  await unchanged();
  await page.locator('[data-action="continue"]').click();
  await page.waitForFunction(() => window.__db?.art.boardReady && window.__db.art.battleReady);
  expect(await page.evaluate(() => window.__db!.getState())).toEqual(savedState);
  await expect(page.getByTestId('practice-coach')).toHaveCount(0);
  await expect(page.locator('.practice-topbar, .practice-highlight')).toHaveCount(0);
  // Continue is a normal saving controller; its canonical bytes must still
  // match the actual saved game, as well as its exact state and all settings.
  const continued = await bytes(page);
  expect(JSON.parse(continued['diceBandits.save']!).state).toEqual(savedState);
  expect(continued).toEqual(original);
  expect(connections).toEqual([]);
  expect(errors).toEqual([]);
  const evidencePath = info.outputPath('save-isolation-evidence.json');
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        lang,
        viewport: page.viewportSize(),
        decisions: 62,
        original,
        continued,
        savedState,
        connections,
        errors,
      },
      null,
      2,
    ),
  );
  await info.attach('save-isolation-evidence', {
    path: evidencePath,
    contentType: 'application/json',
  });
  // Starting a normal game after practice uses the actual setup/saving flow.
  await page.reload();
  await expect(page.getByTestId('title-practice')).toBeVisible();
  await page.getByTestId('title-practice').click();
  await page.getByTestId('practice-begin').click();
  await page.waitForFunction(() => window.__db?.art.boardReady);
  await complete(page, async () => {
    expect(await bytes(page)).toEqual(continued);
  });
  await page.getByTestId('practice-setup').click();
  await page.locator('#setup-form button[type="submit"]').click();
  await expect(page.getByTestId('screen-board')).toBeVisible();
  await expect(page.getByTestId('practice-coach')).toHaveCount(0);
  expect((await page.evaluate(() => window.__db!.getState())).config.seed).toBe('m5ab-1');
  expect((await bytes(page))['diceBandits.save']).not.toBe(original['diceBandits.save']);
  expect(errors).toEqual([]);
  expect(connections).toEqual([]);
});

for (const failure of ['loading', 'unavailable', 'empty'] as const) {
  test(`script ${failure} creates no game or storage and Back restores entry`, async ({
    page,
  }, info) => {
    const lang = info.project.name === 'mobile-landscape' ? 'th' : 'en';
    await page.addInitScript((locale) => {
      if (!localStorage.getItem('dice-bandits:intro-seen')) {
        localStorage.setItem('dice-bandits:intro-seen', '1');
        localStorage.setItem('lang', locale);
      }
    }, lang);
    const errors: string[] = [];
    const connections: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      if (/\/api\/rooms/.test(r.url())) connections.push(r.url());
    });
    page.on('websocket', (socket) => connections.push(socket.url()));
    // Explicit asset faults, never pretend these are the frozen acceptance route.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/assets/script-*.js', async (route) => {
      if (failure === 'loading') {
        await held;
        await route.continue();
      } else if (failure === 'unavailable') await route.abort('failed');
      else {
        const response = await route.fetch();
        const body = await response.text();
        const exported = /export\{(\w+) as TUTORIAL_SCRIPT\}/;
        expect(body.match(exported)).not.toBeNull();
        await route.fulfill({
          response,
          body: body.replace(
            exported,
            'const __emptyScript=null;export{__emptyScript as TUTORIAL_SCRIPT}',
          ),
        });
      }
    });
    await page.goto('/?speed=0');
    const original = await bytes(page);
    await page.getByTestId('title-practice').click();
    const control = page.getByTestId(
      failure === 'unavailable' ? 'practice-retry' : 'practice-back',
    );
    await expect(control).toBeVisible();
    if (failure === 'empty')
      await expect(page.locator('#practice-dialog-title')).toHaveText(
        lang === 'en' ? 'No practice lessons yet' : 'ยังไม่มีบทเรียนให้ฝึก',
      );
    await capture(page, failure, info);
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(await page.evaluate(() => window.__db)).toBeUndefined();
    expect(await bytes(page)).toEqual(original);
    await page.keyboard.press('Tab');
    await expect(page.locator('.practice-invitation button:focus')).toHaveCount(1);
    if (failure === 'unavailable') {
      await page.getByTestId('practice-retry').click();
      await expect(page.getByTestId('practice-retry')).toBeVisible();
      expect(await bytes(page)).toEqual(original);
    }
    await page.getByTestId('practice-back').click();
    await expect(page.getByTestId('title-practice')).toBeFocused();
    const loaded = failure === 'loading' ? page.waitForResponse('**/assets/script-*.js') : null;
    release();
    if (loaded) {
      await (await loaded).finished();
      await page.waitForFunction(() =>
        performance
          .getEntriesByType('resource')
          .some((entry) => /\/assets\/script-.*\.js/.test(entry.name)),
      );
      await expect(page.getByTestId('practice-begin')).toHaveCount(0);
      await expect(page.locator('canvas')).toHaveCount(0);
    }
    expect(await bytes(page)).toEqual(original);
    expect(connections).toEqual([]);
    expect(errors).toEqual([]);
  });
}
