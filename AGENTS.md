The card body overrides this file when they disagree.

# Dice Bandits: project context for agent workers

## What this is

A browser party board-RPG with hot-seat and online play, built with TypeScript,
Phaser and Vite. Cloudflare Workers serve the app and authoritative online rooms.

## Layout and folder ownership

Ownership below describes the frontend/backend boundary; the card defines edit scope.

- Frontend: `apps/client/src/` (scenes, DOM UI, controllers, browser saves, audio,
  i18n and online client), `apps/client/test/`, `apps/client/e2e/`.
- Frontend assets: `apps/client/public/art/` and `apps/client/public/audio/`.
- Backend: `apps/client/worker/` (HTTP API and Room Durable Object), with deployment
  config in `apps/client/wrangler.jsonc`. There is no `apps/server/` directory.
- Shared/backend rules: `packages/engine/` (deterministic game rules, data, bots,
  seeded RNG); `packages/room/` (online protocol, lobby, timers, redaction and room
  transitions). Frontend imports these packages; a UI card does not imply ownership.
- Worker integration tests: `tests/worker/` (Cloudflare Vitest/workerd).
- Asset tooling: `tools/cartoonize/`, `tools/sfx/`; budget checks: `scripts/`.
- Project references: `README.md`, `docs/superpowers/specs/`,
  `docs/superpowers/plans/`, `docs/plans/`, `docs/balance-log.md`.

## Install

Use Node.js 24 or newer and npm workspaces. From the repository root:

```sh
npm ci
```

Use installed `node_modules/.bin/<tool>` binaries, not `npx`, in agent commands.

## Gate commands

The `checks` job in `.github/workflows/ci.yml` runs the following, in order, from
repo root (Node 24). The browser-install line is copied literally from CI;
locally use `node_modules/.bin/playwright install --with-deps chromium` instead.

```sh
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:worker
npm run build -w @dice-bandits/client
npm run sim -- --games 200 --players 4
npm run sim:room -- --games 200
npx playwright install --with-deps chromium
npm run e2e
```

For local E2E, use only the targeted, locked commands below, not the full-suite
line above. Exact-head PR CI is the full-suite gate.

Fast iteration:

```sh
# Repo root: one engine or room test file
npm test -w @dice-bandits/engine -- test/battle.test.ts
npm test -w @dice-bandits/room -- test/redact.test.ts
# From apps/client: one frontend test (no full workspace suite)
../../node_modules/.bin/vitest run test/i18n.test.ts
# Repo root: frontend typecheck or dev server
npm run typecheck -w @dice-bandits/client
npm run dev -w @dice-bandits/client
```

`npm test` includes client audio/art budget checks, but does not run the separate
`test:worker` gate. Direct targeted Vitest runs do not run the budget scripts.

## E2E rules

- All local E2E/browser runs use the shared lock:
  `~/.local/bin/run-locked dice-bandits-e2e <command>`. Never run two at once.
- Run only the card's named specs, each alone with `--workers=1`. Example from root:

  ```sh
  ~/.local/bin/run-locked dice-bandits-e2e npm run e2e -w @dice-bandits/client -- e2e/intro.spec.ts --workers=1
  ```

- Do not run the full local E2E suite; use CI on the exact PR head for that gate.
- The client E2E script builds with `VITE_TEST_HOOKS=1` before Playwright. Config
  starts Vite preview on 4173 and local Wrangler on 8787; local runs may reuse
  existing servers. Check that any reused server serves the intended build.
- Config caps local workers at 2 (documented 4 GiB command memory limit), while CI
  uses Playwright defaults. Do not change the cap or weaken timing/FPS assertions
  to hide a local load failure. Record the failure and its isolated rerun evidence.
- Projects cover desktop and mobile landscape. Normal specs seed intro/tips state
  via `apps/client/e2e/storage-state.json`; first-visit tests must use fresh storage.

## Branch/PR rules

- Base new work and PRs on `main`, unless the card names another base/shared branch.
- Push only the task branch; never push `main`. Do not merge on development cards.
- Merging to `main` deploys production: push CI runs `checks`, then `deploy`
  (`npm ci`, `npm run build`, `npm run deploy`) through Wrangler to Cloudflare.
  PR CI does not deploy.
- Production: https://dice-bandits.anugooltippon.workers.dev; health: `/api/health`.
  Treat production as read-only unless the card explicitly authorizes release work.

## Conventions enforced by checks

- ESM TypeScript; shared config enables `strict`, `noUncheckedIndexedAccess` and
  `verbatimModuleSyntax`. Prettier uses single quotes and a 100-column print width.
- Engine source (except `sim.ts`) cannot use `window`, `document`, `localStorage`,
  `Math.random`, `Date.now`, `node:*` or Phaser imports: use `rng.ts` and explicit inputs.
- Thai/English dictionaries in `apps/client/src/i18n/` must have matching, non-empty
  keys. Tests cover engine translations, atlas mappings, shipped atlases and poses.
- `npm test` checks audio and art byte budgets with `scripts/check-*-budget.mjs`.
  Online redaction and hot-seat tests protect unrevealed battle picks/secret usage.

## Known pitfalls

- `format:check` is `prettier --check .`: it also scans untracked, non-ignored files.
  Keep scratch reports, mockup packets and evidence outside the worktree.
- A fresh visit to `/` opens the intro comic, not just the title screen. Browser
  checks must dismiss it or deliberately seed `dice-bandits:intro-seen` to `1`;
  do not confuse that overlay with a visual regression.
- Dynamic i18n/atlas lookups must cover every ID the engine can emit, including IDs
  created in rules, not just JSON tables (e.g. `townGuardian` in `rules/towns.ts`).
  Add coverage for each locale/atlas: matching dictionary keys and data-table tests
  alone cannot prove completeness. Missing resources can show raw keys/placeholders.
- Backend Worker code lives under `apps/client/worker/`, despite the client folder
  name. `packages/room/src/protocol.ts` is the shared online contract.
