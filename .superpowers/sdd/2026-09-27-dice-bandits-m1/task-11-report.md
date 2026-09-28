# Task 11 Report — Board scene, HUD, GameController, bot turns

**Status:** DONE_WITH_CONCERNS  
**Implementation commit:** `15568c6 feat(client): board scene, HUD and game controller`

## Implemented

- Added `GameController` using the real engine: step → JSON-normalized state → autosave → awaited event callback → bot turns. It identifies the legal actor per seat during battle (including the acting side differing from `turnSeat`), auto-runs bots with randomized 400–900 ms × speed delays, and logs failed steps without changing state.
- Added Phaser `BootScene`/`BoardScene`: loads region and hero assets, renders board spaces/town colors/player sprites and tokens, highlights current player and leader/prank decorations, and responds to move/dice/theft/frenzy events with effects.
- Added the DOM HUD, action buttons/dialogs, event toasts, and responsive 640×360 Phaser layout. User-facing strings are in the Thai/English dictionaries with matching keys.
- Replaced the placeholder game-ready screen with new/continue board startup, save wiring and gated `window.__db` test access. Test-hook builds now accept `speed=0` and the setup is configured for the requested 12 rounds.
- Exported `chooseAction` from the engine package entry point so the client can consume the existing bot API.
- Added controller end-to-end and HUD canvas-persistence tests. The HUD preserves the mounted Phaser board across state updates.

## Files changed

- `apps/client/src/controller.ts`
- `apps/client/src/fx.ts`
- `apps/client/src/scenes/BootScene.ts`
- `apps/client/src/scenes/BoardScene.ts`
- `apps/client/src/ui/hud.ts`
- `apps/client/src/ui/dialogs.ts`
- `apps/client/src/main.ts`
- `apps/client/src/ui/styles.css`
- `apps/client/src/testHooks.ts`
- `apps/client/src/i18n/en.json`
- `apps/client/src/i18n/th.json`
- `apps/client/test/controller.test.ts`
- `apps/client/test/hud.test.ts`
- `packages/engine/src/index.ts`

## TDD evidence

- **RED:** `npm test -w @dice-bandits/client -- --run test/controller.test.ts` failed with `Failed to resolve import "../src/controller"` (0 tests collected). This was expected: the test was written before the controller module existed.
- **GREEN:** Re-ran the same focused command after implementation: **1 test passed**. The test uses a real engine game with one human and three bots, speed 0, checks each human dispatch autosaves the controller state, reaches `gameOver`, and observes no logged bot/illegal-action errors.
- Added an illegal-action test to assert errors are logged and state/save remain unchanged.
- Added `test/hud.test.ts` to ensure the Phaser canvas remains connected after HUD updates. A first fixture used a detached root and therefore reported `isConnected=false`; after attaching the fixture to `document.body`, the regression test passed. Final focused run: **2 files, 3 tests passed**.

## Full gate

Final fresh run completed successfully:

`npm run typecheck && npm run lint && npm run format:check && npm test && npm run build -w @dice-bandits/client`

- Typecheck: passed across workspaces.
- ESLint: passed.
- Prettier check: passed.
- Tests: engine **16 files / 113 tests**, client **5 files / 10 tests**, pixelize **1 file / 8 tests**; all passed.
- Client production build: passed. Vite emitted its existing-style bundle-size warning for the generated ~1.45 MB JS chunk (>500 KB).
- `git diff --check`: passed.

## Phaser documentation and types checked

- Installed dependency: Phaser **4.2.1**; checked `node_modules/phaser/types/phaser.d.ts` as required. Verified config/types for `pixelArt`, `Scale.FIT`, `Scale.CENTER_BOTH`, loader `loaderror`, scene/game objects, graphics, and tween usage.
- Context7 `/websites/phaser_io_phaser4` returned no match for the combined API query. Queried `/websites/phaser_io_api-documentation`; it documented `this.load.image(...)` and the `this.load.on('loaderror', ...)` event. The installed 4.2.1 typings were used as the ground truth for the actual implementation/config.
- No dependency additions.

## Browser verification

- Test-hooks dev URL: `http://127.0.0.1:4174/?seed=demo&speed=1`.
- Desktop screenshot (1280×720): `/home/jaochai/.hermes/profiles/hermes-dev/cache/scratch/t11-desktop.png`.
- Mobile-landscape screenshot (844×390): `/home/jaochai/.hermes/profiles/hermes-dev/cache/scratch/t11-mobile-landscape.png`.
- Vision review of both screenshots found the in-game board/tokens, player cards, round/world HUD and action controls visible without material overlap or clipping. Browser accessibility snapshots confirmed complete player stat strings and the visible action buttons. A manual Roll interaction reached battle choices (`Attack`, `Strike`, `Secret`).
- Final browser console check before the final HUD canvas-preservation refactor: **0 errors, 4 WebGL GPU `ReadPixels` performance warnings**. The later post-refactor browser re-run command was blocked when its approval was withdrawn; it was not retried through another interface. The final HUD update behavior is covered by the passing happy-dom canvas-persistence test, but exact final-code browser interaction remains unverified.
- Dev server was stopped; port 4174 returned `ConnectionRefusedError` on the final check.

## Self-review / concerns

- All new visible client copy uses the i18n dictionaries and the language files retain identical key sets (enforced by the existing test).
- `window.__db`, query seed, and query speed are available only in `VITE_TEST_HOOKS=1` builds; no new package dependencies were added.
- Controller test exercises real engine bot decisions and autosaves; no engine mocks.
- Browser screenshots and checks preceded the final DOM-preserving HUD update. The follow-up browser verification was blocked by withdrawn command approval; this is the remaining verification concern.
- Build succeeds with the noted large-chunk warning; no deploy was performed.

## Commits

- `15568c6 feat(client): board scene, HUD and game controller`
- Separate report commit: `docs: record task 11 implementation report`.
