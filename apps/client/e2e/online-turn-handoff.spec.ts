import { expect, test, type Page } from '@playwright/test';
import { step, type GameState } from '@dice-bandits/engine';
import type { ServerMsg } from '@dice-bandits/room';
import type Phaser from 'phaser';
import { observeBoardGame } from './helpers';

type ProbeWindow = Window & { __m5aGame?: Phaser.Game };
type Frame = Extract<ServerMsg, { type: 'events' | 'view' }>;

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const game = (window as ProbeWindow).__m5aGame!;
    const scene = game.scene.getScene('BoardScene') as Phaser.Scene & {
      latestState: GameState;
    };
    return {
      controller: window.__db!.getState(),
      registry: game.registry.get('state') as GameState,
      board: scene.latestState,
    };
  });
}

test('online speed-1 movement commits both views before ghost playback finishes', async ({
  page: host,
  browser,
}, info) => {
  const context = await browser.newContext({
    storageState: 'e2e/storage-state.json',
    viewport: info.project.use.viewport,
  });
  const evidence: unknown[] = [];
  try {
    const guest = await context.newPage();
    const pages = [host, guest];
    for (const page of pages) {
      await observeBoardGame(page);
      await page.addInitScript(() => {
        const RealSocket = window.WebSocket;
        const probe = window as Window & { __onlineFrames?: Array<{ at: number; message: Frame }> };
        probe.__onlineFrames = [];
        window.WebSocket = class extends RealSocket {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            this.addEventListener('message', (event) => {
              const message = JSON.parse(String(event.data)) as ServerMsg;
              if (message.type === 'events' || message.type === 'view')
                probe.__onlineFrames!.push({ at: performance.now(), message });
            });
          }
        };
      });
    }
    await host.goto('http://127.0.0.1:8787/?speed=0');
    await host.getByTestId('online-create').click();
    await host.getByTestId('online-name').fill('Alice');
    await host.getByTestId('online-create-submit').click();
    await expect(host.getByTestId('screen-lobby')).toBeVisible();
    const code = (await host.locator('.room-code strong').textContent())!.trim();
    await guest.goto(`http://127.0.0.1:8787/r/${code}?speed=0`);
    await guest.getByTestId('online-name').fill('Bob');
    await guest.getByTestId('online-join-submit').click();
    await expect(guest.getByTestId('screen-lobby')).toBeVisible();
    await host.getByTestId('lobby-start').click();
    for (const page of pages) {
      await page.waitForFunction(() => window.__db?.art.boardReady);
      await page.evaluate(() => {
        const probe = window as ProbeWindow & {
          __onlineFrames: Array<{ at: number; message: Frame }>;
          __movementCommits?: Array<{ at: number; state: GameState }>;
          __ghostFrames?: Array<{ at: number; count: number; matched: boolean }>;
        };
        probe.__movementCommits = [];
        probe.__ghostFrames = [];
        const game = probe.__m5aGame!;
        game.events.on('game-state', (state: GameState) =>
          probe.__movementCommits!.push({ at: performance.now(), state }),
        );
        game.events.on('postrender', () => {
          const scene = game.scene.getScene('BoardScene');
          const count = scene.children
            .getChildren()
            .filter((object) => object.name.startsWith('online-movement-')).length;
          if (count)
            probe.__ghostFrames!.push({
              at: performance.now(),
              count,
              matched:
                JSON.stringify(game.registry.get('state')) ===
                JSON.stringify(window.__db!.getState()),
            });
        });
      });
    }
    let measured = false;
    for (let action = 0; action < 40 && !measured; action++) {
      const selector =
        'button[data-choice]:visible:enabled, button[data-action-index]:visible:enabled';
      await expect
        .poll(async () =>
          (await Promise.all(pages.map((p) => p.locator(selector).count()))).some(Boolean),
        )
        .toBe(true);
      const actor = (await host.locator(selector).count()) ? host : guest;
      const attack = actor.getByTestId('pick-attack');
      const leave = actor
        .locator(
          '[data-testid^="shop-leave-"]:visible:enabled, [data-testid="action-leave"]:visible:enabled, [data-testid="action-duel"]:visible:enabled',
        )
        .first();
      const button = (await attack.isVisible())
        ? attack
        : (await leave.count())
          ? leave
          : actor.locator(selector).first();
      const previous = (await snapshot(actor)).controller;
      const moving = ['action-roll', 'action-chooseBranch', 'action-endTurn'].includes(
        (await button.getAttribute('data-testid')) ?? '',
      );
      for (const page of pages)
        await page.evaluate(
          (speed) => {
            window.diceBanditsSpeed = speed;
            const probe = window as Window & {
              __onlineFrames: unknown[];
              __movementCommits: unknown[];
              __ghostFrames: unknown[];
            };
            probe.__onlineFrames.length = 0;
            probe.__movementCommits.length = 0;
            probe.__ghostFrames.length = 0;
          },
          moving ? 1 : 0,
        );
      await button.click();
      for (const page of pages)
        await expect
          .poll(
            async () => {
              const probe = await snapshot(page);
              return (
                JSON.stringify(probe.controller) !== JSON.stringify(previous) &&
                JSON.stringify(probe.board) === JSON.stringify(probe.controller)
              );
            },
            { timeout: 2000 },
          )
          .toBe(true);
      const samples = await Promise.all(
        pages.map((page) =>
          page.evaluate(() => {
            const probe = window as ProbeWindow & {
              __onlineFrames: Array<{ at: number; message: Frame }>;
              __movementCommits: Array<{ at: number; state: GameState }>;
              __ghostFrames: Array<{ at: number; count: number; matched: boolean }>;
            };
            const events = probe.__onlineFrames.flatMap((frame) =>
              frame.message.type === 'events' ? frame.message.events : [],
            );
            const view = probe.__onlineFrames.find((frame) => frame.message.type === 'view');
            const commit = probe.__movementCommits.find(
              (entry) =>
                JSON.stringify(entry.state) ===
                JSON.stringify(view?.message.type === 'view' ? view.message.state : null),
            );
            return {
              moves: events.filter((event) => event.type === 'Moved').length,
              viewToCommitMs: commit && view ? commit.at - view.at : null,
              ghostFrames: probe.__ghostFrames,
              phase: window.__db!.getState().phase.kind,
            };
          }),
        ),
      );
      if (!moving || !samples.every((sample) => sample.moves > 0 && sample.phase !== 'battle'))
        continue;
      console.log('online movement view-to-commit:', JSON.stringify(samples));
      measured = true;
      // The worker may immediately start a bot turn after this human view.
      // Keep this already-started tween intact; future views use speed 0 so
      // the cleanup assertion measures this walk, not an unrelated bot ghost.
      for (const page of pages)
        await page.evaluate(() => {
          window.diceBanditsSpeed = 0;
        });
      for (const [index, page] of pages.entries()) {
        // A real postrender ghost can only appear after the public scene and
        // controller agree. This never injects state, RNG or worker messages.
        await page.waitForFunction(
          () => (window as Window & { __ghostFrames: unknown[] }).__ghostFrames.length > 0,
        );
        const sample = await page.evaluate(
          () => (window as Window & { __ghostFrames: unknown[] }).__ghostFrames,
        );
        expect(sample.length).toBeGreaterThan(0);
        expect(sample.every((frame) => (frame as { matched: boolean }).matched)).toBe(true);
        evidence.push({ ...samples[index], ghostFrames: sample });
        expect(samples[index]!.viewToCommitMs).not.toBeNull();
        expect(samples[index]!.viewToCommitMs!).toBeLessThan(120);
        await page.screenshot({ path: info.outputPath(`online-walk-${index}.png`) });
        await expect
          .poll(
            () =>
              page.evaluate(
                () =>
                  (window as ProbeWindow)
                    .__m5aGame!.scene.getScene('BoardScene')
                    .children.getChildren()
                    .filter((object) => object.name.startsWith('online-movement-')).length,
              ),
            { timeout: 2000 },
          )
          .toBe(0);
        const current = await snapshot(page);
        expect(current.board).toEqual(current.controller);
        const visible = await page.evaluate(() =>
          [
            ...(
              (window as ProbeWindow).__m5aGame!.scene.getScene('BoardScene') as Phaser.Scene & {
                tokenObjects: Map<number, Phaser.GameObjects.Image>;
              }
            ).tokenObjects.values(),
          ].every((token) => token.visible),
        );
        expect(visible).toBe(true);
      }
      expect((await snapshot(host)).controller).toEqual((await snapshot(guest)).controller);
    }
    expect(measured, 'found a real non-battle movement view').toBe(true);
    await info.attach('online-movement-timing.json', {
      body: JSON.stringify(evidence),
      contentType: 'application/json',
    });
  } finally {
    await context.close();
  }
});

for (const language of ['th', 'en']) {
  test(`empty-events Alice to idle Bob handoff commits both real scenes (${language})`, async ({
    page: host,
    browser,
  }, info) => {
    // Private worker RNG can require several real two-browser turns to reach
    // explicit End Turn. CI traces took 24–28s in prep, before context cleanup;
    // allow that setup, not a slower handoff (the scene deadline stays 2000ms).
    test.slow();
    const guestContext = await browser.newContext({
      storageState: 'e2e/storage-state.json',
      viewport: info.project.use.viewport,
    });
    try {
      const guest = await guestContext.newPage();
      const pages = [host, guest];
      const frames: Frame[][] = [[], []];
      const errors: string[] = [];
      for (const [index, page] of pages.entries()) {
        await observeBoardGame(page);
        await page.addInitScript((lang) => localStorage.setItem('lang', lang), language);
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        // Observe only real frames; never fabricate/rewrite worker traffic.
        // Do not retain welcome/session-token messages.
        page.on('websocket', (socket) => {
          socket.on('framereceived', ({ payload }) => {
            const message = JSON.parse(String(payload)) as ServerMsg;
            if (message.type === 'events' || message.type === 'view') frames[index]!.push(message);
          });
        });
      }
      let reached = false;
      // Worker seeds/RNG are private. Ordinary spaces/Leave auto-end turns;
      // advance actual legal choices until Alice has explicit empty End Turn.
      // Bob may act during preparation, but stays idle after the tested handoff.
      // Never fabricate RNG, server frames or game state.
      for (let room = 0; room < 6 && !reached; room++) {
        await host.goto('http://127.0.0.1:8787/?speed=0');
        await host.getByTestId('online-create').click();
        await host.getByTestId('online-name').fill('Alice');
        await host.getByTestId('online-create-submit').click();
        await expect(host.getByTestId('screen-lobby')).toBeVisible();
        const code = (await host.locator('.room-code strong').textContent())!.trim();
        await guest.goto(`http://127.0.0.1:8787/r/${code}?speed=0`);
        await guest.getByTestId('online-name').fill('Bob');
        await guest.getByTestId('online-join-submit').click();
        await expect(guest.getByTestId('screen-lobby')).toBeVisible();
        await host.getByTestId('lobby-start').click();
        await Promise.all(
          pages.map((page) => page.waitForFunction(() => window.__db?.art.boardReady)),
        );
        // Initial/welcome views have no event batch. They must commit without
        // inventing a roll/toast or leaving presentationBusy blocking actions.
        await expect(host.getByTestId('action-roll')).toBeEnabled();
        for (const page of pages) {
          await expect(page.getByTestId('dice-roll')).toHaveCount(0);
          await expect(page.getByTestId('last-roll-chip')).toHaveCount(0);
          await expect(page.locator('[data-testid="event-banner"] .event-text')).toHaveText('');
          await expect(page.locator('.game-toast')).toHaveCount(0);
          const initial = await snapshot(page);
          expect(initial.registry).toEqual(initial.controller);
          expect(initial.board).toEqual(initial.controller);
        }
        for (let action = 0; action < 80; action++) {
          const state = (await snapshot(host)).controller;
          // A finished room cannot supply the empty handoff; try the next room.
          if (state.phase.kind === 'gameOver') break;
          if (state.turnSeat === 0 && state.phase.kind === 'endOfTurn') {
            const next = step(state, { type: 'endTurn' });
            reached = next.events.length === 0 && next.state.turnSeat === 1;
            // Taxes/skipped turns are not this regression; use another room.
            break;
          }
          const buttons = pages.map((page) =>
            page
              .locator(
                'button[data-choice]:visible:enabled, button[data-action-index]:visible:enabled',
              )
              .first(),
          );
          await expect
            .poll(
              async () =>
                (await host.evaluate(() => window.__db!.getState().phase.kind === 'gameOver')) ||
                (await Promise.all(buttons.map((button) => button.count()))).some(Boolean),
              {
                intervals: [10, 25, 50],
              },
            )
            .toBe(true);
          // The final view can arrive while the action-availability poll runs.
          if (await host.evaluate(() => window.__db!.getState().phase.kind === 'gameOver')) break;
          const actor = (await buttons[0]!.count()) ? 0 : 1;
          const page = pages[actor]!;
          const received = frames[actor]!.filter((message) => message.type === 'view').length;
          const attack = page.getByTestId('pick-attack');
          const leave = page
            .locator(
              '[data-testid^="shop-leave-"]:visible:enabled, [data-testid="action-leave"]:visible:enabled, [data-testid="action-duel"]:visible:enabled',
            )
            .first();
          const button = (await attack.isVisible())
            ? attack
            : (await leave.count())
              ? leave
              : buttons[actor]!;
          await button.click();
          await expect
            .poll(() => frames[actor]!.filter((message) => message.type === 'view').length, {
              intervals: [10, 25, 50],
            })
            .toBeGreaterThan(received);
        }
      }
      expect(reached, 'reached an actual Alice to Bob empty End Turn').toBe(true);
      await expect(host.getByTestId('action-endTurn')).toBeEnabled();
      const before = await snapshot(host);
      expect(before.controller).toMatchObject({ turnSeat: 0, phase: { kind: 'endOfTurn' } });
      expect(before.registry).toEqual(before.controller);
      expect(before.board).toEqual(before.controller);
      expect((await snapshot(guest)).controller).toEqual(before.controller);
      const offsets = frames.map((messages) => messages.length);
      const handoffStarted = performance.now();
      await host.getByTestId('action-endTurn').click();
      await expect
        .poll(() => frames.every((messages, index) => messages.length >= offsets[index]! + 2))
        .toBe(true);
      await info.attach('handoff-frames.json', {
        body: JSON.stringify(frames.map((messages, index) => messages.slice(offsets[index]))),
        contentType: 'application/json',
      });

      for (const [index, page] of pages.entries()) {
        await expect
          .poll(
            async () => {
              const state = await snapshot(page);
              return {
                phase: state.controller.phase.kind,
                turnSeat: state.controller.turnSeat,
                registryMatches:
                  JSON.stringify(state.registry) === JSON.stringify(state.controller),
                boardMatches: JSON.stringify(state.board) === JSON.stringify(state.controller),
              };
            },
            { timeout: 2000 },
          )
          .toEqual({ phase: 'awaitRoll', turnSeat: 1, registryMatches: true, boardMatches: true });
        console.log(
          `empty handoff ${language} client ${index}: ${(performance.now() - handoffStarted).toFixed(1)} ms (existing 2000 ms deadline)`,
        );
        const received = frames[index]!.slice(offsets[index]);
        expect(received.map((message) => message.type)).toEqual(['events', 'view']);
        expect(received[0]).toMatchObject({ type: 'events', events: [] });
        expect(received[1]).toMatchObject({
          type: 'view',
          state: { turnSeat: 1, phase: { kind: 'awaitRoll' } },
        });
        await expect(page.getByTestId('turn-ribbon')).toContainText('Bob');
        await page.screenshot({ path: info.outputPath(`handoff-${index}.png`) });
      }
      expect((await snapshot(host)).controller).toEqual((await snapshot(guest)).controller);
      await expect(guest.getByTestId('action-roll')).toBeEnabled();
      expect(errors).toEqual([]);
    } finally {
      await guestContext.close();
    }
  });
}
