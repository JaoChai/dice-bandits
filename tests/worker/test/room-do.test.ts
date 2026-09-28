import { SELF, env, evictDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

function nextMessage(socket: WebSocket, label = 'unlabeled'): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`WebSocket message timed out: ${label}`));
    }, 1_000);
    const onMessage = (event: MessageEvent) => {
      cleanup();
      resolve(JSON.parse(event.data as string));
    };
    const onError = (event: Event) => {
      cleanup();
      reject(event);
    };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
  });
}

async function createRoom(name = 'Host') {
  const response = await SELF.fetch('https://example.com/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return {
    response,
    body: (await response.json()) as { code: string; seat: number; token: string },
  };
}

async function connect(code: string, token?: string) {
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return SELF.fetch(
    new Request(`https://example.com/api/rooms/${code}/ws${query}`, {
      headers: { Upgrade: 'websocket' },
    }),
  );
}

async function send(socket: WebSocket, message: object) {
  const received = nextMessage(socket, `send:${String((message as { type?: unknown }).type)}`);
  socket.send(JSON.stringify(message));
  return received;
}

const closeSocket = (socket: WebSocket | null | undefined) => socket?.close();

describe('Room Durable Object and Worker routes', () => {
  it('rejects an invalid room name at the Worker route', async () => {
    const response = await SELF.fetch('https://example.com/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'online.error.badName' });
  });

  it('creates, joins, starts, and round-trips a legal game action', async () => {
    const created = await createRoom();
    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({ seat: 0 });
    const hostResponse = await connect(created.body.code, created.body.token);
    expect(hostResponse.status).toBe(101);
    const host = hostResponse.webSocket!;
    host.accept();
    expect(await nextMessage(host, 'host-after-connect')).toMatchObject({
      type: 'welcome',
      seat: 0,
    });
    expect(await nextMessage(host, 'host-after-connect')).toMatchObject({ type: 'lobby' });

    const hostConnectLobby = nextMessage(host, 'host-after-connect');
    const guestResponse = await connect(created.body.code);
    const guest = guestResponse.webSocket!;
    guest.accept();
    expect(await nextMessage(guest)).toMatchObject({ type: 'lobby' });
    expect(await hostConnectLobby).toMatchObject({ type: 'lobby' });
    const hostJoinLobby = nextMessage(host, 'host-after-join');
    expect(await send(guest, { type: 'join', name: 'Guest' })).toMatchObject({
      type: 'welcome',
      seat: 1,
      token: expect.any(String),
    });
    expect(await hostJoinLobby).toMatchObject({ type: 'lobby' });
    const guestViewPromise = nextMessage(guest, 'guest-start');
    const hostStart = await send(host, { type: 'start' });
    expect(['events', 'view']).toContain(hostStart.type);
    const hostView = (
      hostStart.type === 'view' ? hostStart : await nextMessage(host, 'host-start-view')
    ) as {
      type: string;
      turn: number;
      legal: object[];
    };
    expect(hostView.type).toBe('view');
    const guestStart = await guestViewPromise;
    const guestView =
      guestStart.type === 'view' ? guestStart : await nextMessage(guest, 'guest-start-view');
    expect(guestView).toMatchObject({ type: 'view', you: 1 });
    expect(hostView.legal.length).toBeGreaterThan(0);
    const actionResult = await send(host, {
      type: 'action',
      action: hostView.legal[0],
      turn: hostView.turn,
    });
    expect(actionResult.type).not.toBe('error');
    if (actionResult.type === 'events')
      expect(await nextMessage(host, 'action-result-view')).toMatchObject({ type: 'view', you: 0 });
    host.close();
    guest.close();
  });

  it('rejects unknown and oversized protocol messages', async () => {
    const created = await createRoom('Protocol');
    const response = await connect(created.body.code, created.body.token);
    const socket = response.webSocket!;
    socket.accept();
    await nextMessage(socket, 'protocol welcome');
    await nextMessage(socket, 'protocol lobby');
    expect(await send(socket, { type: 'unknown' })).toEqual({
      type: 'error',
      key: 'online.error.invalidRequest',
    });
    const oversized = nextMessage(socket, 'oversized message');
    socket.send(JSON.stringify({ type: 'join', name: 'x'.repeat(5_000) }));
    expect(await oversized).toEqual({ type: 'error', key: 'online.error.invalidRequest' });
    socket.close();
  });

  it('restores room state after Durable Object eviction', async () => {
    const created = await createRoom('Persist');
    const stub = env.ROOM.getByName(created.body.code);
    const first = await connect(created.body.code, created.body.token);
    first.webSocket!.accept();
    await nextMessage(first.webSocket!);
    await nextMessage(first.webSocket!);
    await evictDurableObject(stub);
    const reconnect = await connect(created.body.code, created.body.token);
    expect(reconnect.status).toBe(101);
    reconnect.webSocket!.accept();
    expect(await nextMessage(reconnect.webSocket!)).toMatchObject({ type: 'welcome', seat: 0 });
    expect(await nextMessage(reconnect.webSocket!)).toMatchObject({ type: 'lobby' });
    closeSocket(first.webSocket);
    closeSocket(reconnect.webSocket);
  });

  it('rejects an unknown room with WebSocket close code 4404', async () => {
    const response = await connect('ZZZZZ');
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.accept();
    expect(await nextMessage(socket)).toMatchObject({
      type: 'error',
      key: 'online.error.notFound',
    });
    const closed = new Promise<number>((resolve) =>
      socket.addEventListener('close', (event) => resolve(event.code), { once: true }),
    );
    expect(await closed).toBe(4404);
  });

  it('shows bot takeover after ROOM_IDLE_MS elapses', async () => {
    const created = await createRoom('Idle');
    const stub = env.ROOM.getByName(created.body.code);
    const response = await connect(created.body.code, created.body.token);
    const host = response.webSocket!;
    host.accept();
    await nextMessage(host, 'idle welcome');
    await nextMessage(host, 'idle lobby');
    const started = await send(host, { type: 'start' });
    if (started.type !== 'view') await nextMessage(host, 'idle start view');

    const takeover = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Idle takeover was not broadcast')), 1_000);
      const onMessage = (event: MessageEvent) => {
        const message = JSON.parse(event.data as string) as Record<string, unknown>;
        const seats = message.seats as Array<{ seat: number; controller: string }> | undefined;
        if (
          message.type === 'view' &&
          seats?.some((seat) => seat.seat === 0 && seat.controller === 'botTakeover')
        ) {
          clearTimeout(timeout);
          host.removeEventListener('message', onMessage);
          resolve(message);
        }
      };
      host.addEventListener('message', onMessage);
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    await runDurableObjectAlarm(stub);
    expect(await takeover).toMatchObject({
      type: 'view',
      seats: expect.arrayContaining([
        expect.objectContaining({ seat: 0, controller: 'botTakeover' }),
      ]),
    });
    host.close();
  });

  it('keeps a reconnected seat alive when the older socket closes late', async () => {
    const created = await createRoom('Reconnect');
    const stub = env.ROOM.getByName(created.body.code);
    const olderResponse = await connect(created.body.code, created.body.token);
    const older = olderResponse.webSocket!;
    older.accept();
    await nextMessage(older, 'older welcome');
    await nextMessage(older, 'older lobby');

    const olderClosed = new Promise<number>((resolve) =>
      older.addEventListener('close', (event) => resolve(event.code), { once: true }),
    );
    const newerResponse = await connect(created.body.code, created.body.token);
    const newer = newerResponse.webSocket!;
    newer.accept();
    await nextMessage(newer, 'newer welcome');
    await nextMessage(newer, 'newer lobby');
    expect(await olderClosed).toBe(4000);

    await new Promise((resolve) => setTimeout(resolve, 75));
    await runDurableObjectAlarm(stub);
    expect(newer.readyState).toBe(WebSocket.OPEN);
    const visitorResponse = await connect(created.body.code);
    const visitor = visitorResponse.webSocket!;
    visitor.accept();
    expect(await nextMessage(visitor, 'room still exists after stale close')).toMatchObject({
      type: 'lobby',
      seats: expect.arrayContaining([expect.objectContaining({ seat: 0, connected: true })]),
    });
    visitor.close();
    newer.close();
  });

  it('closes the previous seat socket when a newer socket attaches', async () => {
    const created = await createRoom('OneSocket');
    const olderResponse = await connect(created.body.code, created.body.token);
    const older = olderResponse.webSocket!;
    older.accept();
    await nextMessage(older, 'older socket welcome');
    await nextMessage(older, 'older socket lobby');

    const olderClosed = new Promise<number>((resolve) =>
      older.addEventListener('close', (event) => resolve(event.code), { once: true }),
    );
    const newerResponse = await connect(created.body.code, created.body.token);
    const newer = newerResponse.webSocket!;
    newer.accept();
    expect(await nextMessage(newer, 'newer socket welcome')).toMatchObject({
      type: 'welcome',
      seat: 0,
    });
    expect(await nextMessage(newer, 'newer socket lobby')).toMatchObject({ type: 'lobby' });
    expect(await olderClosed).toBe(4000);
    newer.close();
  });

  it('closes an open seat socket when a visitor claims its bot-taken-over seat', async () => {
    const created = await createRoom('Claim');
    const stub = env.ROOM.getByName(created.body.code);
    const hostResponse = await connect(created.body.code, created.body.token);
    const host = hostResponse.webSocket!;
    host.accept();
    await nextMessage(host, 'claim host welcome');
    await nextMessage(host, 'claim host lobby');
    const started = await send(host, { type: 'start' });
    if (started.type !== 'view') await nextMessage(host, 'claim game start view');

    await new Promise((resolve) => setTimeout(resolve, 75));
    await runDurableObjectAlarm(stub);
    let hostViewCount = 0;

    const visitorResponse = await connect(created.body.code);
    const visitor = visitorResponse.webSocket!;
    visitor.accept();
    hostViewCount = 0;
    const onHostMessage = () => {
      hostViewCount++;
    };
    host.addEventListener('message', onHostMessage);
    const hostClosed = new Promise<number>((resolve) =>
      host.addEventListener('close', (event) => resolve(event.code), { once: true }),
    );
    expect(await send(visitor, { type: 'claim', seat: 0 })).toMatchObject({
      type: 'welcome',
      seat: 0,
      token: expect.any(String),
    });
    expect(await nextMessage(visitor, 'claimed seat view')).toMatchObject({ type: 'view', you: 0 });
    expect(await hostClosed).toBe(4000);
    host.removeEventListener('message', onHostMessage);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hostViewCount).toBe(0);
    visitor.close();
  });

  it('disconnects a seat when its only socket closes', async () => {
    const created = await createRoom('Disconnect');
    const hostResponse = await connect(created.body.code, created.body.token);
    const host = hostResponse.webSocket!;
    host.accept();
    await nextMessage(host, 'disconnect host welcome');
    await nextMessage(host, 'disconnect host lobby');

    const visitorResponse = await connect(created.body.code);
    const visitor = visitorResponse.webSocket!;
    visitor.accept();
    await nextMessage(visitor, 'disconnect visitor initial lobby');
    const disconnectedLobby = nextMessage(visitor, 'single socket disconnect');
    host.close();
    expect(await disconnectedLobby).toMatchObject({
      type: 'lobby',
      seats: expect.arrayContaining([expect.objectContaining({ seat: 0, connected: false })]),
    });
    visitor.close();
  });

  it('expires the stored room when the TTL alarm fires', async () => {
    const created = await createRoom('Expiry');
    const stub = env.ROOM.getByName(created.body.code);
    await new Promise((resolve) => setTimeout(resolve, 600));
    await runDurableObjectAlarm(stub);
    const response = await connect(created.body.code, created.body.token);
    const socket = response.webSocket!;
    socket.accept();
    expect(await nextMessage(socket, 'expired-room')).toMatchObject({
      type: 'error',
      key: 'online.error.notFound',
    });
    socket.close();
  });

  it('runs the scheduled Durable Object alarm', async () => {
    const created = await createRoom('Alarm');
    const stub = env.ROOM.getByName(created.body.code);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
  });
});
