import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientMsg, ServerMsg } from '@dice-bandits/room';
import { RoomSocket } from '../src/online/socket';

type SocketHandlers = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
};

class FakeWebSocket implements SocketHandlers {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.({ code: 1000 });
  }

  open(): void {
    this.onopen?.();
  }

  receive(data: string): void {
    this.onmessage?.({ data });
  }

  disconnect(code = 1006): void {
    this.onclose?.({ code });
  }
}

class FakeTimers {
  now = 0;
  nextId = 0;
  tasks = new Map<number, { at: number; callback: () => void }>();
  delays: number[] = [];

  set = (callback: () => void, delay = 0): ReturnType<typeof setTimeout> => {
    const id = ++this.nextId;
    this.delays.push(Number(delay));
    this.tasks.set(id, { at: this.now + Number(delay), callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  clear = (id: ReturnType<typeof setTimeout> | undefined): void => {
    this.tasks.delete(id as unknown as number);
  };

  advance(): void {
    const [id, task] = [...this.tasks.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
    if (id === undefined || !task) throw new Error('No timer scheduled');
    this.tasks.delete(id);
    this.now = task.at;
    task.callback();
  }
}

function socket(
  timers = new FakeTimers(),
  onStatus = vi.fn(),
  onMessage = vi.fn<(message: ServerMsg) => void>(),
) {
  FakeWebSocket.instances = [];
  const roomSocket = new RoomSocket({
    url: 'wss://example.test/api/rooms/ABCDE/ws',
    onMessage,
    onStatus,
    wsFactory: (url) => new FakeWebSocket(url) as unknown as WebSocket,
    timers: { set: timers.set as typeof setTimeout, clear: timers.clear as typeof clearTimeout },
  });
  return { roomSocket, timers, onStatus, onMessage };
}

afterEach(() => vi.restoreAllMocks());

describe('RoomSocket', () => {
  it('backs off 1, 2, 4, 8, then caps at 10 seconds and resets after opening', () => {
    const { roomSocket, timers } = socket();
    const firstSocket = FakeWebSocket.instances[0];
    firstSocket?.disconnect();
    expect(timers.delays.at(-1)).toBe(1000);
    timers.advance();
    FakeWebSocket.instances.at(-1)?.disconnect();
    expect(timers.delays.at(-1)).toBe(2000);
    timers.advance();
    FakeWebSocket.instances.at(-1)?.disconnect();
    expect(timers.delays.at(-1)).toBe(4000);
    timers.advance();
    FakeWebSocket.instances.at(-1)?.disconnect();
    expect(timers.delays.at(-1)).toBe(8000);
    timers.advance();
    FakeWebSocket.instances.at(-1)?.disconnect();
    expect(timers.delays.at(-1)).toBe(10000);
    timers.advance();
    FakeWebSocket.instances.at(-1)?.disconnect();
    expect(timers.delays.at(-1)).toBe(10000);
    timers.advance();
    FakeWebSocket.instances.at(-1)?.open();
    FakeWebSocket.instances.at(-1)?.disconnect();
    expect(timers.delays.at(-1)).toBe(1000);
    roomSocket.close();
  });

  it('queues messages while disconnected and flushes them in order on reopen', () => {
    const { roomSocket, timers } = socket();
    const first: ClientMsg = { type: 'reclaim' };
    const second: ClientMsg = { type: 'start' };
    const firstSocket = FakeWebSocket.instances[0];
    roomSocket.send(first);
    firstSocket?.open();
    expect(firstSocket?.sent).toEqual([JSON.stringify(first)]);
    firstSocket?.disconnect();
    roomSocket.send(second);
    roomSocket.send({ type: 'setClass', classId: 'mage' });

    timers.advance();
    const replacement = FakeWebSocket.instances[1];
    replacement?.open();

    expect(replacement?.sent).toEqual(
      [second, { type: 'setClass', classId: 'mage' }].map((item) => JSON.stringify(item)),
    );
    roomSocket.close();
  });

  it.each([4404, 4000])('does not reconnect after terminal close code %i', (code) => {
    const { roomSocket, timers, onStatus } = socket();
    FakeWebSocket.instances[0]?.disconnect(code);

    expect(timers.tasks.size).toBe(0);
    expect(onStatus).toHaveBeenLastCalledWith('closed');
    roomSocket.close();
  });

  it('does not reconnect after close() and ignores malformed server JSON', () => {
    const { roomSocket, timers, onMessage } = socket();
    const ws = FakeWebSocket.instances[0];
    ws?.open();
    expect(() => ws?.receive('{bad json')).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
    ws?.disconnect();
    expect(timers.tasks.size).toBe(1);

    roomSocket.close();

    expect(timers.tasks.size).toBe(0);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
