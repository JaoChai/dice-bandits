import { expect, test, type WebSocketRoute } from '@playwright/test';
import type { ServerMsg } from '@dice-bandits/room';

type ReconnectProbe = {
  sockets: WebSocket[];
  opened: number[];
  closed: number[];
  messages: ServerMsg[][];
};
type ProbeWindow = Window & { reconnectProbe: ReconnectProbe };

for (const language of ['th', 'en']) {
  test(`automatically reconnects a real online room and rolls again (${language})`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.log(`Reconnect page error: ${error.message}`);
    });
    const connections: { client: WebSocketRoute; server: WebSocketRoute }[] = [];
    await page.routeWebSocket(/\/api\/rooms\/[^/]+\/ws/, (client) => {
      // Forward every frame unchanged to the real local worker. Only the
      // disconnect is controlled, since client WebSocket.close forbids 1001.
      connections.push({ client, server: client.connectToServer() });
    });
    await page.addInitScript(() => {
      const probe: ReconnectProbe = { sockets: [], opened: [], closed: [], messages: [] };
      (window as ProbeWindow).reconnectProbe = probe;
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          if (!new URL(url, location.href).pathname.startsWith('/api/rooms/')) return;
          const index = probe.sockets.length;
          probe.sockets.push(this);
          probe.messages.push([]);
          this.addEventListener('open', () => probe.opened.push(index));
          this.addEventListener('close', (event) => probe.closed.push(event.code));
          this.addEventListener('message', (event) => {
            probe.messages[index]!.push(JSON.parse(String(event.data)) as ServerMsg);
          });
        }
      };
    });
    await page.goto('http://127.0.0.1:8787/?speed=0');
    await page.locator(`[data-lang="${language}"]`).click();
    await page.getByTestId('online-create').click();
    await page.getByTestId('online-name').fill('Alice');
    await page.getByTestId('online-create-submit').click();
    await expect(page.getByTestId('screen-lobby')).toBeVisible();
    await page.getByTestId('lobby-start').click();
    await expect(page.getByTestId('action-roll')).toBeEnabled();
    await page.waitForFunction(() => window.__db?.art.boardReady);
    const before = await page.evaluate(() => JSON.stringify(window.__db!.getState()));
    const eventText = await page.locator('[data-testid="event-banner"] .event-text').textContent();
    const url = page.url();
    await connections[0]!.client.close({ code: 1001, reason: 'Reconnect regression' });
    await connections[0]!.server.close({ code: 1001, reason: 'Reconnect regression' });
    await expect(page.getByTestId('online-reconnecting')).toBeVisible();
    await page.screenshot({ path: info.outputPath('reconnecting.png') });
    await expect
      .poll(() => page.evaluate(() => (window as ProbeWindow).reconnectProbe.opened.length), {
        timeout: 5000,
      })
      .toBe(2);
    await expect(page.getByTestId('online-reconnecting')).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByTestId('action-roll')).toBeEnabled();
    expect(page.url()).toBe(url);
    const connection = await page.evaluate(() => {
      const probe = (window as ProbeWindow).reconnectProbe;
      return {
        closed: probe.closed,
        welcome: probe.messages[1]!.find((message) => message.type === 'welcome'),
        hasView: probe.messages[1]!.some((message) => message.type === 'view'),
      };
    });
    expect(connection.closed).toEqual([1001]);
    expect(connection.welcome).toMatchObject({ type: 'welcome', seat: 0 });
    expect(connection.hasView).toBe(true);
    // The view-only reconnect commits state, not a new presentation event.
    // Enabled Roll above also proves presentationBusy was restored.
    expect(await page.evaluate(() => JSON.stringify(window.__db!.getState()))).toBe(before);
    await expect(page.getByTestId('dice-roll')).toHaveCount(0);
    await expect(page.getByTestId('last-roll-chip')).toHaveCount(0);
    await expect(page.locator('[data-testid="event-banner"] .event-text')).toHaveText(eventText!);
    await expect(page.locator('.game-toast')).toHaveCount(0);
    await page.getByTestId('action-roll').click();
    await expect(page.getByTestId('last-roll-chip')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as ProbeWindow).reconnectProbe.messages[1]!.some(
            (message) =>
              message.type === 'events' &&
              message.events.some((event) => event.type === 'DiceRolled' && event.seat === 0),
          ),
        ),
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => JSON.stringify(window.__db!.getState())))
      .not.toBe(before);
    await expect(page.getByTestId('online-error')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('reconnected-roll.png') });
    expect(errors).toEqual([]);
  });
}
