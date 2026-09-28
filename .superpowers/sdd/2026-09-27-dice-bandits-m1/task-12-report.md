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

## Fix round 1

**Date:** 2026-09-28
**Fix commit:** `c41c594934da6b636b456833917aa2b11c2b16b3`

### Finding 1 — seat 0 skipped the PvP pass screen

- **Cause/fix:** `apps/client/src/ui/hud.ts:53-61` delegates battle rendering to `renderBattleUi`; `apps/client/src/ui/battleUi.ts:23-25,45-54` tests `battleSeat !== undefined` and owns pass-screen visibility/ready behavior. Seat 0 is no longer treated as false.
- **TDD RED:** Added a real-engine PvP state with seat 0 as the next picker in `apps/client/test/hud.test.ts:21-62`. `npm test -w @dice-bandits/client -- --run test/hud.test.ts` failed on the expected assertion: `expected null not to be null` for `[data-testid="pass-ready"]` (1 failed, 4 passed).
- **GREEN:** The same focused test passed after the change (5 passed), asserting Ready is present and no `pick-*` buttons are exposed until handoff.
- **Seat truthiness audit:** No other seat-number truthiness checks found in `hud.ts`, `main.ts`, or `BattleScene.ts`; seat-index access uses `??`/explicit kind checks.

### Finding 2 — extract battle UI

- Created `apps/client/src/ui/battleUi.ts:1-85`; moved pending-side/pass-key state, battle-pick bar/test IDs, and pass-screen markup/ready handling out of `hud.ts`. Existing `pick-<pick>`, `pass-screen`, and `pass-ready` IDs remain unchanged. No visible strings were added; text uses existing i18n keys.

### Finding 3 — results language button visibility

- Updated `apps/client/src/ui/styles.css:500-516` with explicit minimum dimensions, border, fill, foreground, weight, and selected-state contrast for the TH/EN controls.
- Browser measurement at 844×390 after selecting Thai: TH **40×30 px**, EN **39×30 px**; both labels visible, with computed foreground/background colors `#171324/#fff0c2` and `#241a2d/#e1a54f`, respectively. Vision review confirmed the Thai results screen and legible labels with no clipping.

### Verification and browser evidence

- **Gate passed:** `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build -w @dice-bandits/client`. Totals: engine 113, client 17, pixelize 8 tests passed. Build retains the existing large-chunk warning (~1.46 MB minified).
- Chromium journey used `VITE_TEST_HOOKS=1`, `?seed=seed-1&speed=0`, two human seats, accepted `action-duel-0`; reached round 2 PvP with `a=seat 1`, `b=seat 0`. Pass-ready was observed immediately before **12/12 PvP picks**, including all six seat-0 handoffs.
- At `speed=1`, completed an attack/defend PvP pair and captured the Phaser canvas at 110 ms after the resolving pick. Vision confirmed the battle canvas and transient red floating damage text. Screenshots: `/home/jaochai/.hermes/profiles/hermes-dev/cache/scratch/t12-fix1-anim.png` and Thai results at 844×390 `/home/jaochai/.hermes/profiles/hermes-dev/cache/scratch/t12-fix1-results.png`.
- Browser console/page errors: none. Dev server stopped; port 4174 confirmed closed.
- **Fix-code SHA:** `c41c594934da6b636b456833917aa2b11c2b16b3`.

## Fix round 2

**Date:** 2026-09-28
**Fix commit:** pending

### Finding — battle consumable controls dropped

- **Cause/fix:** `apps/client/src/ui/battleUi.ts` previously filtered to `battlePick` only. It now renders both `battlePick` and eligible `useItem` actions, retaining `pick-<pick>` IDs and assigning `action-useItem-<item>[-<target>]` IDs with the existing localized action labels. Pass-required actions remain hidden until Ready. Click handlers now resolve indexes from the same filtered array used to render buttons.
- **TDD RED:** Added a real engine-derived PvP battle fixture with a battle potion in seat 0's inventory. Before the UI fix, `npm test -w @dice-bandits/client -- --run test/hud.test.ts` failed on `expected null not to be null` for the `action-useItem-potion` control. The regression test also verifies the item remains hidden behind Ready and dispatches the exact legal `useItem` action afterward.
- **GREEN:** Focused HUD suite passed (6 tests).

### Verification and browser evidence

- **Gate passed:** `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build -w @dice-bandits/client`. Totals: engine 113 tests, client 18 tests, pixelize 8 tests. Build retains the existing large-chunk warning (~1.46 MB minified).
- Chromium `seed-1`, two-human PvP run confirmed pass-ready before 12/12 picks. No browser console or page errors.
- The journey did not naturally acquire a battle item; the shop offered equipment, and the run reached game over without one. To exercise the UI in-browser, the test hook provisioned a potion directly onto the active player in a real PvP battle state, then triggered a HUD render. The localized `Use item · Potion` button appeared; clicking consumed the potion. Screenshot: `/home/jaochai/.hermes/profiles/hermes-dev/cache/scratch/t12-fix2-item.png`. Natural shop acquisition remains unverified; the engine-derived regression test verifies rendering and dispatch.
- Stopped the dev server; `ss -ltnp 'sport = :4174'` confirmed the port was closed.
