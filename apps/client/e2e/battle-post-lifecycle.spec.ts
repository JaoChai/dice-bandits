import { expect, test, type Page } from '@playwright/test';
import { legalActions, step, type GameState } from '@dice-bandits/engine';
import type Phaser from 'phaser';
import { observeBoardGame, playOneStep, startTestGame } from './helpers';

type LifecycleWindow = Window & {
  __m5aGame: Phaser.Game;
  __postLifecycle: {
    finales: Array<{ mode: 'human' | 'bot' | 'online'; pending: boolean; ready: boolean }>;
    updates: GameState[];
  };
};

async function observeLifecycle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__db?.art.boardReady);
  await page.evaluate(() => {
    const scope = window as LifecycleWindow;
    scope.__postLifecycle = { finales: [], updates: [] };
    scope.__m5aGame.events.on('game-state', (state: GameState) => {
      scope.__postLifecycle.updates.push(structuredClone(state));
    });
    const post = window.__db!.post!;
    const play = post.play.bind(post);
    post.play = (input) => {
      scope.__postLifecycle.finales.push({
        mode: input.mode,
        pending: ['levelUp', 'pvpReward'].includes(input.next.phase.kind),
        ready: scope.__m5aGame.scene.isActive('BattleScene'),
      });
      return play(input);
    };
  });
}

function errors(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('GL Driver'))
      consoleErrors.push(message.text());
  });
  return { pageErrors, consoleErrors };
}

// Real e2e-1 controller, real scene starts/stops, real bot automation. No state injection.
test('multiple human and bot finales progress to gameOver without dead-canvas calls', async ({
  page,
}) => {
  const observed = errors(page);
  await observeBoardGame(page);
  await startTestGame(page, 0);
  await observeLifecycle(page);
  let actions = 0;
  for (; actions < 300; actions++) {
    if ((await page.evaluate(() => window.__db!.getState().phase.kind)) === 'gameOver') break;
    await playOneStep(page);
  }
  expect((await page.evaluate(() => window.__db!.getState())).phase.kind).toBe('gameOver');
  expect(actions).toBeGreaterThan(24);
  const log = await page.evaluate(() => (window as LifecycleWindow).__postLifecycle);
  expect(log.finales.filter(({ mode }) => mode === 'human').length).toBeGreaterThan(1);
  expect(log.finales.filter(({ mode }) => mode === 'bot').length).toBeGreaterThan(1);
  expect(log.finales.some(({ mode, pending, ready }) => mode === 'bot' && pending && !ready)).toBe(
    true,
  );
  expect(log.updates.some((state) => state.phase.kind === 'levelUp')).toBe(true);
  expect(observed.pageErrors).toEqual([]);
  expect(observed.consoleErrors).toEqual([]);
});

test('a later shop purchase after a finale uses the board and advances authoritative state', async ({
  page,
}, info) => {
  const observed = errors(page);
  await observeBoardGame(page);
  await startTestGame(page, 0);
  await observeLifecycle(page);
  for (let actions = 0; actions < 300; actions++) {
    const current = await page.evaluate(() => window.__db!.getState());
    if (current.phase.kind === 'gameOver') throw new Error('expected later human shop on e2e-1');
    const log = await page.evaluate(() => (window as LifecycleWindow).__postLifecycle);
    if (current.phase.kind === 'shop' && log.finales.length > 0) {
      const buy = legalActions(current, current.turnSeat).find(
        (action) => action.type === 'shopBuy',
      );
      expect(buy).toBeDefined();
      if (!buy || buy.type !== 'shopBuy') throw new Error('expected affordable real shop item');
      await page.waitForFunction(() => !window.__db?.art.battleReady);
      await expect(page.getByTestId('battle-post')).toHaveCount(0);
      const expected = step(current, buy).state;
      await page.getByTestId(`shop-shopBuy-${buy.item}`).click();
      await expect.poll(() => page.evaluate(() => window.__db!.getState())).toEqual(expected);
      await expect(page.getByTestId('battle-post')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('later-shop.png') });
      expect(observed.pageErrors).toEqual([]);
      expect(observed.consoleErrors).toEqual([]);
      return;
    }
    await playOneStep(page);
  }
  throw new Error('shop not reached');
});
