import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  chooseAction,
  createGame,
  legalActions,
  step,
  type Action,
  type GameEvent,
  type GameState,
} from '@dice-bandits/engine';
import type Phaser from 'phaser';
import { writeFile } from 'node:fs/promises';
import { TUTORIAL_SCRIPT } from '../src/tutor/script';
import { assertInside, assertNoEllipsis, observeBoardGame } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

type Result = {
  events: GameEvent[];
  state: GameState;
  started: number;
  committed: number | null;
  learned: number;
};
type PracticeProbe = Window & {
  __m5aGame: Phaser.Game;
  __practiceResults: Result[];
  __practiceCollisions: string[];
};

// Observe the shipped scene's real arguments and post-presentation commits.
// The wrapper neither replaces state/events nor changes any timer or promise.
async function observeResults(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = window as unknown as PracticeProbe;
    probe.__practiceResults = [];
    probe.__practiceCollisions = [];
    const game = probe.__m5aGame;
    const board = game.scene.getScene('BoardScene') as Phaser.Scene & {
      playEvents(events: GameEvent[]): Promise<void>;
    };
    const play = board.playEvents;
    board.playEvents = function (events) {
      if (probe.__practiceResults.at(-1)?.committed === null)
        probe.__practiceCollisions.push('next result started before prior presentation committed');
      probe.__practiceResults.push({
        events: structuredClone(events),
        state: structuredClone(window.__db!.getState()),
        started: performance.now(),
        committed: null,
        learned: Number(document.querySelector('.practice-track')?.getAttribute('aria-valuenow')),
      });
      return play.call(this, events);
    };
    game.events.on('game-state', (state: GameState) => {
      const result = probe.__practiceResults.at(-1);
      if (!result || result.committed !== null) {
        probe.__practiceCollisions.push('unexpected or duplicate commit');
        return;
      }
      if (JSON.stringify(state) !== JSON.stringify(result.state))
        probe.__practiceCollisions.push('state advanced during presentation');
      result.committed = performance.now();
    });
  });
}

async function snapshot(page: Page, name: string, info: TestInfo): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await assertInside(page, '.practice-topbar');
  const dialog = page.locator('.practice-invitation');
  if (await dialog.count()) {
    await assertInside(page, '.practice-invitation');
    await assertNoEllipsis(page, '.practice-invitation');
  } else {
    await assertInside(page, '[data-testid="practice-coach"]');
    await assertNoEllipsis(page, '[data-testid="practice-coach"]');
    await expect(page.locator('.practice-highlight')).toHaveCount(1);
    await assertInside(page, '.practice-highlight');
    const control = await page.locator('.practice-highlight').evaluate((element) => {
      const r = element.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const coach = document
        .querySelector('[data-testid="practice-coach"]')!
        .getBoundingClientRect();
      return {
        width: r.width,
        height: r.height,
        hit: top === element || element.contains(top),
        overlap:
          Math.max(0, Math.min(r.right, coach.right) - Math.max(r.left, coach.left)) *
          Math.max(0, Math.min(r.bottom, coach.bottom) - Math.max(r.top, coach.top)),
      };
    });
    expect(control.width).toBeGreaterThanOrEqual(44);
    expect(control.height).toBeGreaterThanOrEqual(44);
    expect(control.hit).toBe(true);
    expect(control.overlap).toBe(0);
  }
  const screenshot = info.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot });
  await info.attach(name, { path: screenshot, contentType: 'image/png' });
  if (!process.env.AXE_SOURCE) {
    info.annotations.push({ type: 'axe-not-run', description: `${name}: AXE_SOURCE not supplied` });
    return;
  }
  await page.addScriptTag({ path: process.env.AXE_SOURCE });
  const audit = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: { run(): Promise<{ violations: { id: string; impact: string }[] }> };
      }
    ).axe;
    return axe.run();
  });
  await info.attach(`${name}-axe`, {
    body: JSON.stringify(audit),
    contentType: 'application/json',
  });
  expect(audit.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
}

function controlId(action: Action): string | null {
  if (action.type === 'pvpReward') return null; // Real reward rows use data-choice.
  if (action.type === 'battlePick') return `pick-${action.pick}`;
  if (action.type === 'pickPerk') return `perk-${action.perk}`;
  if (action.type === 'shopBuy') return `shop-shopBuy-${action.item}`;
  if (action.type === 'leave') return 'shop-leave-leave';
  if (action.type === 'chooseBranch') return `action-chooseBranch-${action.to}`;
  if (action.type === 'duel' && action.target !== null) return `action-duel-${action.target}`;
  return `action-${action.type}`;
}

async function runJourney(
  page: Page,
  info: TestInfo,
  { reduced = false, short = false }: { reduced?: boolean; short?: boolean } = {},
): Promise<void> {
  const speed = 0;
  const lang = short || info.project.name === 'mobile-landscape' ? 'th' : 'en';
  if (short) await page.setViewportSize({ width: 932, height: 388 });
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const errors: string[] = [];
  const network: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('request', (r) => {
    if (/\/api\/rooms|\/r\/[A-Z0-9]{5}/i.test(r.url())) network.push(r.url());
  });
  page.on('websocket', (socket) => network.push(socket.url()));
  await page.addInitScript((locale) => {
    localStorage.setItem('lang', locale);
    localStorage.setItem('dice-bandits:intro-seen', '1');
    localStorage.setItem('dice-bandits:tips', '{"enabled":true,"seen":[]}');
  }, lang);
  await observeBoardGame(page);
  await page.goto(`/?speed=${speed}`);
  await page.getByTestId('title-practice').click();
  await expect(page.getByTestId('practice-begin')).toBeFocused();
  const invitationPath = info.outputPath('invitation.png');
  await page.screenshot({ path: invitationPath });
  await info.attach('invitation', { path: invitationPath, contentType: 'image/png' });
  // These fault injections exercise assertion sensitivity only; never enabled by CI.
  if (process.env.PRACTICE_MUTATION === 'missing-entry')
    await page.getByTestId('practice-begin').evaluate((element) => element.remove());
  await expect(page.getByTestId('practice-begin')).toBeVisible();
  await page.getByTestId('practice-begin').click();
  await page.waitForFunction(() => window.__db?.art.boardReady);
  expect(await page.evaluate(() => window.__db!.getState())).toEqual(
    createGame(TUTORIAL_SCRIPT.config),
  );
  await observeResults(page);
  await snapshot(page, 'first-roll', info);
  await expect(page.getByTestId('action-roll')).toBeFocused();
  await page.getByTestId(lang === 'th' ? 'practice-en' : 'practice-th').click();
  await expect(page.locator('html')).toHaveAttribute('lang', lang === 'th' ? 'en' : 'th');
  await page.getByTestId(lang === 'th' ? 'practice-th' : 'practice-en').click();
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  if (reduced) {
    expect(
      await page
        .locator('.practice-highlight')
        .evaluate((node) => getComputedStyle(node).animationName),
    ).toBe('none');
  }

  let state = createGame(TUTORIAL_SCRIPT.config);
  const expected = TUTORIAL_SCRIPT.replay.map((entry) => {
    expect(legalActions(state, entry.seat)).toContainEqual(entry.action);
    if (entry.seat === 1) expect(chooseAction(state, entry.seat)).toEqual(entry.action);
    const result = step(state, entry.action);
    state = result.state;
    return result;
  });
  const started = Date.now();
  let humanClicks = 0;

  const frames = new Set<string>();

  for (const [index, entry] of TUTORIAL_SCRIPT.replay.entries()) {
    if (entry.seat !== 0) continue;
    await page.waitForFunction(
      () => {
        const button = document.querySelector<HTMLButtonElement>('.practice-highlight');
        return (
          (button && !button.disabled) || document.querySelector('[data-testid="practice-retry"]')
        );
      },
      null,
      { timeout: 20_000 },
    );
    await expect(page.getByTestId('practice-retry')).toHaveCount(0);
    const before = index ? expected[index - 1]!.state : createGame(TUTORIAL_SCRIPT.config);
    expect(await page.evaluate(() => window.__db!.getState())).toEqual(before);
    const highlight = page.locator('.practice-highlight');
    await expect(highlight).toHaveCount(1);
    const id = controlId(entry.action);
    if (id) await expect(highlight).toHaveAttribute('data-testid', id);
    else {
      const rewards = legalActions(before, 0).filter((action) => action.type === 'pvpReward');
      await expect(highlight).toHaveAttribute(
        'data-choice',
        String(rewards.findIndex((a) => JSON.stringify(a) === JSON.stringify(entry.action))),
      );
    }
    await expect(page.getByTestId('dicey-tip')).toHaveCount(0);
    const count = TUTORIAL_SCRIPT.lessons.filter((lesson) => lesson.replayIndex < index).length;
    await expect(page.locator('.practice-track')).toHaveAttribute('aria-valuenow', String(count));
    let frame = before.phase.kind as string;
    if (before.phase.kind === 'battle' && entry.action.type === 'battlePick') {
      frame = before.phase.battle.attackerSide === entry.action.side ? 'battle' : 'defence';
      if (!frames.has('battle')) {
        // A visible legal but noncanonical pick must not bypass the coach.
        const prior = await page.evaluate(() => JSON.stringify(window.__db!.getState()));
        await page.getByTestId('pick-attack').click();
        expect(await page.evaluate(() => JSON.stringify(window.__db!.getState()))).toBe(prior);
        await expect(highlight).toHaveAttribute('data-testid', 'pick-secret');
      }
    }
    if (['battle', 'defence', 'shop', 'pvpReward'].includes(frame) && !frames.has(frame)) {
      frames.add(frame);
      await snapshot(page, frame, info);
      if (frame === 'battle') {
        await page.getByTestId('practice-exit').click();
        await snapshot(page, 'exit-confirmation', info);
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('practice-dialog')).toHaveCount(0);
        expect(await page.evaluate(() => window.__db!.getState())).toEqual(before);
      }
    }
    if (index === 0) await highlight.dblclick();
    else await highlight.click();
    humanClicks++;
  }
  await expect(page.getByTestId('practice-setup')).toBeVisible({ timeout: 20_000 });
  const elapsedMs = Date.now() - started;
  const observed = await page.evaluate(() => ({
    results: (window as unknown as PracticeProbe).__practiceResults,
    collisions: (window as unknown as PracticeProbe).__practiceCollisions,
  }));
  expect(observed.collisions).toEqual([]);
  expect(observed.results).toHaveLength(67);
  expect(humanClicks).toBe(31); // First decision includes a deliberately ignored second click.
  const eventCounts: Record<string, number> = {};
  for (const [index, result] of observed.results.entries()) {
    expect(result.state, `real replay state ${index}`).toEqual(expected[index]!.state);
    expect(result.events, `real engine events ${index}`).toEqual(expected[index]!.events);
    expect(result.committed, `presentation ${index} completed`).not.toBeNull();
    expect(result.learned).toBe(
      TUTORIAL_SCRIPT.lessons.filter((lesson) => lesson.replayIndex <= index).length,
    );
    if (index)
      expect(result.started).toBeGreaterThanOrEqual(observed.results[index - 1]!.committed!);
    for (const event of result.events) eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
  }
  const goalEvents = [
    'DiceRolled',
    'Moved',
    'BranchChosen',
    'GoldGained',
    'BattlePick',
    'ItemBought',
    'TownClaimed',
    'GoldStolen',
  ];
  for (const [index, lesson] of TUTORIAL_SCRIPT.lessons.entries()) {
    expect(
      observed.results[lesson.replayIndex]!.events.some(
        (e) => e.seat === 0 && e.type === goalEvents[index],
      ),
      lesson.topic,
    ).toBe(true);
  }
  expect(state.round).toBe(9); // Robbery in round 8 naturally runs end-turn bookkeeping.
  expect(observed.results.at(-1)!.events).toContainEqual({
    type: 'GoldStolen',
    seat: 0,
    params: { amount: 15 },
  });
  await expect(page.locator('.practice-track')).toHaveAttribute('aria-valuenow', '8');
  await expect(page.locator('.practice-topic.learned')).toHaveCount(8);
  expect(frames).toEqual(new Set(['battle', 'shop', 'defence', 'pvpReward']));
  await snapshot(page, 'completion', info);
  const evidence = {
    lang,
    viewport: page.viewportSize(),
    speed,
    reduced,
    elapsedMs,

    scenePresentationMs: observed.results.reduce((total, r) => total + r.committed! - r.started, 0),
    botGapsMs: observed.results.flatMap((r, i) =>
      i && TUTORIAL_SCRIPT.replay[i]!.seat === 1
        ? [r.started - observed.results[i - 1]!.committed!]
        : [],
    ),
    humanDecisions: humanClicks,
    ignoredDuplicateClicks: 1,
    botActions: 36,
    actions: observed.results.length,
    eventCount: Object.values(eventCounts).reduce((a, b) => a + b, 0),
    eventCounts,
    goals: TUTORIAL_SCRIPT.lessons.map((lesson) => lesson.topic),
    results: observed.results,
  };
  const evidencePath = info.outputPath('practice-journey-evidence.json');
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  await info.attach('practice-journey-evidence', {
    path: evidencePath,
    contentType: 'application/json',
  });
  console.log(
    `Practice ${info.project.name} ${lang} speed=${speed} reduced=${reduced}: ${JSON.stringify({ ...evidence, results: undefined, waits: undefined })}`,
  );
  await page.getByTestId('practice-replay').click();
  await expect(page.locator('.practice-track')).toHaveAttribute('aria-valuenow', '0');
  expect(await page.evaluate(() => window.__db!.getState())).toEqual(
    createGame(TUTORIAL_SCRIPT.config),
  );
  await page.getByTestId('practice-exit').click();
  await page.getByTestId('practice-leave').click();
  await expect(page.getByTestId('title-practice')).toBeFocused();
  expect(network).toEqual([]);
  expect(errors).toEqual([]);
}

test('real highlighted journey proves every frozen event and goal at speed zero', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await runJourney(page, info);
});

test('932x388 TH short-landscape regression follows the real route', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Explicit short viewport, covered once');
  test.setTimeout(90_000);
  await runJourney(page, info, { short: true });
});

test('reduced-motion speed-zero journey retains all eight engine goals', async ({ page }, info) => {
  test.setTimeout(90_000);
  await runJourney(page, info, { reduced: true });
});
