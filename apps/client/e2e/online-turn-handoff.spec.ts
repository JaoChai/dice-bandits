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
        for (let action = 0; action < 80; action++) {
          const state = (await snapshot(host)).controller;
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
                (await Promise.all(buttons.map((button) => button.count()))).some(Boolean),
              {
                intervals: [10, 25, 50],
              },
            )
            .toBe(true);
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
