# Task 13 report — Playwright E2E suite and CI

## Status

Implemented the E2E suite and CI steps; fixed the in-game language-switching defect exposed by the journey. Local verification passed. No push or remote CI run was performed, per the task override.

## Files changed

- Added `apps/client/playwright.config.ts`: desktop 1280×720 and mobile-landscape 915×412 Chromium projects, hooks-enabled build/preview web server on port 4173, CI retries, and retain-on-failure traces.
- Added `apps/client/e2e/helpers.ts` with `startTestGame`, `playOneStep`, and `playSteps`.
- Added `apps/client/e2e/full-game.spec.ts`, `i18n.spec.ts`, `continue.spec.ts`, and `rotate.spec.ts`.
- Updated `.github/workflows/ci.yml` to install Chromium with dependencies, run E2E, and upload the Playwright report on failure.
- Updated `apps/client/src/ui/hud.ts` to provide a working, localized in-game language toggle.
- Updated `apps/client/test/hud.test.ts` with an in-game localization regression test.
- Existing `.gitignore` already ignores `test-results/` and `playwright-report/`; confirmed using `git check-ignore`.

## RED/GREEN and defect

- Initial `npm run e2e`: 5 passed, 2 failed (English/Thai journey on desktop and mobile), 1 skipped. Both failures timed out because the game HUD had no `[data-lang]` controls.
- Added a HUD unit regression test and ran it before the fix: failed as expected because the action label remained `Roll` instead of changing to `ทอยเต๋า`.
- Fix: add the in-game language buttons, update selected-state accessibility attributes, and rerender localized HUD content after selection (`apps/client/src/ui/hud.ts`). Regression test is in `apps/client/test/hud.test.ts`.
- Targeted unit test after fix: 7/7 HUD tests passed. Subsequent E2E suite passed.

## Full gate

Command: `npm run typecheck && npm run lint && npm run format:check && npm test && npm run sim -- --games 200 --players 4 && npm run build && npm run e2e`

- Typecheck, ESLint, Prettier format check: passed.
- Unit tests: engine 16 files / 113 tests; client 7 files / 19 tests; pixelize 1 file / 8 tests — total 24 files / 140 tests passed.
- Simulation: 200 games; 0 crashes, 0 stuck; average 12 rounds.
- Production build: passed.
- E2E: 7 passed, 1 skipped (desktop-only skip for the mobile rotation journey). Both projects passed full-game, i18n, and continue journeys; mobile-landscape passed rotate.
- Full-game loop: 28 iterations on each project; mobile-landscape 5,250 ms and desktop 5,398 ms (test-measured duration).
- Existing Vite bundle-size warning (>500 kB) appeared during build; it did not fail the build or E2E.

## CI validation and remaining concerns

- Parsed `.github/workflows/ci.yml` locally with Python `yaml.safe_load`: successful. Re-read/checked the changed workflow and `git diff --check` passed.
- `playwright-report/` and `test-results/` are ignored and were not committed.
- Port 4173 was free after the E2E run.
- No push and no `gh run watch`; remote CI remains unverified as required by the override.

## Fix round 1

### Findings addressed

- `apps/client/src/ui/hud.ts:7-9,58-73`: language click handling is delegated once from the persistent `.game-shell`; a WeakMap updates the latest state/dispatch context on each render. This avoids listener accumulation while preserving `.game-shell` and `#phaser-board` across HUD updates.
- `apps/client/src/ui/hud.ts:43`, `apps/client/src/ui/screens.ts:22`, `apps/client/src/ui/results.ts:39`: replaced hard-coded language toggle labels with `t('lang.th')` and `t('lang.en')`.
- `apps/client/src/i18n/en.json:7-8` and `apps/client/src/i18n/th.json:7-8`: added both translation keys (values `TH` and `EN`).
- `apps/client/test/hud.test.ts:69-115`: added regressions for one handler after five renders, use of the latest rendered game state, and translated toggle labels.

### RED/GREEN

- RED before the fix: repeated-render test failed because one click called `setAttribute` 5 times instead of once; label test failed because the visible `TH` label resolved to the missing-key fallback `lang.th`. The latest-state test also asserts exactly one rerender after rendering an updated state.
- GREEN: targeted HUD suite passed, 10/10 tests.

### Full gate

Command: `npm run typecheck && npm run lint && npm run format:check && npm test && npm run sim -- --games 200 --players 4 && npm run build && npm run e2e`

- Typecheck, lint, and format check passed.
- Unit tests: 24 files / 143 tests passed (engine 16/113; client 7/22; pixelize 1/8).
- Simulation: 200 games; 0 crashes, 0 stuck; average 12 rounds.
- Production build passed; existing Vite bundle-size warning (>500 kB) remains.
- E2E: 7 passed, 1 skipped (desktop-only mobile rotation journey).
- Port 4173 was free after E2E. `git diff --check` passed.
- Base SHA: `526eb93`. Fix implementation commit SHA: `4876387b697c8ba97390222c9225640560a5612e`.
