import { describe, expect, it, vi } from 'vitest';
import worker, { type WorkerEnv } from '../worker/index';

describe('Worker fetch handler', () => {
  it('returns online.error.badName for an invalid room name', async () => {
    const env = {
      DB: { prepare: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      ROOM: { getByName: vi.fn() },
      ROOM_CREATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
      ROOM_JOIN_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    };
    const response = await worker.fetch(
      new Request('https://example.com/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '   ' }),
      }),
      env as unknown as WorkerEnv,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'online.error.badName' });
    expect(env.ROOM.getByName).not.toHaveBeenCalled();
  });

  it('returns a successful health response with the D1 probe result', async () => {
    const env = {
      DB: { prepare: vi.fn(() => ({ first: vi.fn().mockResolvedValue({ ok: 1 }) })) },
      ASSETS: { fetch: vi.fn() },
    };

    const response = await worker.fetch(
      new Request('https://example.com/api/health'),
      env as unknown as WorkerEnv,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ ok: true, db: { ok: 1 } });
    expect(env.DB.prepare).toHaveBeenCalledWith('select 1 as ok');
  });

  it('returns the database error as JSON instead of rejecting', async () => {
    const env = {
      DB: {
        prepare: vi.fn(() => ({
          first: vi.fn().mockRejectedValue(new Error('database unavailable')),
        })),
      },
      ASSETS: { fetch: vi.fn() },
    };

    const response = await worker.fetch(
      new Request('https://example.com/api/health'),
      env as unknown as WorkerEnv,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, db: 'database unavailable' });
  });

  it('delegates non-GET requests to the health path to static assets', async () => {
    const assetResponse = new Response('asset response');
    const env = {
      DB: { prepare: vi.fn() },
      ASSETS: { fetch: vi.fn().mockResolvedValue(assetResponse) },
    };
    const request = new Request('https://example.com/api/health', { method: 'POST' });

    const response = await worker.fetch(request, env as unknown as WorkerEnv);

    expect(response).toBe(assetResponse);
    expect(env.DB.prepare).not.toHaveBeenCalled();
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request);
  });

  it('delegates non-health requests to static assets', async () => {
    const assetResponse = new Response('asset response');
    const env = {
      DB: { prepare: vi.fn() },
      ASSETS: { fetch: vi.fn().mockResolvedValue(assetResponse) },
    };
    const request = new Request('https://example.com/anything');

    const response = await worker.fetch(request, env as unknown as WorkerEnv);

    expect(response).toBe(assetResponse);
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request);
  });
});
