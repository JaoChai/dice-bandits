import { createRoom, parseClientMsg, roomStep, validName } from '@dice-bandits/room';
import type { Room as RoomModel, RoomStepResult } from '@dice-bandits/room';
import type { Outbound, RoomInput, ServerMsg } from '@dice-bandits/room';

interface HibernatableSocket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

interface RoomStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  deleteAll(): Promise<void>;
}

interface RoomContext {
  storage: RoomStorage;
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): HibernatableSocket[];
}

interface RoomEnvironment {
  ROOM_IDLE_MS?: string;
  ROOM_TTL_MS?: string;
}

declare const WebSocketPair: new () => { 0: WebSocket; 1: WebSocket };

interface Attachment {
  conn: string;
  seat: number | null;
}

interface CreatePayload {
  code: string;
  name: string;
  token: string;
}

const ROOM_KEY = 'room';
const notFound = { type: 'error', key: 'online.error.notFound' } satisfies ServerMsg;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomHex(size: number): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(size)));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function closeCodeForNotFound(socket: HibernatableSocket): void {
  socket.send(JSON.stringify(notFound));
  socket.close(4404, 'Room not found');
}

export class Room {
  private readonly ctx: RoomContext;
  private readonly roomEnv: RoomEnvironment;

  constructor(ctx: RoomContext, env: RoomEnvironment) {
    this.ctx = ctx;
    this.roomEnv = env;
  }

  private async load(): Promise<RoomModel | null> {
    return (await this.ctx.storage.get<RoomModel>(ROOM_KEY)) ?? null;
  }

  private attachment(socket: HibernatableSocket): Attachment {
    return (socket.deserializeAttachment() as Attachment | null) ?? { conn: '', seat: null };
  }

  private async save(result: RoomStepResult): Promise<void> {
    if (result.room === null) {
      await this.ctx.storage.deleteAll();
      for (const socket of this.ctx.getWebSockets()) socket.close(4404, 'Room expired');
      return;
    }
    await this.ctx.storage.put(ROOM_KEY, result.room);
    if (result.nextAlarmAt === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(result.nextAlarmAt);
  }

  private async dispatch(
    result: RoomStepResult,
    issuedTokens = new Map<string, string>(),
  ): Promise<void> {
    await this.save(result);
    if (result.room === null) return;
    for (const output of result.out) {
      let targets = this.ctx.getWebSockets();
      if (typeof output.to === 'number') {
        targets = targets.filter((socket) => this.attachment(socket).seat === output.to);
      } else if (typeof output.to === 'object' && output.to !== null) {
        targets = targets.filter(
          (socket) => this.attachment(socket).conn === (output.to as { conn: string }).conn,
        );
      }
      for (const socket of targets) {
        const attachment = this.attachment(socket as HibernatableSocket);
        if (output.msg.type === 'welcome') attachment.seat = output.msg.seat;
        socket.serializeAttachment(attachment);
        const token = issuedTokens.get(attachment.conn);
        const message =
          output.msg.type === 'welcome' && token !== undefined
            ? { ...output.msg, token }
            : output.msg;
        socket.send(JSON.stringify(message));
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/_internal/create' && request.method === 'POST') {
      let payload: CreatePayload;
      try {
        payload = (await request.json()) as CreatePayload;
      } catch {
        return new Response('Bad request', { status: 400 });
      }
      const code = url.searchParams.get('code') ?? payload.code;
      const name = typeof payload.name === 'string' ? validName(payload.name) : null;
      if (
        name === null ||
        !/^[A-Z0-9]{5}$/.test(code ?? '') ||
        !/^[a-f\d]{32}$/.test(payload.token ?? '')
      )
        return new Response('Bad request', { status: 400 });
      if ((await this.load()) !== null) return new Response('Room exists', { status: 409 });
      const idleMs = Number(this.roomEnv.ROOM_IDLE_MS) || 60_000;
      const ttlMs = Number(this.roomEnv.ROOM_TTL_MS) || 86_400_000;
      const room = createRoom(code, name, await sha256Hex(payload.token), Date.now(), {
        idleMs,
        ttlMs,
      });
      await this.ctx.storage.put(ROOM_KEY, room);
      await this.ctx.storage.setAlarm(room.lastActivityAt + ttlMs);
      return Response.json({ ok: true });
    }

    if (url.pathname !== '/ws' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('Not found', { status: 404 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1] as HibernatableSocket;
    this.ctx.acceptWebSocket(server);
    const conn = randomHex(12);
    const existing = await this.load();
    if (existing === null) {
      server.serializeAttachment({ conn, seat: null } satisfies Attachment);
      closeCodeForNotFound(server);
      return new Response(null, { status: 101, webSocket: client } as ResponseInit & {
        webSocket: WebSocket;
      });
    }

    const rawToken = url.searchParams.get('token');
    let seat: number | null = null;
    if (rawToken !== null) {
      const hash = await sha256Hex(rawToken);
      seat = existing.seats.find((candidate) => candidate.tokenHash === hash)?.seat ?? null;
    }
    server.serializeAttachment({ conn, seat } satisfies Attachment);
    const result = roomStep(existing, { kind: 'connect', seat, conn }, Date.now());
    const out: Outbound[] =
      seat === null
        ? result.out
        : [{ to: { conn }, msg: { type: 'welcome', seat } }, ...result.out];
    await this.dispatch({ ...result, out });
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & {
      webSocket: WebSocket;
    });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const room = await this.load();
    if (room === null) {
      closeCodeForNotFound(socket as HibernatableSocket);
      return;
    }
    if (typeof message !== 'string') {
      socket.send(JSON.stringify({ type: 'error', key: 'online.error.invalidRequest' }));
      return;
    }
    const parsed = parseClientMsg(message);
    if (parsed === null) {
      socket.send(JSON.stringify({ type: 'error', key: 'online.error.invalidRequest' }));
      return;
    }
    const attachment = this.attachment(socket as HibernatableSocket);
    let issuedToken: string | undefined;
    let newTokenHash: string | undefined;
    if (parsed.type === 'join' || parsed.type === 'claim') {
      issuedToken = randomHex(16);
      newTokenHash = await sha256Hex(issuedToken);
    }
    const input: RoomInput = {
      kind: 'msg',
      seat: attachment.seat,
      conn: attachment.conn,
      msg: parsed,
      ...(newTokenHash === undefined ? {} : { newTokenHash }),
      ...(parsed.type === 'start' ? { seed: randomHex(16) } : {}),
    };
    const result = roomStep(room, input, Date.now());
    const tokens =
      issuedToken === undefined
        ? new Map<string, string>()
        : new Map([[attachment.conn, issuedToken]]);
    await this.dispatch(result, tokens);
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    const attachment = this.attachment(socket as HibernatableSocket);
    await this.dispatch(
      roomStep(
        room,
        { kind: 'disconnect', seat: attachment.seat, conn: attachment.conn },
        Date.now(),
      ),
    );
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  async alarm(): Promise<void> {
    const room = await this.load();
    if (room === null) {
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.dispatch(roomStep(room, { kind: 'alarm' }, Date.now()));
  }
}
