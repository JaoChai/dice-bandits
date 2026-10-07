import { createGame, step, type GameEvent, type GameState } from '@dice-bandits/engine';
import { expect, test, type Page } from '@playwright/test';
import type Phaser from 'phaser';
import { assertInside, observeBoardGame, renderedBoardGeometry } from './helpers';

type Trace = { at: number; stage: string | null; events: GameEvent[] };
type ProbeWindow = Window & {
  __m5aGame: Phaser.Game;
  __diceTrace: Trace[];
  __diceStages: Array<{ stage: string; at: number }>;
};
const mode = { speed: '1', lang: 'en' as 'th' | 'en', reduced: false };
function saved(): GameState {
  const state = createGame({
    seed: 'ux-18',
    rounds: 12,
    seats: [
      { name: 'A', classId: 'knight', control: 'human', personality: null },
      { name: 'B', classId: 'thief', control: 'human', personality: null },
    ],
  });
  state.players[0]!.forcedRoll = 5;
  return state;
}
async function start(page: Page, state = saved(), options = mode): Promise<void> {
  await observeBoardGame(page);
  await page.emulateMedia({ reducedMotion: options.reduced ? 'reduce' : 'no-preference' });
  await page.addInitScript(
    ({ state, lang }) => {
      localStorage.setItem('diceBandits.save', JSON.stringify({ version: 2, state }));
      localStorage.setItem('lang', lang);
      // Tips have their own tests; do not let a first-run bubble cover Roll.
      localStorage.setItem('dice-bandits:tips', JSON.stringify({ enabled: false, seen: [] }));
    },
    { state, lang: options.lang },
  );
  await page.goto(`/?speed=${options.speed}`);
  await page.locator('[data-action="continue"]').click();
  await page.waitForFunction(() => window.__db?.art.boardReady);
  await installTrace(page);
}
async function installTrace(page: Page, online = false): Promise<void> {
  await page.evaluate((online) => {
    const probe = window as ProbeWindow;
    probe.__diceTrace = [];
    probe.__diceStages = [];
    const board = probe.__m5aGame.scene.getScene('BoardScene') as Phaser.Scene & {
      playEvents(events: GameEvent[]): Promise<void>;
      presentOnlineMovement(
        previous: GameState,
        next: GameState,
        events: readonly GameEvent[],
        generation: number,
      ): void;
    };
    const record = (events: readonly GameEvent[]) => {
      probe.__diceTrace.push({
        at: performance.now(),
        stage:
          document.querySelector<HTMLElement>('[data-testid="dice-roll"]')?.dataset.stage ?? null,
        events: structuredClone([...events]),
      });
    };
    if (online) {
      // Online movement now starts after the authoritative view commit, detached.
      const present = board.presentOnlineMovement.bind(board);
      board.presentOnlineMovement = (previous, next, events, generation) => {
        record(events);
        return present(previous, next, events, generation);
      };
    } else {
      const play = board.playEvents.bind(board);
      board.playEvents = (events) => {
        record(events);
        return play(events);
      };
    }
    let last = '';
    new MutationObserver(() => {
      const stage =
        document.querySelector<HTMLElement>('[data-testid="dice-roll"]')?.dataset.stage ?? 'absent';
      if (stage !== last) {
        probe.__diceStages.push({ stage, at: performance.now() });
        last = stage;
      }
    }).observe(document.getElementById('app')!, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-stage'],
    });
  }, online);
}
async function trace(page: Page) {
  return page.evaluate(() => ({
    moves: (window as ProbeWindow).__diceTrace,
    stages: (window as ProbeWindow).__diceStages,
  }));
}
async function roll(page: Page): Promise<void> {
  await page.getByTestId('action-roll').evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
}

for (const lang of ['th', 'en'] as const) {
  test(`local human ${lang}: tumble → readable truth → real movement, double-click once`, async ({
    page,
  }, info) => {
    const initial = saved();
    const expected = step(initial, { type: 'roll' });
    const rollEvent = expected.events.find((event) => event.type === 'DiceRolled')!;
    await start(page, initial, { ...mode, lang });
    await expect(page.getByTestId('last-roll-chip')).toHaveCount(0);
    const before = (await renderedBoardGeometry(page)).tokens.map((token) => token.world);
    await roll(page);
    const die = page.getByTestId('dice-roll');
    await expect(die).toHaveAttribute('data-stage', 'rolling');
    await expect(page.locator('[data-action-index]:enabled, [data-choice]:enabled')).toHaveCount(0);
    await expect(page.locator('.phase-dialog, .battle-controls')).toHaveCount(0);
    expect((await trace(page)).moves).toEqual([]);
    await expect(die).toHaveAttribute('data-stage', 'result');
    await expect(die).toContainText(lang === 'th' ? 'ทอยได้ 5' : 'Rolled 5');
    await expect(die.locator('.dice-pip')).toHaveCount(Number(rollEvent.params.value));
    expect((await renderedBoardGeometry(page)).tokens.map((token) => token.world)).toEqual(before);
    await assertInside(page, '[data-testid="dice-roll"], [data-testid="last-roll-chip"]');
    const controlsCovered = await die.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return [
        ...document.querySelectorAll('.menu-button, .audio-toggle, [data-testid="map-toggle"]'),
      ]
        .filter((control) => {
          const rect = control.getBoundingClientRect();
          return (
            rect.left < box.right &&
            rect.right > box.left &&
            rect.top < box.bottom &&
            rect.bottom > box.top
          );
        })
        .map((control) => control.className);
    });
    expect(controlsCovered, 'result must not visually cover live board controls').toEqual([]);
    await page.screenshot({ path: info.outputPath(`dice-${lang}-${info.project.name}.png`) });
    // Language render during the hold must not re-enable old actions.
    await page.getByTestId('menu-button').click();
    await page.locator(`[data-lang="${lang === 'th' ? 'en' : 'th'}"]`).click();
    await expect(page.locator('[data-action-index]:enabled')).toHaveCount(0);
    await expect(die).toHaveCount(0);
    await expect.poll(async () => (await trace(page)).moves.length).toBe(1);
    const evidence = await trace(page);
    const rolling = evidence.stages.find((entry) => entry.stage === 'rolling')!;
    const result = evidence.stages.find((entry) => entry.stage === 'result')!;
    expect(result.at - rolling.at).toBeGreaterThanOrEqual(850);
    expect(evidence.moves[0]!.at - result.at).toBeGreaterThanOrEqual(1350);
    expect(evidence.moves[0]!.events.filter((event) => event.type === 'DiceRolled')).toEqual([
      rollEvent,
    ]);
    await expect(page.getByTestId('last-roll-chip')).toHaveText(
      lang === 'th' ? 'Rolled 5' : 'ทอยได้ 5',
    );
    await expect
      .poll(() => page.evaluate(() => (window as ProbeWindow).__m5aGame.registry.get('state')))
      .toEqual(expected.state);
    expect(await page.evaluate(() => window.__db!.getState())).toEqual(expected.state);
  });
}

for (const options of [
  { ...mode, speed: '0' },
  { ...mode, reduced: true },
]) {
  test(`static result ${options.reduced ? 'reduced motion' : 'speed zero'}: no tumble or added wait`, async ({
    page,
  }, info) => {
    await start(page, saved(), options);
    await roll(page);
    await expect(page.getByTestId('dice-roll')).toHaveAttribute('data-stage', 'result');
    await expect(page.getByTestId('last-roll-chip')).toHaveText('Rolled 5');
    await expect.poll(async () => (await trace(page)).moves.length).toBe(1);
    const evidence = await trace(page);
    expect(evidence.stages.some((entry) => entry.stage === 'rolling')).toBe(false);
    const result = evidence.stages.find((entry) => entry.stage === 'result')!;
    expect(evidence.moves[0]!.at - result.at).toBeLessThan(150);
    await page.screenshot({ path: info.outputPath(`dice-static-${info.project.name}.png`) });
  });
}

test('bonus dice shows real count/total, never fabricated faces', async ({ page }) => {
  const initial = saved();
  initial.players[0]!.forcedRoll = null;
  initial.players[0]!.bonusDice = 1;
  const expected = step(initial, { type: 'roll' });
  const rollEvent = expected.events.find((event) => event.type === 'DiceRolled')!;
  await start(page, initial, { ...mode, speed: '0' });
  await roll(page);
  await expect(page.getByTestId('dice-roll')).toContainText('2 × d6');
  await expect(page.getByTestId('last-roll-chip')).toHaveText(`Rolled ${rollEvent.params.value}`);
  await expect(page.locator('.dice-pip')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as ProbeWindow).__m5aGame.registry.get('state')))
    .toEqual(expected.state);
});

for (const stage of ['rolling', 'result']) {
  test(`exit during ${stage} never resurrects HUD or movement`, async ({ page }) => {
    await start(page);
    await roll(page);
    await expect(page.getByTestId('dice-roll')).toHaveAttribute('data-stage', stage);
    await page.getByTestId('menu-button').click();
    await page.locator('[data-action="exit"]').click();
    await expect(page.getByTestId('screen-title')).toBeVisible();
    // Bounded wait intentionally spans the old timer deadline: stale continuation probe.
    await page.waitForTimeout(2500);
    await expect(page.getByTestId('screen-title')).toBeVisible();
    await expect(page.getByTestId('screen-board')).toHaveCount(0);
    await expect(page.getByTestId('dice-roll')).toHaveCount(0);
    await expect(page.getByTestId('last-roll-chip')).toHaveCount(0);
    expect((await trace(page)).moves).toEqual([]);
    await page.locator('[data-action="new"]').click();
    await page.locator('#setup-form button[type="submit"]').click();
    await page.waitForFunction(() => window.__db?.art.boardReady);
    await expect(page.getByTestId('last-roll-chip')).toHaveCount(0);
  });
}

test('bot roll at normal speed shows truth and enters movement without a dice wait', async ({
  page,
}) => {
  const initial = saved();
  initial.phase = { kind: 'endOfTurn' };
  initial.players[1]!.control = 'bot';
  initial.players[1]!.personality = 'greedy';
  initial.players[1]!.forcedRoll = 4;
  await start(page, initial);
  await page.getByTestId('action-endTurn').click();
  await expect(page.getByTestId('last-roll-chip')).toHaveText('Rolled 4');
  await expect(page.getByTestId('dice-roll')).toHaveAttribute('data-stage', 'result');
  const evidence = await trace(page);
  const result = evidence.stages.find((entry) => entry.stage === 'result')!;
  const moving = evidence.moves.find((entry) =>
    entry.events.some((event) => event.type === 'DiceRolled'),
  )!;
  expect(moving).toBeDefined();
  expect(moving.at - result.at).toBeLessThan(150);
  expect(evidence.stages.some((entry) => entry.stage === 'rolling')).toBe(false);
});

test('real online roll at normal speed has static badge and no added dice wait', async ({
  page,
  browser,
}, info) => {
  await observeBoardGame(page);
  await page.goto('http://127.0.0.1:8787/?speed=1');
  await page.getByTestId('online-create').click();
  await page.getByTestId('online-name').fill('Alice');
  await page.getByTestId('online-create-submit').click();
  await expect(page.getByTestId('screen-lobby')).toBeVisible();
  const code = (await page.locator('.room-code strong').textContent())!.trim();
  const context = await browser.newContext({
    storageState: 'e2e/storage-state.json',
    viewport: info.project.use.viewport,
  });
  try {
    const guest = await context.newPage();
    await guest.goto(`http://127.0.0.1:8787/r/${code}?speed=1`);
    await guest.getByTestId('online-name').fill('Bob');
    await guest.getByTestId('online-join-submit').click();
    await expect(guest.getByTestId('screen-lobby')).toBeVisible();
    await page.getByTestId('lobby-start').click();
    await page.waitForFunction(() => window.__db?.art.boardReady);
    await installTrace(page, true);
    await page.getByTestId('action-roll').click();
    await expect(page.getByTestId('last-roll-chip')).toBeVisible();
    await expect(page.getByTestId('dice-roll')).toHaveAttribute('data-stage', 'result');
    await expect.poll(async () => (await trace(page)).moves.length).toBeGreaterThan(0);
    const evidence = await trace(page);
    const result = evidence.stages.find((entry) => entry.stage === 'result')!;
    const moving = evidence.moves.find((entry) =>
      entry.events.some((event) => event.type === 'DiceRolled'),
    )!;
    expect(moving.at - result.at).toBeLessThan(150);
    expect(evidence.stages.some((entry) => entry.stage === 'rolling')).toBe(false);
    const authoritative = moving.events.find((event) => event.type === 'DiceRolled')!;
    await expect(page.getByTestId('last-roll-chip')).toContainText(
      String(authoritative.params.value),
    );
    await expect
      .poll(() => page.evaluate(() => (window as ProbeWindow).__m5aGame.registry.get('state')))
      .toEqual(await page.evaluate(() => window.__db!.getState()));
  } finally {
    await context.close();
  }
});
