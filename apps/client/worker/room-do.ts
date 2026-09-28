interface RoomStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
}

interface RoomState {
  storage: RoomStorage;
  acceptWebSocket(socket: WebSocket): void;
}

declare const WebSocketPair: new () => { 0: WebSocket; 1: WebSocket };

export class Room {
  private readonly ctx: RoomState;

  constructor(ctx: RoomState) {
    this.ctx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/_probe/counter') {
      const counter = (await this.ctx.storage.get<number>('counter')) ?? 0;
      const nextCounter = counter + 1;
      await this.ctx.storage.put('counter', nextCounter);
      return new Response(String(nextCounter));
    }

    if (url.pathname === '/_probe/alarm') {
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
      return new Response('alarm scheduled');
    }

    if (url.pathname === '/ws' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      return new Response(null, {
        status: 101,
        webSocket: client,
      } as ResponseInit & { webSocket: WebSocket });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    const parsed: unknown = JSON.parse(message);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'type' in parsed &&
      parsed.type === 'echo' &&
      'data' in parsed
    ) {
      socket.send(JSON.stringify({ type: 'echo', data: parsed.data }));
    }
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.put('alarmFired', true);
  }
}
