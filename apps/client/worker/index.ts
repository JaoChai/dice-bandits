import { generateCode, validName } from '@dice-bandits/room';

export interface WorkerEnv {
  DB: { prepare(query: string): { first(): Promise<unknown> } };
  ASSETS: { fetch(request: Request): Promise<Response> };
  ROOM: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
}

export { Room } from './room-do';

function tokenHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function codeRandom(): number {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return bytes[0]! / 0x1_0000_0000;
}

function jsonError(key: string, status: number): Response {
  return Response.json({ error: key }, { status });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonError('online.error.badName', 400);
      }
      const nameValue =
        typeof body === 'object' && body !== null && 'name' in body
          ? (body as { name: unknown }).name
          : null;
      const name = typeof nameValue === 'string' ? validName(nameValue) : null;
      if (name === null) return jsonError('online.error.badName', 400);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = generateCode(codeRandom);
        const token = tokenHex();
        const response = await env.ROOM.getByName(code).fetch(
          new Request(`https://room.internal/_internal/create?code=${code}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, token }),
          }),
        );
        if (response.status === 409) continue;
        if (!response.ok) return jsonError('online.error.server', 500);
        return Response.json({ code, seat: 0, token }, { status: 201 });
      }
      return jsonError('online.error.server', 503);
    }

    const wsRoute = /^\/api\/rooms\/([A-Z0-9]{5})\/ws$/.exec(url.pathname);
    if (wsRoute && request.method === 'GET') {
      const code = wsRoute[1]!;
      const forwarded = new Request(`https://room.internal/ws${url.search}`, request);
      return env.ROOM.getByName(code).fetch(forwarded);
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      try {
        const db = await env.DB.prepare('select 1 as ok').first();
        return Response.json({ ok: true, db });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ ok: false, db: message }, { status: 503 });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
