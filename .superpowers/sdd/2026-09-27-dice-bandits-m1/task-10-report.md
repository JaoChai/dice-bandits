# Task 10 — Client scaffold report

Date: 2026-09-27
Status: Complete
Commit: `193565c38eabc85a1a6d590e8144448350ac3f17` — `feat(client): scaffold, cloudflare config, i18n, title and setup`

## Delivered

- Added `apps/client` as the `@dice-bandits/client` workspace with exact versions for the requested external packages, Vite/Cloudflare Workers configuration, SPA asset fallback, Vitest `happy-dom`, and the workspace lockfile entries.
- Added Thai and English UI strings, language persistence and change listeners, interpolation, font imports (Chakra Petch 400/700 and Press Start 2P), responsive title/setup views, and test hooks.
- Added versioned local save/load/clear. Bad version or malformed JSON clears storage and emits `toast.saveDiscarded`; the title view surfaces the localized toast and only offers Continue for a valid save.
- Setup renders four seats (human/bot/empty, name, class portrait, bot personality), validates at least two occupied seats including a human, and passes a `GameConfig` to its callback.
- Added the client production build after tests in CI. Existing sprite files were left untouched.

## Docs gate

- Cloudflare Workers/Vite documentation search: assets-only output can use the Vite plugin's build output without a manual `assets.directory` or Worker `main`; SPA fallback is configured with `assets.not_found_handling`. This matches the supplied Wrangler configuration.
- Context7 resolved Phaser 4 docs as `/websites/phaser_io_phaser4`, but the targeted 4.x GameConfig query returned no matching documentation. The alternate Phaser API documentation result describes `new Game(config)` and game dimensions; it did not verify Phaser 4.2.1-specific scale settings. Task 10 installs Phaser but does not instantiate it; Phaser setup remains for Task 11.
- The supplied `$schema` path is kept as specified. Because Wrangler is hoisted at the repo root, that relative editor schema hint may not resolve from `apps/client`; Vite build is unaffected.

## TDD and verification

- RED: the first client test run failed because the i18n and save modules were absent; after implementation, dynamic engine-event/data-key checks and the save-storage key also exposed missing translations and a key mismatch.
- GREEN: `npm test -w @dice-bandits/client` — 2 test files, 5 tests passed.
- Full required root chain passed: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` (engine 113 + client 5 + pixelize 8 = 126 tests), and `npm run build -w @dice-bandits/client` (Vite 8.3.1 production build, exit 0).
- Browser exploration used a real 640×360 Playwright viewport. Thai and English title/setup screens rendered, all four seats were present, and both class portrait assets loaded. The dev server was stopped and its port was checked closed.

## Screenshots

- `/home/jaochai/.hermes/profiles/hermes-dev/cache/scratch/t10-title-th.png`
- `/home/jaochai/.hermes/profiles/hermes-dev/cache/scratch/t10-title-en.png`
- `/home/jaochai/.hermes/profiles/hermes-dev/cache/scratch/t10-setup-th.png`
- `/home/jaochai/.hermes/profiles/hermes-dev/cache/scratch/t10-setup-en.png`

All four files were verified as 640×360 PNGs.

## Judgment calls / remaining concerns

- The new-game callback creates and saves the engine state, then shows a small ready/continue placeholder; gameplay rendering belongs to later client tasks.
- Event translation coverage is derived from engine exports and a deterministic engine run rather than maintaining a hand-written list of ids.
- No Cloudflare deployment was run. No remaining test or build concerns were observed.
- Layout: at 640×360 the Thai setup screen fits exactly (scrollHeight 360), but the English setup screen is 372px tall — the Start button needs a 12px scroll. Not fixed in this commit.
- The title screen still uses a 🎲 emoji as art; replace with a real sprite in a later art pass.

## Fix round 1

- **Finding 1 addressed:** `apps/client/src/i18n/en.json:7-8` and `apps/client/src/i18n/th.json:7-8` add matching `title.gameName` and interpolated `setup.defaultName` keys. `apps/client/src/ui/screens.ts:14-18,44,69,106` now renders translated game/default names and applies the localized default at submit time without overwriting a typed name. `apps/client/src/main.ts:19-24,35-36` localizes the ready-screen title and HTML-escapes the user-entered player name.
- **Finding 2 addressed:** `apps/client/src/ui/screens.ts:4,103` uses `testHooks.seed` (null when hooks are disabled) and no longer reads `?seed=` directly.
- **RED evidence:** `npm test -w @dice-bandits/client -- --run test/screens.test.ts` failed before the fix (2 tests failed): expected missing `setup.defaultName` translation; and expected URL seed `untrusted-url-seed` not to equal config seed, but it did.
- **Covering tests:** `apps/client/test/screens.test.ts` verifies translated default setup name, preservation of a typed name after switching language, and that `?seed=untrusted-url-seed` does not configure the game when the test hook is disabled. `apps/client/test/i18n.test.ts` verifies identical Thai/English key sets and resolution/interpolation of both new keys.
- **Full gate:** `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build -w @dice-bandits/client` — PASS. Typecheck, ESLint, Prettier, 16 engine test files (113 tests), 3 client test files (7 tests), pixelize (8 tests), and Vite production build all succeeded.
- **Fix commit:** `379634d986fe88db9864e46acaf2bc71197da59e` (`fix(client): route visible strings through i18n and gate seed hook`).

