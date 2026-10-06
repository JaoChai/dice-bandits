import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { legalActions, step as engineStep } from '@dice-bandits/engine';
import { assertInside, assertNoEllipsis, playOneStep, startJourney } from './helpers';

const storageKey = 'dice-bandits:tips';
const onlineOrigin = 'http://127.0.0.1:8787';

async function enableTips(page: Page, lang: 'en' | 'th') {
  await page.addInitScript((locale) => {
    if (!localStorage.getItem('dicey-t3-seeded')) {
      localStorage.setItem('dice-bandits:tips', JSON.stringify({ enabled: true, seen: [] }));
      localStorage.setItem('dicey-t3-seeded', '1');
    }
    localStorage.setItem('lang', locale);
  }, lang);
}

async function settings(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey) as Promise<{
    enabled: boolean;
    seen: string[];
  }>;
}

async function state(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify(window.__db!.getState()));
}

async function scan(page: Page, name: string, info: TestInfo) {
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
  if (!process.env.AXE_SOURCE) return;
  await page.addScriptTag({ path: process.env.AXE_SOURCE });
  const result = await page.evaluate(async () =>
    (
      window as unknown as {
        axe: { run: (options: unknown) => Promise<{ violations: { impact: string }[] }> };
      }
    ).axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }),
  );
  await info.attach(`${name}-axe`, {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  const serious = result.violations.filter((issue) =>
    ['serious', 'critical'].includes(issue.impact),
  );
  console.log(`axe ${name}: ${serious.length} serious/critical`);
  expect(serious).toEqual([]);
}

async function measureTip(page: Page, name: string, info: TestInfo) {
  await assertInside(page, '[data-testid="dicey-tip"]');
  await assertNoEllipsis(page, '[data-testid="dicey-tip"]');
  const rows = await page.evaluate(() => {
    const tip = document.querySelector('[data-testid="dicey-tip"]')!.getBoundingClientRect();
    return [
      ...document.querySelectorAll(
        '.action-tray, .seat-card, .turn-ribbon, .game-topline > *, .menu-panel, .battle-hud, .battle-hp-card, .event-banner, .game-dialog, .game-dialog button',
      ),
    ].map((control) => {
      const rect = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
      return {
        control: control.className,
        overlap: visible
          ? Math.max(0, Math.min(tip.right, rect.right) - Math.max(tip.left, rect.left)) *
            Math.max(0, Math.min(tip.bottom, rect.bottom) - Math.max(tip.top, rect.top))
          : 0,
      };
    });
  });
  for (const row of rows) expect(row.overlap, JSON.stringify(row)).toBe(0);
  await info.attach(`${name}-overlap`, {
    body: JSON.stringify({ viewport: page.viewportSize(), rows }),
    contentType: 'application/json',
  });
  await scan(page, name, info);
}

for (const lang of ['en', 'th'] as const) {
  for (const dismiss of ['acknowledgement', 'dialog choice'] as const) {
    test(`QA F1 shop tip clears the dialog and remains clickable ${lang} ${dismiss}`, async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      await enableTips(page, lang);
      await page.goto('/?seed=qa-shop-1&speed=0');
      await page.locator('[data-action="new"]').click();
      for (let seat = 1; seat < 4; seat += 1)
        await page
          .locator(`[data-seat="${seat}"] select[data-field="control"]`)
          .selectOption('bot');
      await page.locator('[data-seat="0"] select[data-field="classId"]').selectOption('knight');
      await page.locator('#setup-form button[type="submit"]').click();
      for (let step = 0; step < 100; step += 1) {
        if (await page.locator('[data-testid="dicey-tip"][data-topic="shop"]').count()) break;
        await playOneStep(page);
      }
      await expect(page.getByTestId('dicey-tip')).toHaveAttribute('data-topic', 'shop');
      await expect(page.locator('.game-dialog')).toBeVisible();
      await expect(page.locator('.dicey-portrait')).toBeVisible({ timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready);
      const rects = await page.evaluate(() => {
        const box = (selector: string) =>
          document.querySelector(selector)!.getBoundingClientRect().toJSON();
        const ok = document.querySelector('[data-testid="dicey-tip-ok"]')!;
        const r = ok.getBoundingClientRect();
        return {
          tip: box('.dicey-tip'),
          dialog: box('.game-dialog'),
          okHit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === ok,
        };
      });
      console.log(`QA F1 ${info.project.name} ${lang}: ${JSON.stringify(rects)}`);
      await measureTip(page, `qa-shop-${lang}`, info);
      await assertInside(page, '.game-dialog');
      expect(rects.okHit).toBe(true);
      const before = await state(page);
      if (dismiss === 'dialog choice') {
        const game = await page.evaluate(() => window.__db!.getState());
        const buy = legalActions(game, game.turnSeat).find((action) => action.type === 'shopBuy')!;
        expect(buy).toBeDefined();
        const expected = engineStep(game, buy).state;
        await page.getByTestId(`shop-shopBuy-${buy.item}`).click();
        await expect(page.getByTestId('dicey-tip')).toHaveCount(0);
        expect((await settings(page)).seen).toContain('shop');
        await expect.poll(() => page.evaluate(() => window.__db!.getState())).toEqual(expected);
        return;
      }
      await page.getByTestId('dicey-tip-ok').click();
      expect(await state(page)).toBe(before);
      expect((await settings(page)).seen).toContain('shop');
      await expect(page.getByTestId('dicey-tip')).toHaveCount(0);
      await page.locator('.game-dialog button[data-choice]').first().click();
      await expect.poll(() => state(page)).not.toBe(before);
    });
  }

  test(`QA F1 townManage phase fixture remains readable and actionable ${lang}`, async ({
    page,
  }, info) => {
    await enableTips(page, lang);
    await startJourney(page);
    // The existing continue event enters a fixture through the real HUD/guide.
    // townManage is a tray phase, not a modal in the current client.
    await page.evaluate(() => {
      const next = structuredClone(window.__db!.getState());
      const town = next.towns[0]!;
      town.owner = 0;
      next.players[0]!.pos = town.spaceId;
      next.phase = { kind: 'townManage', spaceId: town.spaceId };
      document
        .getElementById('app')!
        .dispatchEvent(new CustomEvent('dice-bandits:continue', { detail: next }));
    });
    await expect(page.getByTestId('dicey-tip')).toHaveAttribute('data-topic', 'townManage');
    await expect(page.locator('.game-dialog')).toHaveCount(0);
    await expect(page.locator('.dicey-portrait')).toBeVisible({ timeout: 15_000 });
    await measureTip(page, `qa-town-manage-${lang}`, info);
    const before = await state(page);
    await page.getByTestId('dicey-tip-ok').click();
    expect(await state(page)).toBe(before);
    await page.locator('button[data-action-index]').first().click();
    await expect.poll(() => state(page)).not.toBe(before);
  });

  test(`QA F1 informational game dialog preserves tip access ${lang}`, async ({ page }, info) => {
    await enableTips(page, lang);
    await startJourney(page);
    await page.getByTestId('world-chip').click();
    await expect(page.getByTestId('world-info')).toBeVisible();
    await measureTip(page, `qa-world-info-${lang}`, info);
    await assertInside(page, '.game-dialog');
    await page.getByTestId('dicey-tip-ok').click();
    await page.getByTestId('world-info-close').click();
    await expect(page.getByTestId('world-info')).toHaveCount(0);
  });

  test(`QA F2 Exit and Dicey controls fit without menu scrolling ${lang}`, async ({
    page,
  }, info) => {
    await enableTips(page, lang);
    await startJourney(page);
    await page.getByTestId('menu-button').click();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.evaluate(() => {
      const panel = document.querySelector('.menu-panel')!;
      return {
        exitBottom: document.querySelector('[data-action="exit"]')!.getBoundingClientRect().bottom,
        viewportHeight: innerHeight,
        scrollTop: panel.scrollTop,
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
      };
    });
    console.log(`QA F2 ${info.project.name} ${lang}: ${JSON.stringify(geometry)}`);
    expect(geometry.scrollTop).toBe(0);
    await assertInside(page, '[data-action="exit"]');
    await assertInside(page, '.menu-panel button', '.menu-panel');
    for (const id of ['menu-dicey-tips', 'menu-dicey-reset']) {
      const rect = await page.getByTestId(id).boundingBox();
      expect(rect!.width).toBeGreaterThanOrEqual(44);
      expect(rect!.height).toBeGreaterThanOrEqual(44);
    }
    await measureTip(page, `qa-menu-${lang}`, info);
  });

  // Missing menu handler, wrong enabled/seen persistence or language refresh
  // must fail this journey through the real menu and guide, not a mock.
  test(`menu switch hides immediately, persists, resets and refreshes language ${lang}`, async ({
    page,
  }, info) => {
    await enableTips(page, lang);
    await startJourney(page);
    await expect(page.getByTestId('dicey-tip')).toHaveAttribute('data-topic', 'roll');
    await measureTip(page, `roll-${lang}`, info);
    const before = await state(page);
    await page.getByTestId('menu-button').click();
    const toggle = page.getByTestId('menu-dicey-tips');
    const reset = page.getByTestId('menu-dicey-reset');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('dicey-tip')).toBeVisible();
    await measureTip(page, `menu-on-${lang}`, info);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('dicey-tip')).toHaveCount(0);
    expect(await state(page)).toBe(before);
    expect((await settings(page)).enabled).toBe(false);
    await assertInside(page, '.menu-panel');
    await assertNoEllipsis(page, '.menu-panel');
    await scan(page, `menu-off-${lang}`, info);
    await page.locator('[data-action="exit"]').focus();
    await assertInside(page, '[data-action="exit"]', '.menu-panel');
    await page.keyboard.press('Shift+Tab');
    await expect(reset).toBeFocused();
    await reset.click();
    expect(await settings(page)).toEqual({ enabled: false, seen: [] });
    await expect(page.getByTestId('dicey-tip')).toHaveCount(0);

    await page.locator(`[data-lang="${lang === 'en' ? 'th' : 'en'}"]`).click();
    await expect(toggle).toHaveText(lang === 'en' ? 'ไดซี่สอนเล่น' : 'Dicey tips');
    await expect(reset).toHaveText(lang === 'en' ? 'ให้ไดซี่สอนใหม่' : 'Reset tips');
    await page.locator(`[data-lang="${lang}"]`).click();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('dicey-tip')).toHaveAttribute('data-topic', 'roll');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu-button')).toBeFocused();
    await page.getByTestId('dicey-tip-ok').click();
    expect((await settings(page)).seen).toContain('roll');
    await page.reload();
    await page.locator('[data-action="continue"]').click();
    await expect(page.getByTestId('screen-board')).toBeVisible();
    await expect(page.getByTestId('dicey-tip')).toHaveCount(0);
    await page.getByTestId('menu-button').click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await reset.click();
    await expect(page.getByTestId('dicey-tip')).toHaveAttribute('data-topic', 'roll');
    expect(await settings(page)).toEqual({ enabled: true, seen: [] });
    const resumed = await state(page);
    await toggle.click();
    await page.keyboard.press('Escape');
    await scan(page, `empty-disabled-${lang}`, info);
    await page.getByTestId('action-roll').click();
    await expect(page.getByTestId('pick-attack')).toBeEnabled();
    await expect(page.getByTestId('dicey-tip')).toHaveCount(0);
    expect(await state(page)).not.toBe(resumed);
    await page.reload();
    await page.locator('[data-action="continue"]').click();
    await page.getByTestId('menu-button').click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('dicey-tip')).toHaveCount(0);
  });

  test(`seeded hot-seat shows roll, fork, space and battle only once ${lang}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await enableTips(page, lang);
    await startJourney(page);
    // Observe actual mounted bubbles; never inject topics or mutate game state.
    await page.evaluate(() => {
      const probe = window as unknown as { diceyTopics: string[] };
      probe.diceyTopics = [];
      const record = (element: Element) => {
        if (element.matches('[data-testid="dicey-tip"]'))
          probe.diceyTopics.push((element as HTMLElement).dataset.topic!);
      };
      document.querySelectorAll('[data-testid="dicey-tip"]').forEach(record);
      new MutationObserver((changes) => {
        for (const change of changes)
          for (const node of change.addedNodes)
            if (node instanceof Element) {
              record(node);
              node.querySelectorAll('[data-testid="dicey-tip"]').forEach(record);
            }
      }).observe(document.body, { subtree: true, childList: true });
    });
    let steps = 0;
    const spaceTopics = ['castle', 'town', 'shop', 'chest', 'monster', 'event', 'trap'];
    const observed = () =>
      page.evaluate(() => (window as unknown as { diceyTopics: string[] }).diceyTopics);
    while (steps < 250) {
      const topics = await observed();
      if (
        topics.includes('fork') &&
        topics.includes('battle') &&
        topics.some((t) => spaceTopics.includes(t))
      ) {
        const tip = page.getByTestId('dicey-tip');
        if (await tip.count())
          await measureTip(page, `journey-${lang}-${await tip.getAttribute('data-topic')}`, info);
        break;
      }
      const tip = page.getByTestId('dicey-tip');
      if (await tip.count()) {
        const topic = (await tip.getAttribute('data-topic'))!;
        await measureTip(page, `journey-${lang}-${topic}`, info);
        await page.getByTestId('dicey-tip-ok').click();
        continue;
      }
      expect(await page.evaluate(() => window.__db!.getState().phase.kind)).not.toBe('gameOver');
      await playOneStep(page);
      steps += 1;
    }
    const first = await observed();
    expect(first).toContain('roll');
    expect(first).toContain('fork');
    expect(first).toContain('battle');
    expect(first.some((t) => spaceTopics.includes(t))).toBe(true);
    if (await page.getByTestId('dicey-tip').count()) await page.getByTestId('dicey-tip-ok').click();
    for (let i = 0; i < 12; i += 1) {
      if (await page.getByTestId('dicey-tip').count())
        await page.getByTestId('dicey-tip-ok').click();
      if (await page.evaluate(() => window.__db!.getState().phase.kind === 'gameOver')) break;
      await playOneStep(page);
      steps += 1;
    }
    const topics = await observed();
    for (const topic of new Set(topics))
      expect(
        topics.filter((t) => t === topic),
        topic,
      ).toHaveLength(1);
    const seen = (await settings(page)).seen;
    for (const topic of first) expect(seen).toContain(topic);
    await info.attach('hot-seat-topics', {
      body: JSON.stringify({ lang, viewport: page.viewportSize(), steps, topics, seen }),
      contentType: 'application/json',
    });
    console.log(`hot-seat ${lang}: ${steps} actions; ${topics.join(',')}; each once`);
  });

  test(`two online humans act eight times each without Dicey desync ${lang}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(180_000);
    await enableTips(page, lang);
    const errors: string[] = [];
    const watchErrors = (client: Page) => {
      client.on('pageerror', (error) => errors.push(error.message));
      client.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
    };
    watchErrors(page);
    await page.goto(`${onlineOrigin}/?speed=0`);
    await page.getByTestId('online-create').click();
    await page.getByTestId('online-name').fill('Alice');
    await page.getByTestId('online-create-submit').click();
    await expect(page.getByTestId('screen-lobby')).toBeVisible();
    const code = (await page.locator('.room-code strong').textContent())!.trim();
    const other = await browser.newContext({
      storageState: 'e2e/storage-state.json',
      viewport: page.viewportSize()!,
      ...(info.project.name === 'mobile-landscape' ? { isMobile: true, hasTouch: true } : {}),
    });
    try {
      const bob = await other.newPage();
      await enableTips(bob, lang);
      watchErrors(bob);
      await bob.goto(`${onlineOrigin}/r/${code}?speed=0`);
      await bob.getByTestId('online-name').fill('Bob');
      await bob.getByTestId('online-join-submit').click();
      await expect(page.getByTestId('lobby-seat-1')).toContainText('Bob');
      await page.getByTestId('lobby-start').click();
      const clients = [page, bob];
      for (const client of clients) await expect(client.getByTestId('screen-board')).toBeVisible();
      await expect(page.getByTestId('dicey-tip')).toHaveAttribute('data-topic', 'roll');
      await expect(bob.getByTestId('dicey-tip')).toHaveCount(0);
      const counts = [0, 0];
      const sawRoll = [false, false];
      let comparisons = 0;
      const action = async (client: Page) => {
        const dialog = client.locator('.dialog-shade button[data-choice]:visible:enabled').first();
        if (await dialog.count()) return dialog;
        return client
          .locator(
            'button[data-action-index]:visible:enabled, [data-testid="pass-ready"]:visible:enabled',
          )
          .first();
      };
      for (let step = 0; step < 240 && counts.some((count) => count < 8); step += 1) {
        await expect.poll(async () => (await state(page)) === (await state(bob))).toBe(true);
        await expect
          .poll(
            async () => (await (await action(page)).count()) + (await (await action(bob)).count()),
            { timeout: 15_000 },
          )
          .toBeGreaterThan(0);
        const actor = (await (await action(page)).count()) > 0 ? 0 : 1;
        const before = await state(clients[actor]!);
        const tip = clients[actor]!.getByTestId('dicey-tip');
        if ((await tip.count()) && (await tip.getAttribute('data-topic')) === 'roll')
          sawRoll[actor] = true;
        await (await action(clients[actor]!)).click({ timeout: 5_000 });
        await expect.poll(() => state(clients[actor]!)).not.toBe(before);
        await expect.poll(async () => (await state(page)) === (await state(bob))).toBe(true);
        counts[actor]! += 1;
        comparisons += 1;
      }
      expect(counts[0]).toBeGreaterThanOrEqual(8);
      expect(counts[1]).toBeGreaterThanOrEqual(8);
      expect(sawRoll).toEqual([true, true]);
      expect(await state(page)).toBe(await state(bob));
      expect(errors).toEqual([]);
      for (const client of clients) expect((await settings(client)).enabled).toBe(true);
      await info.attach('online-determinism', {
        body: JSON.stringify({
          lang,
          viewport: page.viewportSize(),
          alice: counts[0],
          bob: counts[1],
          comparisons,
          identical: true,
          errors,
        }),
        contentType: 'application/json',
      });
      console.log(
        `online ${lang}: Alice ${counts[0]}, Bob ${counts[1]}, ${comparisons} identical-state comparisons, 0 errors`,
      );
    } finally {
      await other.close();
    }
  });
}

test('Thai tip remains usable while portrait loads and when artwork fails', async ({
  page,
}, info) => {
  await enableTips(page, 'th');
  let failImage!: () => void;
  const held = new Promise<void>((resolve) => {
    failImage = resolve;
  });
  await page.route('**/art/tutor/dicey.webp', async (route) => {
    await held;
    await route.abort();
  });
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await startJourney(page);
  await expect(page.getByTestId('dicey-tip')).toHaveAttribute('data-topic', 'roll');
  await expect(page.locator('.dicey-portrait')).toBeHidden();
  await measureTip(page, 'loading-th', info);
  failImage();
  await expect
    .poll(() => warnings.filter((message) => message.includes('Dicey artwork unavailable')).length)
    .toBe(1);
  await expect(page.getByTestId('dicey-tip-ok')).toBeEnabled();
  await expect(page.locator('.dicey-portrait')).toBeHidden();
  await measureTip(page, 'error-text-only-th', info);
  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-dicey-tips').click();
  await expect(page.getByTestId('dicey-tip')).toHaveCount(0);
});
