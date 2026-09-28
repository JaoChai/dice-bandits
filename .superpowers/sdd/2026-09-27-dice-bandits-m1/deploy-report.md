# Cloudflare deploy report

## Design
- Deploy the Worker from CI only after `checks` succeeds and only on pushes to `main`.
- The worker answers `GET /api/health` with a D1 probe and sends all other requests to the `ASSETS` binding; SPA navigation fallback is enabled.
- Wrangler binds D1 as `DB` for database `dice-bandits`. `database_id` is intentionally omitted here and must be added by the controller after the database is created, before the first deploy.
- The production build does not set `VITE_TEST_HOOKS`; verified no `__db` hooks are present in `apps/client/dist`.

## Verification
- Gate: typecheck, lint, formatting, tests, simulation, production build, and E2E all passed.
- Unit tests: 26 files, 154 tests passed (engine 16/113, client 9/33, pixelize 1/8).
- Simulation: 200 games, 0 crashes, 0 stuck games.
- E2E: 7 passed, 1 skipped.
- Wrangler local D1 smoke: `/api/health` returned HTTP 200 with `{"ok":true,"db":{"ok":1}}`; `/` returned HTTP 200; `/anything` with `Sec-Fetch-Mode: navigate` returned HTTP 200 and the app shell.
- Local dev process stopped; port 8788 confirmed free. No remote deploy or Cloudflare resource changes were made.

## Owner setup
- Configure `CLOUDFLARE_API_TOKEN` in repository Actions secrets. Required token permissions: **Account Workers Scripts Edit** and **Account D1 Edit**.
- Auto-provisioning is not part of this workflow: the controller should create/verify the D1 database, add its `database_id` to Wrangler config, and then enable the first deploy. Subsequent main pushes deploy after CI passes.
