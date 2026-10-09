import { expect, test } from '@playwright/test';
import type { GameState } from '@dice-bandits/engine';
import type { ServerMsg } from '@dice-bandits/room';
import type Phaser from 'phaser';
import recorded from './fixtures/online-battle-swap.json' with { type: 'json' };
import { observeBoardGame } from './helpers';

// QA journey 3/action 24: unchanged public Worker views/events only, never
// welcome/session traffic. Bob/mushroom ends, Bot3/town resolves, Bot4/Bob starts.
const before = recorded.before as unknown as Extract<ServerMsg, { type: 'view' }>;
const after = recorded.after as unknown as Extract<ServerMsg, { type: 'view' }>;
type ReplayWindow = Window & {
  __m5aGame: Phaser.Game;
  __swapSocket: WebSocket;
  __sendRecorded: (message: ServerMsg) => void;
};

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 915, height: 412 },
  { width: 932, height: 388 },
]) {
  test(`online battle swap reconciles HP immediately without another battle's secret ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await observeBoardGame(page);
    await page.addInitScript(() => {
      localStorage.setItem('lang', 'en');
      const Native = WebSocket;
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          (window as ReplayWindow).__swapSocket = this;
        }
      };
    });
    await page.goto('http://127.0.0.1:8787/?speed=1');
    await page.getByTestId('online-create').click();
    await page.getByTestId('online-name').fill('ReplayQA');
    await page.getByTestId('online-create-submit').click();
    await expect(page.getByTestId('screen-lobby')).toBeVisible();
    const code = (await page.locator('.room-code strong').textContent())!.trim();
    await page.getByTestId('lobby-start').click();
    await page.waitForFunction(() => window.__db?.art.boardReady);
    await page.goto(`http://127.0.0.1:8787/r/${code}?speed=1`);
    await page.waitForFunction(() => window.__db?.art.boardReady);
    await page.evaluate(() => {
      const probe = window as ReplayWindow;
      const socket = probe.__swapSocket;
      const handler = socket.onmessage!;
      // Replay through the real, already-authenticated receiver, not through
      // engine/controller setters. Ignore later live frames for this replay.
      socket.onmessage = (event) => {
        if (!event.isTrusted) handler.call(socket, event);
      };
      probe.__sendRecorded = (message) =>
        socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
      window.diceBanditsSpeed = 1;
    });
    await page.evaluate((message) => (window as ReplayWindow).__sendRecorded(message), before);
    await page.waitForFunction(
      (state) => JSON.stringify(window.__db!.getState()) === JSON.stringify(state),
      before.state,
    );
    await page.waitForFunction(() => window.__db?.art.battleReady);
    await page.evaluate(
      (messages) => {
        for (const message of messages) (window as ReplayWindow).__sendRecorded(message);
      },
      [...recorded.events, after] as unknown as ServerMsg[],
    );
    await page.waitForFunction(
      (state) => JSON.stringify(window.__db!.getState()) === JSON.stringify(state),
      after.state,
    );
    const early = await page.evaluate(() => ({
      state: window.__db!.getState(),
      registry: (window as ReplayWindow).__m5aGame.registry.get('state') as GameState,
      names: [...document.querySelectorAll('.battle-hp-card strong')].map((e) => e.textContent),
      hp: [...document.querySelectorAll('.battle-hp-value')].map((e) => e.textContent),
      readout: document.querySelector('[data-testid="battle-readout"]')?.textContent ?? '',
      enabled: document.querySelectorAll('[data-action-index]:not(:disabled)').length,
    }));
    await page.screenshot({ path: info.outputPath('battle-swap-early.png') });
    // Sample every rendered frame through the former 650ms settling period:
    // a late drain/result or canceled callback must not restore old numbers.
    const frames = await page.evaluate(
      () =>
        new Promise<Array<{ hp: (string | null)[]; readout: string }>>((resolve) => {
          const start = performance.now();
          const samples: Array<{ hp: (string | null)[]; readout: string }> = [];
          const sample = () => {
            samples.push({
              hp: [...document.querySelectorAll('.battle-hp-value')].map((e) => e.textContent),
              readout: document.querySelector('[data-testid="battle-readout"]')?.textContent ?? '',
            });
            if (performance.now() - start >= 650) resolve(samples);
            else requestAnimationFrame(sample);
          };
          sample();
        }),
    );
    console.log(
      `battle swap ${viewport.width}x${viewport.height}: early=${early.hp.join(',')} readout=${early.readout}; sampledFrames=${frames.length}`,
    );
    expect(early.state).toEqual(after.state);
    expect(early.registry).toEqual(after.state);
    expect(early.enabled).toBe(after.legal.length);
    expect(early.names).toEqual(['Bot 4', 'Bob']);
    expect
      .soft(early.hp, 'new names must never inherit the old battle HP/maxima')
      .toEqual(['26/50', '29/34']);
    expect
      .soft(early.readout, 'Bot3 Pickpocket does not belong to Bot4/Bob')
      .not.toContain('Pickpocket');
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((frame) => frame.hp.join(',') === '26/50,29/34')).toBe(true);
    expect(frames.every((frame) => !frame.readout.includes('Pickpocket'))).toBe(true);
    await info.attach('battle-swap-display', {
      body: JSON.stringify({ names: early.names, hp: early.hp, readout: early.readout, frames }),
      contentType: 'application/json',
    });
  });
}
