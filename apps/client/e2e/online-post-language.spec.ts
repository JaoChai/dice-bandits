import { expect, test, type Page } from '@playwright/test';
import type { ClientMsg } from '@dice-bandits/room';
import { observeBoardGame, openTitleChoice } from './helpers';

type LanguageProbe = Window & {
  __postSent: ClientMsg[];
  __postReceipts: string[];
};

// Real authenticated rooms, UI actions only. Four human seats avoid bot RNG
// controlling preparation; winner and loser are the two clients under test.
test('lobby clients keep winner and loser cards through a language switch and submit once', async ({
  browser,
}, info) => {
  test.setTimeout(150_000);
  const contexts = [];
  const pages: Page[] = [];
  const errors: string[] = [];
  try {
    for (let seat = 0; seat < 4; seat++) {
      const context = await browser.newContext({
        storageState: 'e2e/storage-state.json',
        viewport: info.project.use.viewport,
      });
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      page.on('pageerror', (error) => errors.push(String(error)));
      await observeBoardGame(page);
      await page.addInitScript(() => {
        localStorage.setItem('lang', 'th');
        localStorage.setItem('dice-bandits:tips', JSON.stringify({ enabled: false, seen: [] }));
        const probe = window as unknown as LanguageProbe;
        probe.__postSent = [];
        probe.__postReceipts = [];
        const Native = WebSocket;
        window.WebSocket = class extends Native {
          send(data: Parameters<WebSocket['send']>[0]) {
            if (typeof data === 'string') probe.__postSent.push(JSON.parse(data) as ClientMsg);
            super.send(data);
          }
        };
        new MutationObserver(() => {
          const receipt = document.querySelector('.post-taken');
          if (receipt?.textContent) probe.__postReceipts.push(receipt.textContent);
        }).observe(document, { childList: true, subtree: true, characterData: true });
      });
    }
    const host = pages[0]!;
    await host.goto('http://127.0.0.1:8787/?speed=0');
    await openTitleChoice(host, 'online-create');
    await host.getByTestId('online-name').fill('Alice');
    await host.getByTestId('online-create-submit').click();
    await expect(host.getByTestId('screen-lobby')).toBeVisible();
    const code = (await host.locator('.room-code strong').textContent())!.trim();
    for (let seat = 1; seat < 4; seat++) {
      const page = pages[seat]!;
      await page.goto(`http://127.0.0.1:8787/r/${code}?speed=0`);
      await page.getByTestId('online-name').fill(['Alice', 'Bob', 'Charlie', 'Dana'][seat]!);
      await page.getByTestId('online-join-submit').click();
      await expect(page.getByTestId('screen-lobby')).toBeVisible();
    }
    for (const page of pages) await page.getByTestId('lobby-class-thief').click();
    await host.getByTestId('lobby-start').click();
    for (const page of pages) await page.waitForFunction(() => window.__db?.art.boardReady);
    const buttons =
      'button[data-choice]:visible:enabled, button[data-action-index]:visible:enabled';
    let preparations = 0;
    for (; preparations < 180; preparations++) {
      const state = await host.evaluate(() => window.__db!.getState());
      if (state.phase.kind === 'pvpReward') break;
      expect(state.phase.kind).not.toBe('gameOver');
      await expect
        .poll(async () =>
          (await Promise.all(pages.map((page) => page.locator(buttons).count()))).some(Boolean),
        )
        .toBe(true);
      for (const [seat, page] of pages.entries()) {
        if (!(await page.locator(buttons).count())) continue;
        const current = await page.evaluate(() => window.__db!.getState());
        if (current.phase.kind === 'pvpReward') break;
        let button = page.locator(buttons).first();
        if (current.phase.kind === 'duelOffer') {
          const targets = current.phase.targets.filter((target) => current.players[target]!.hp > 0);
          const preferred = seat === 0 ? 1 : 0;
          const target = targets.includes(preferred) ? preferred : targets[0];
          if (target !== undefined) button = page.getByTestId(`action-duel-${target}`);
        } else if (current.phase.kind === 'battle') {
          if (await page.getByTestId('pick-strike').isVisible())
            button = page.getByTestId('pick-strike');
          else if (await page.getByTestId('pick-counter').isVisible())
            button = page.getByTestId('pick-counter');
        } else {
          const leave = page.locator(
            '[data-testid="shop-leave-leave"]:visible:enabled, [data-testid="action-leave"]:visible:enabled',
          );
          if (await leave.count()) button = leave.first();
        }
        await button.click();
        break;
      }
    }
    const pending = await host.evaluate(() => window.__db!.getState());
    expect(pending.phase.kind).toBe('pvpReward');
    if (pending.phase.kind !== 'pvpReward') throw new Error('Real room did not reach PvP reward');
    const winner = pages[pending.phase.winner]!;
    const loser = pages[pending.phase.loser]!;
    for (const page of [winner, loser]) {
      await page.evaluate(() => {
        window.diceBanditsSpeed = 1;
      });
      await expect(page.locator('.post-choice-panel')).toBeVisible();
      await page.getByTestId('menu-button').click();
      await page.locator('[data-lang="en"]').click();
      await expect(page.getByTestId('screen-board')).toBeVisible();
      await expect(page.getByTestId('screen-lobby')).toHaveCount(0);
      await expect(page.locator('.post-choice-panel')).toBeVisible();
      await expect(page.locator('.post-kicker')).toContainText('Bag of');
    }
    await expect(winner.locator('.post-title')).toHaveText('Take one reward');
    await expect(loser.locator('.post-title')).toHaveText(
      `Waiting for ${pending.players[pending.phase.winner]!.name} to choose…`,
    );
    await expect(
      loser.locator('.post-choice-panel button, .post-choice-panel [data-choice]'),
    ).toHaveCount(0);
    const card = loser.locator('.post-choice-panel > .post-cards > .post-card').first();
    const bounds = await loser.evaluate(() => {
      const title = document.querySelector('.post-title')!;
      const first = document.querySelector('.post-choice-panel > .post-cards > .post-card')!;
      return {
        opacity: Number(getComputedStyle(first).opacity),
        filter: getComputedStyle(first).filter,
        gap: first.getBoundingClientRect().top - title.getBoundingClientRect().bottom,
      };
    });
    expect(bounds.opacity).toBeLessThanOrEqual(0.55);
    expect(bounds.filter).toBe('grayscale(1)');
    expect(bounds.gap).toBeGreaterThanOrEqual(8);
    await card.hover();
    expect(await card.evaluate((element) => getComputedStyle(element).transform)).toBe('none');
    for (const page of [winner, loser])
      await page.screenshot({
        path: info.outputPath(page === winner ? 'winner-language.png' : 'loser-language.png'),
      });
    for (const page of [winner, loser])
      await page.evaluate(() => {
        (window as unknown as LanguageProbe).__postReceipts = [];
      });
    await winner.locator('[data-post-choice="gold"]').dblclick();
    await loser.waitForFunction(() =>
      (window as unknown as LanguageProbe).__postReceipts.some((text) => text.includes(' took ')),
    );
    await expect(winner.getByTestId('battle-post')).toHaveCount(0);
    await expect(loser.getByTestId('battle-post')).toHaveCount(0);
    const sent = await Promise.all(
      pages.map((page) =>
        page.evaluate(() =>
          (window as unknown as LanguageProbe).__postSent.filter(
            (message) => message.type === 'action' && message.action.type === 'pvpReward',
          ),
        ),
      ),
    );
    expect(sent[pending.phase.winner]).toHaveLength(1);
    expect(sent[pending.phase.loser]).toHaveLength(0);
    for (const page of pages)
      await page.waitForFunction(() => window.__db!.getState().phase.kind !== 'pvpReward');
    expect(errors).toEqual([]);
    console.log(
      JSON.stringify({
        preparations,
        winner: pending.phase.winner,
        loser: pending.phase.loser,
        sent: sent.map((messages) => messages.length),
        bounds,
        errors,
      }),
    );
  } finally {
    for (const context of contexts) await context.close();
  }
});
