# Task 12 Report — Battle UI, pass-device, PvP rewards, results

**Date:** 2026-09-28  
**Branch:** `feat/m1-prototype`  
**Feature commit:** `992f858 feat(client): battle UI, hot-seat pass screen, rewards and results`

## Implemented

- Added `BattleScene` with combatant portraits, HP bars, exchange label, damage number, flash/shake feedback, short impact hold, and secret `?` reveal/flip. Phaser effects are scaled by the configured speed; speed 0 removes delays/effects.
- Added real-state `needsPassScreen(state, side)` for PvP battles between two human-controlled combatants. The hot-seat modal presents the next player's name and portrait, hides pick controls until Ready, then reveals the current role's legal picks. Battle pick test IDs are `pick-<pick>`.
- Extended phase dialogs for PvP rewards, three-card level-up choices, and shop actions; added localized results with ranking, engine highlights, net worth, Play again, Title, and language toggle. A finished saved game now opens directly to results; Play again goes through the existing save-clearing new-game flow.
- Added the portrait rotate hint via the requested orientation media query.
- Reused the existing controller's human/bot actor selection and save behavior; no controller changes or dependencies were needed.

## Files changed

- `apps/client/src/scenes/BattleScene.ts` (new)
- `apps/client/src/ui/passDevice.ts` (new)
- `apps/client/src/ui/results.ts` (new)
- `apps/client/test/passDevice.test.ts` (new)
- `apps/client/src/main.ts`
- `apps/client/src/ui/hud.ts`
- `apps/client/src/ui/dialogs.ts`
- `apps/client/src/ui/styles.css`
- `apps/client/src/i18n/en.json`
- `apps/client/src/i18n/th.json`

## TDD evidence

- Wrote `passDevice.test.ts` first and added typed stub exports so the RED run exercised behavior rather than failing module resolution.
- **RED:** `npm test -w @dice-bandits/client -- --run test/passDevice.test.ts` failed on real assertions: the pass-screen stub returned `false` where `true` was expected for human-vs-human PvP; the empty results stub returned `[]` instead of the engine's final ranking. The fixtures create engine states, step a real duel into PvP, and drive a bot-only game to `gameOver`.
- **GREEN:** The same focused command passed (2 tests). The results assertion checks engine ranking, all three highlights, and net worth including inventory resale value.

## Verification

- Required gate passed on the final code: `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build -w @dice-bandits/client`.
- Test totals: engine 16 files / 113 tests; client 7 files / 16 tests; pixelize 1 file / 8 tests. All passed.
- Build passed. Vite emitted the existing large-chunk warning (about 1.46 MB minified); no dependencies were added.
- Phaser APIs were checked against installed `node_modules/phaser/types/phaser.d.ts` for Phaser 4.2.1: `ScenePlugin.launch` (129840), `ScenePlugin.stop` (129916), `SceneManager.isActive` (120625), and camera `flash`/`shake` (4002/4014). Typecheck passed.

## Browser verification

- Ran the local test-hook dev server and a Node `@playwright/test` Chromium script on **seed `seed-1`**, two human seats, speed 0. The game reached a PvP battle in round 2 and was played through to game over.
- Captured pass, battle, and results screens in Thai and English at 1280×720 and 844×390; captured portrait rotate-hint screens at 390×844. Vision-reviewed representative pass, battle, results, and portrait screenshots.
- Screenshots are in `/home/jaochai/.hermes/profiles/hermes-dev/cache/scratch/`:
  - `t12-pass-{en,th}-{1280x720,844x390}.png`
  - `t12-battle-{en,th}-{1280x720,844x390}.png`
  - `t12-results-{en,th}-{1280x720,844x390}.png`
  - `t12-rotate-hint-{en,th}-390x844.png`
- DOM measurements: pass modal 420×192 with scroll/client dimensions 416×188; battle action bar 606×52 at desktop and 606×44 at 844×390; results panel 612×340 with scroll/client dimensions 606×334. All were inside the viewport with no internal scroll/overflow. Rotate hint was visible at 390×844, measured 374×39, within viewport. Browser console/page errors: none.
- The vision pass found the pass modal readable and results content contained. It noted the background world-rule chip truncates in the narrow landscape HUD and some adjacent board/HUD details look cramped; these are outside the measured pass dialog, pick bar, and results panel. Speed 0 was used for the browser journey, so screenshots verify static UI and controls, not the non-zero-speed animation timing.
- Stopped the dev server and confirmed port 4174 was closed.

## Self-review / concerns

- New visible strings are localized in both dictionaries and the existing i18n key-parity test passed. Test hooks remain gated by `VITE_TEST_HOOKS=1`; dependencies and Phaser configuration were not changed.
- No remaining task blocker. Minor visual concern: the narrow-landscape world-rule chip behind the game UI appears truncated; non-zero-speed tween timing was not browser-exercised (though compiled/typechecked).
