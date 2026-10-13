import { expect, test, type Page } from '@playwright/test';
import { createGame, data, legalActions, step, type GameState } from '@dice-bandits/engine';
import type Phaser from 'phaser';
import { observeBoardGame, openTitleChoice, startBattleJourney } from './helpers';

// Deliberately prepared SAVE fixtures, not claims of a natural first-level no-level-up win.
function fixture(kind: 'monster' | 'pvp' | 'empty' | 'large'): GameState {
  let state = createGame({
    seed: kind === 'monster' ? 'm5ab-1' : 'r1-pvp-positive',
    rounds: 8,
    seats: [
      {
        name: 'Ada',
        classId: kind === 'monster' ? 'knight' : 'thief',
        control: 'human',
        personality: null,
      },
      { name: 'Ben', classId: 'knight', control: 'human', personality: null },
    ],
  });
  if (kind === 'monster') {
    const hero = state.players[0]!;
    hero.level = data.BALANCE.levelCap;
    for (const key of ['maxHp', 'atk', 'def', 'spd', 'mag'] as const)
      hero.stats[key] += data.CLASSES.knight.growth[key] * (hero.level - 1);
    hero.hp = hero.stats.maxHp;
    state = step(state, { type: 'roll' }).state;
  } else {
    // Same seed/class pair and equipped bag as the approved saved prototype.
    const hero = state.players[0]!;
    hero.level = data.BALANCE.levelCap;
    for (const key of ['maxHp', 'atk', 'def', 'spd', 'mag'] as const)
      hero.stats[key] += data.CLASSES[hero.classId].growth[key] * (hero.level - 1);
    hero.hp = hero.stats.maxHp;
    state.players[1]!.items = kind === 'empty' ? [] : ['steelSword', 'potion', 'mapScroll'];
    state.players[1]!.weapon = kind === 'empty' ? null : 'steelSword';
    if (kind !== 'empty') state.players[1]!.stats.atk += 4;
    if (kind === 'empty') state.players[1]!.gold = 0;
    if (kind === 'pvp') state.towns[0]!.owner = 1;
    if (kind === 'large') for (const town of state.towns) town.owner = 1;
    state.phase = { kind: 'duelOffer', remaining: 1, targets: [1] };
    state = step(state, { type: 'duel', target: 1 }).state;
  }
  return state;
}
async function load(page: Page, state: GameState) {
  await observeBoardGame(page);
  await page.addInitScript((state) => {
    localStorage.setItem('lang', 'th');
    localStorage.setItem('diceBandits.save', JSON.stringify({ version: 2, state }));
  }, state);
  await page.goto('/?speed=0');
  await openTitleChoice(page, 'continue');
  await page.waitForFunction(() => window.__db?.art.battleReady);
}
async function winningPick(page: Page, animated = true) {
  for (let i = 0; i < 50; i++) {
    const state = await page.evaluate(() => window.__db!.getState());
    if (state.phase.kind !== 'battle') return;
    if (await page.getByTestId('pass-ready').isVisible())
      await page.getByTestId('pass-ready').click();
    const legal = state.players.flatMap((p) => legalActions(state, p.seat));
    const action =
      legal.find((a) => a.type === 'battlePick' && a.pick === 'attack') ??
      legal.find((a) => a.type === 'battlePick' && a.pick === 'defend')!;
    if (!action || action.type !== 'battlePick') throw new Error('expected real battle choice');
    const next = step(state, action);
    if (next.events.some((e) => e.type === 'BattleEnded')) {
      await page.evaluate(
        (speed) => {
          window.diceBanditsSpeed = speed;
        },
        animated ? 1 : 0,
      );
      await page.getByTestId(`pick-${action.pick}`).click();
      return next;
    }
    await page.getByTestId(`pick-${action.pick}`).click();
    await expect.poll(() => page.evaluate(() => window.__db!.getState())).toEqual(next.state);
  }
  throw new Error('fixture did not finish a real battle');
}
async function clean(page: Page) {
  await expect(page.getByTestId('battle-post')).toHaveCount(0);
  await page.waitForFunction(() => !window.__db?.art.battleReady);
  expect(
    await page.evaluate(() => {
      const scene = (window as Window & { __m5aGame: Phaser.Game }).__m5aGame.scene.getScene(
        'BattleScene',
      ) as Phaser.Scene & { postSprites: unknown[]; postTweens: unknown[] };
      return { sprites: scene.postSprites.length, tweens: scene.postTweens.length };
    }),
  ).toEqual({ sprites: 0, tweens: 0 });
  await expect(page.getByTestId('screen-board')).toBeVisible();
}

test('monster win with real level-up, counting rewards, explicit perk, resize and clean exit', async ({
  page,
}, info) => {
  await observeBoardGame(page);
  await page.addInitScript(() => localStorage.setItem('lang', 'th'));
  await startBattleJourney(page, 0);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const next = await winningPick(page);
  expect(next!.events.some((e) => e.type === 'LevelUp')).toBe(true);
  await expect(page.locator('.post-title')).toHaveClass(/post-victory-banner/);
  const bannerHeight = await page
    .locator('.post-title')
    .evaluate((el) => (el as HTMLElement).offsetHeight);
  expect(bannerHeight).toBeGreaterThanOrEqual(page.viewportSize()!.height * 0.18);
  await expect(page.locator('[data-testid="battle-post"][data-beat="reward"]')).toBeVisible();
  await page.setViewportSize({ width: 932, height: 388 });
  await expect(page.locator('.post-choice-panel')).toBeVisible();
  await expect(page.getByTestId('dice-roll')).toBeHidden();
  await expect(page.locator('[data-post-choice="perk"]')).toHaveCount(3);
  await expect(page.locator('.dialog-shade')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('levelup-phone-th.png') });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => localStorage.setItem('lang', 'en'));
  await page.screenshot({ path: info.outputPath('levelup-desktop.png') });
  const state = await page.evaluate(() => window.__db!.getState());
  expect(state.phase.kind).toBe('levelUp');
  const action = legalActions(state, 0)[0]!;
  expect(action.type).toBe('pickPerk');
  const before = state.players[0]!.perks.length;
  await page.locator('[data-post-choice="perk"]').first().click();
  await expect
    .poll(() => page.evaluate(() => window.__db!.getState().players[0]!.perks.length))
    .toBe(before + 1);
  expect((await page.evaluate(() => window.__db!.getState())).players[0]!.perks).toEqual(
    step(state, action).state.players[0]!.perks,
  );
  await clean(page);
  expect(errors).toEqual([]);
});

for (const mode of ['animated', 'skip', 'reduced'] as const)
  test(`monster no-level-up ${mode} returns cleanly`, async ({ page }, info) => {
    await load(page, fixture('monster'));
    if (mode === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
    const result = await winningPick(page);
    expect(result!.events.some((e) => e.type === 'LevelUp')).toBe(false);
    if (mode !== 'reduced') {
      await expect(page.getByTestId('battle-post')).toBeVisible();
      await page.screenshot({ path: info.outputPath(`monster-${mode}.png`) });
      if (mode === 'skip') await page.locator('.post-skip').click();
    }
    await clean(page);
  });

for (const reward of ['loot', 'rob', 'seize', 'prank'] as const)
  test(`PvP ${reward} uses actual engine choice and clean exit`, async ({ page }, info) => {
    await load(page, fixture('pvp'));
    const result = await winningPick(page, false);
    expect(result!.state.phase.kind).toBe('pvpReward');
    await expect(page.locator('.post-choice-panel')).toBeVisible();
    const current = await page.evaluate(() => window.__db!.getState());
    if (current.phase.kind !== 'pvpReward') throw new Error('no real PvP reward');
    const legal = legalActions(current, current.phase.winner);
    const action = legal.find((a) => a.type === 'pvpReward' && a.reward === reward)!;
    expect(action, 'every tested reward must be legal in this saved fixture').toBeDefined();
    await page.screenshot({ path: info.outputPath('bag-winner-phone-th.png') });
    if (reward === 'prank') await page.getByTestId('post-prank-expand').click();
    const card = page.locator(`[data-action='${JSON.stringify(action)}']`);
    if (reward === 'loot') await expect(card).toHaveAttribute('data-equipped', 'true');
    await card.click();
    const expected = step(current, action);
    await expect.poll(() => page.evaluate(() => window.__db!.getState())).toEqual(expected.state);
    await clean(page);
  });

test('empty bag has gold zero plus one prank card without orphan or blank slot', async ({
  page,
}) => {
  await load(page, fixture('empty'));
  await winningPick(page, false);
  await expect(page.locator('.post-choice-panel')).toBeVisible();
  await expect(page.locator('.post-choice-panel > .post-cards > *')).toHaveCount(2);
  await expect(page.locator('[data-post-choice="gold"]')).toContainText('0');
  await expect(page.locator('[data-post-choice="item"], [data-post-choice="town"]')).toHaveCount(0);
  await page.locator('[data-post-choice="gold"]').click();
  await clean(page);
});

test('large bag pages horizontally, all towns and items remain selectable', async ({ page }) => {
  await load(page, fixture('large'));
  await winningPick(page, false);
  await expect(page.locator('.post-choice-panel .post-pager')).toBeVisible();
  const state = await page.evaluate(() => window.__db!.getState());
  if (state.phase.kind !== 'pvpReward') throw new Error('no PvP reward');
  const loser = state.phase.loser;
  expect(await page.locator('[data-post-choice="town"]').count()).toBe(
    state.towns.filter((t) => t.owner === loser).length,
  );
  await page.locator('[data-post-choice="town"]').last().click();
  await clean(page);
});
