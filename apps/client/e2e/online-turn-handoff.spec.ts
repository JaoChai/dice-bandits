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

for (const language of ['th', 'en']) {
  test(`empty-events Alice to idle Bob handoff commits both real scenes (${language})`, async ({
    page: host,
    browser,
  }, info) => {
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
      // Worker seeds/RNG are private. Play actual choices; a shop route ends
      // through Leave instead of explicit End Turn, so use another real room
      // for that route. Never fabricate RNG, server frames or game state.
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
        for (let action = 0; action < 40; action++) {
          const state = (await snapshot(host)).controller;
          if (state.turnSeat !== 0 || state.phase.kind === 'shop') break;
          if (state.phase.kind === 'endOfTurn') {
            const next = step(state, { type: 'endTurn' });
            reached = next.events.length === 0 && next.state.turnSeat === 1;
            break;
          }
          const received = frames[0]!.filter((message) => message.type === 'view').length;
          const dialog = host.locator('button[data-choice]:visible:enabled').first();
          const tray = host.locator('button[data-action-index]:visible:enabled').first();
          await ((await dialog.count()) ? dialog : tray).click();
          await expect
            .poll(() => frames[0]!.filter((message) => message.type === 'view').length, {
              intervals: [10, 25, 50],
            })
            .toBeGreaterThan(received);
          await expect
            .poll(async () => JSON.stringify((await snapshot(host)).controller), {
              intervals: [10, 25, 50],
            })
            .not.toBe(JSON.stringify(state));
        }
      }
      expect(reached, 'reached an actual first-turn empty End Turn; Bob never acts').toBe(true);
      await expect(host.getByTestId('action-endTurn')).toBeEnabled();
      const before = await snapshot(host);
      expect(before.controller).toMatchObject({ turnSeat: 0, phase: { kind: 'endOfTurn' } });
      expect(before.registry).toEqual(before.controller);
      expect(before.board).toEqual(before.controller);
      expect((await snapshot(guest)).controller).toEqual(before.controller);
      const offsets = frames.map((messages) => messages.length);
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
