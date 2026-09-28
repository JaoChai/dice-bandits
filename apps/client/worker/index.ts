export interface WorkerEnv {
  DB: { prepare(query: string): { first(): Promise<unknown> } };
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

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
