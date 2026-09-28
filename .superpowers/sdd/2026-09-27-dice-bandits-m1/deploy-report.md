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

## Bot no-legal-action regression (2026-09-28)
- Reproduction: focused state fixture from seed `t1`, `turnSeat=0`, phase `levelUp` for seat 2; before the fix, the regression test failed because `legalActions(state, 2)` returned `[]`. This reproduces the phase/seat mismatch, not a naturally reached live-game seed. Client controller fixture uses one human and three bots and confirms the phase-seat bot picks a perk without logging an error.
- Root cause: `packages/engine/src/legal.ts:11-17` treated `levelUp` like turn-owned phases and rejected any seat other than `turnSeat`, while `apps/client/src/controller.ts:74-80` correctly selects `phase.seat`. Also, `packages/engine/src/step.ts:19-24` validated `levelUp` actions as `turnSeat` rather than `phase.seat`.
- Fix: exempt `levelUp` from the `turnSeat` guard and resolve action ownership to `phase.seat` in `step`; ordinary human turns remain turnSeat-owned.
- TDD: engine regression was RED (expected legal perk choices, received `[]`) before the fix, then GREEN; focused client and engine tests pass.
- Gate: typecheck, lint, format check, build passed; tests 26 files / 156 tests passed (engine 16/114, client 9/34, pixelize 1/8); simulation 200 games, 0 crashes, 0 stuck; E2E 7 passed, 1 skipped.
- E2E ports 4173, 4174, and 8788 were confirmed free before running. No push or deployment performed; build emitted the existing >500 kB client chunk warning.

## Round 2 — bot no-legal-action follow-up (2026-09-28)
- Removed the unreachable `levelUp.seat !== turnSeat` engine fixture/fix; real `grantXp` follows the turn-seat battle winner. The natural controller game probe uses seed `controller-test`, one human knight (seat 0), three bots (seats 1–3), 12 rounds, and speed `0.01`; it reached `gameOver` without logging an illegal bot action.
- Controller hardening: after the randomized bot delay, re-derive the pending bot actor and re-check legal actions before choosing. This prevents acting on a stale seat if state changes during the await; it does not swallow errors.
- Natural controller guard test: seed `controller-test`, one human knight (seat 0), three bots (seats 1–3), speed `0.01`; it reached battle and `gameOver` with no logged errors. Focused controller suite: 1 file / 2 tests passed.
- The required gate passed: typecheck; lint; format check; tests (26 files / 154 tests: engine 113, client 33, pixelize 8); simulation (200 games, 0 crashes, 0 stuck); build; E2E (7 passed, 1 skipped). E2E ports 4173, 4174, 8788 were free before the run.
- Finding status: the reported live error was not reproduced in a naturally reached state in this pass, so the delay-race hypothesis remains unconfirmed; no real-game phase/seat trigger is claimed. A temporary browser probe using rapid clicks did not reach its verification assertions because the test driver raced the UI.
- Build retains the existing >500 kB client chunk warning. No push or deployment performed.
