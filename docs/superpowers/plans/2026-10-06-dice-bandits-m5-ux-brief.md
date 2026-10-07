# M5-UX Dice and Board HUD Implementation Plan

> For agentic workers: use writing-plans plus the team's implementation workflow. Follow the cards sequentially after owner approval; steps below use checkboxes. Do not interpret this document as permission to start implementation.

Goal: make the real roll result visible before local token movement, reduce board chrome, remove duplicated modal actions, and preserve every existing gameplay and accessibility function.

Architecture: keep the deterministic engine and protocol unchanged. Render dice from observed GameEvent payloads, keep presentation state separate from GameState/save data, group HUD surfaces into reserved lanes, and retain a full-bleed decorative map behind a separately framed gameplay camera. The attached mockups are a visual specification, NOT a working game implementation.

Tech stack: existing TypeScript, Phaser 4.2.1, DOM/CSS, Mitr 400/600, Vitest 5.0.2/happy-dom, Playwright 1.63.0; no additional dependencies or artwork.

Spec: kanban t_2ceac957, Lead comment titled “M5-UX · Mockup + brief”; approval assets in mockup/index.html, mockup/review.html, mockup/shots/, and mockup/measure.json.

## Approval gate and project context

- Owner approved addressing both defects together, but must approve the phone mockup FIRST. Do not create build cards yet. Lead creates the graph after approval and resolves the two decisions below.
- Repository: /home/jaochai/Code/dice-bandits, origin JaoChai/dice-bandits. Verified detached workspace HEAD and origin/main: 63dc4e8c8056bbab3bb5b633e11bc9766e5047a8.
- All line anchors below refer to that immutable revision, not to line numbers after another card lands.
- Implementation base: main. Merge means production deployment; only the Lead/release lane may authorize this. This architect run made no commit, push, PR, deployment, or build-card creation.
- Own only apps/client/src and apps/client/test/e2e changes listed on an approved card. Do not touch packages/**, apps/server/**, public/art/**, tools/**, .github/**, online protocol, or save.ts.
- Use node_modules/.bin/<tool>, not npx. Run every browser command through /home/jaochai/.local/bin/run-locked dice-bandits-e2e. Each command below is a separate plain invocation; do not combine commands in a shell wrapper.
- Full local E2E: at most once, at the end of an implementer's run; targeted specs while iterating. Keep the existing worker budget in playwright.config.ts:11. After a final PR push, exactly one gh pr checks <pr> --watch call. None of those PR actions was performed here.

## Decisions required before U1 can be dispatched

D1 — real faces are NOT available for multi-dice rolls.

movement.ts:78-80 defines dice as a COUNT, not an array. movement.ts:93-97 emits { value: total, dice, sides }. GameEvent.params is Record<string, string | number> in types.ts:136-140. The requested “real faces from params.dice” cannot be implemented literally without an engine/protocol change, which this task forbids.

Recommended approval: one truthful pip face only when dice === 1 and 1 <= value <= sides <= 6; otherwise show the count/sides label and authoritative TOTAL without individual pip faces. For example, “2 × d6 · total 9”. Never fabricate a decomposition, call RNG, or imply the total is the movement distance: quickFeet and slipperyRoads can change movement AFTER DiceRolled (movement.ts:99-107). Forced rolls also carry dice === 1 even though rollCount === 0. The captured single-die example genuinely rolled 5: seed ux-18, {value:5,dice:1,sides:6}.

D2 — animation-first and completely unchanged timing conflict in the current architecture.

GameController.dispatch awaits onEvents before starting the bot loop (controller.ts:59-62); every bot action also awaits it (:119-121). OnlineController.applyMessage awaits onEvents before publishing a view, legal actions and awaitingView=false (online/onlineController.ts:110-121). main.ts:154-187 and :340-369 both await scene animation. Adding a 900 ms tumble and 1400 ms hold there delays local bot handoff and online view consumption. The existing 10 s animateThenRender watchdog is not a solution to this conflict.

Recommended bounded scope, requiring EXPLICIT owner approval:
- Local-human roll: 900 ms tumble, then 1400 ms readable result, THEN existing BoardScene movement. This knowingly adds a local human-to-bot handoff delay, but no new bot RNG or bot-delay setting.
- Bot rolls and online rolls: zero additional awaited duration; show truthful result in the persistent chip immediately. Do not promise a full before-movement tumble in these modes.
- Reduced motion or speed=0: zero tumble AND zero awaited result hold; persistent result remains readable.
- Server turn/reconnect deadlines and protocol stay unchanged. This claim is not equivalent to saying that every client timer is unaffected.

If the owner requires a full tumble-before-movement online and for every bot roll while all cadence is unchanged, STOP and request a separate presentation-queue design decision. Do not quietly introduce a view backlog or rewrite controllers. U1 below is executable only under the bounded policy above. U2a/U2b/U3 depend on visual approval but not on a guessed D2 decision.

## Visual specification

Retain existing theme.css:7-31 values: blue #2e7fe0, green #3ba84a, orange #f07818, gold #f5c51c, red #d42b3a, purple #6c2ebe, grey #8e8e93, pink #f06ea9, cream #f5eedc, cocoa #5c3317; panel #fffdf5. Use the existing cocoa 2 px outline, 3 px offset shadow, and 14 px main radius; compact cards/buttons may use 10/12 px and die 20 px. Base spacing 8 px; gaps 4/8/12/16 px. Mitr 400/600; body/instruction 14 px, CTA 16 px, modal title 18 px, result 28 px; secondary labels no smaller than the existing 12 px. Do not use 8–10 px text as the space-saving mechanism. Hit targets at least 44 × 44 CSS px.

Target screens: phone 915 × 412 and desktop 1280 × 720; additionally prove the existing 932 × 388 phone case and portrait rotation guard in live-game E2E.

- A: initial awaitRoll, four compact player summaries on a right rail, one top bar, bottom-lane roll CTA, Dicey pointing toward that CTA. Full detail accessible by opening a player summary.
- B: large centre-playfield tumbling die; no modal or next action yet. CSS animation in mockup is illustrative; it consumes no new game RNG.
- C: authoritative “ทอยได้ 5” before movement; chip persists until next roll. B/C use the same PRE-roll map snapshot so tokens do not prematurely jump to the destination.
- D: shop within the safe gameplay area, one scrollable set of legal choices, pinned Leave action, bottom-lane Dicey; no duplicated action buttons. The prototype's purchase labels come from the real phase-dialog buttons. Prototype purchases do NOT dispatch game actions.
- E: normal round-three turn, four summaries, every existing card field reachable in a detail panel, CTA outside the gameplay area. No fresh roll is inferred from a saved state.
- Loading: preserve the displayed board, show the existing reconnect/awaiting status, disable game actions; no fake die or invented result. Error: existing notice/error route and retry/reclaim semantics remain; no stale legal actions become enabled. Empty: hide an unset last-roll chip and empty event message; bot/no-legal-action state is a status, not a fabricated choice. Text-only Dicey fallback remains when art fails.

Phone mockup lanes: top bar x=8, y=6, h=44; right rail x=W-120, y=64, four 112 × 44 summaries with 12 px gaps; CTA right inset=144, bottom=8, 144 × 44; Dicey right inset=304, bottom=8, 356 × 44. Reserved playfield is x=8, y=58, width=W-144, height=H-118. Desktop uses 160 × 56 summaries, 192 px CTA inset, and a 400 × 52 guide; playfield width=W-192. Account for env(safe-area-inset-*) in the shipped layout. The mockup shows a decorative full-bleed image plus a real camera capture of that safe playfield; it is NOT proof that runtime camera clipping, all tile visibility or FPS is solved.

## Measured evidence and limitations

Source: mockup/before-measure.json and mockup/measure.json, measured by browser scripts against the real local build and the rendered approval HTML. Union of viewport-clipped rectangles; composite surfaces only, no ancestor/child double-counting. The translucent modal shade is excluded; the opaque dialog panel is INCLUDED in the all-surfaces number. “Standard HUD” excludes only the dialog panel, and must not be presented as the total open-shop coverage.

| Viewport | State | Before, all surfaces | After, all surfaces | After, standard HUD | After HUD/HUD overlaps |
|---|---|---:|---:|---:|---:|
| 915 × 412 | A | 32.14% | 21.56% | 21.56% | 0 |
| 915 × 412 | B | 61.20% | 21.84% | 21.84% | 0 |
| 915 × 412 | C | 61.20% | 21.56% | 21.56% | 0 |
| 915 × 412 | D | 61.20% | 43.49% | 21.56% | 0 |
| 915 × 412 | E | 21.51% | 17.40% | 17.40% | 0 |
| 1280 × 720 | A | 18.23% | 12.87% | 12.87% | 0 |
| 1280 × 720 | B | 31.04% | 12.43% | 12.43% | 0 |
| 1280 × 720 | C | 31.04% | 12.31% | 12.31% | 0 |
| 1280 × 720 | D | 31.04% | 30.52% | 12.87% | 0 |
| 1280 × 720 | E | 13.88% | 10.61% | 10.61% | 0 |

B/C before screenshots expose the current defect: real HUD advances to shop BEFORE the board animation commits, so the current game already displays a phase panel rather than a die/result. They are genuine current-build captures, not retouched proposal images. The phone before B/C/D each have three measured surface overlaps; exact pairs are in before-measure.json. Comparing their percentages directly with the nonmodal proposal is not an apples-to-apples idle HUD comparison; A/E are the clean comparisons.

Executed:
- `git status --short`; initially clean; final expected only untracked BRIEF.md and mockup/. `git rev-parse HEAD` and `git rev-parse origin/main`: both the SHA above, exit 0.
- `VITE_TEST_HOOKS=1 npm run build -w apps/client`: exit 0; Vite built worker/client; pre-existing >500 kB bundle warning. Built only ignored dist artifacts, no product edits.
- `node_modules/.bin/tsx mockup/snapshots.ts`: exit 0; real seeded engine replay produced first roll 5, shop round 1, normal turn round 3 after 53 legal actions. Snapshot generator does not mutate engine source or invent state transitions.
- `node mockup/server.mjs`: local preview, port 4195. `curl --fail --silent --output /dev/null http://127.0.0.1:4195/`: exit 0.
- `/home/jaochai/.local/bin/run-locked dice-bandits-e2e node mockup/capture.mjs`: exit 0; 10 before PNGs, 6 raw and 6 safe camera captures. Safe captures alter only the test runner's live camera, after the unmodified before shots, not shipped source.
- `/home/jaochai/.local/bin/run-locked dice-bandits-e2e node mockup/verify.mjs`: exit 0; 18 checks, 10 primary state/viewport cases, 0 page/network errors, 0 measured HUD/HUD intersections. Also rendered four loading/error PNGs, exercised the interactive B→C→D demo at both widths, and verified reduced-motion immediate result plus seat-detail open/close. These are prototype checks, NOT production E2E passes or an axe audit.
- From apps/client: `../../node_modules/.bin/vitest run test/event-order.test.ts test/controller.test.ts test/onlineController.test.ts test/hud.test.ts test/ui/diceyTip.test.ts`: exit 0; Test Files 5 passed (5), Tests 64 passed (64). Baseline tests only; no new implementation tests were written or purported to fail/pass.

Not run: full local E2E, full unit suite, lint, typecheck, whole-workspace build, CI, deployment, mobile device testing, automated axe, runtime camera/token occlusion acceptance or FPS benchmarks. Prototype scripts/assets are approval artifacts and should NOT be copied wholesale into the product or CI glob.

## Review focus

1. Destroy/exit/reconnect during result hold: cleanup must settle promptly and never mount the old game's dialog afterward.
2. Early phase change: shop/levelUp/battle legal actions must not appear on a still-rolling old board; stale online legal arrays cannot be borrowed for nextState.
3. Bonus/forced/three-sided rolls: count and total remain truthful, including values greater than six; no invented face array.
4. Resize, whole-map and fork clicks: safe viewport projection and hit-testing still use the same actual camera matrix; preserve painted gutters and tile size, not just token centering.
5. Battle and takeover: board rail/guide CSS must not overwrite the established battle HP/takeover composition, pass-device flow or hidden attack choices.

## Ordered cards (create only after approval)

Sequence: U1 → U2a → U2b → U3 → independent QA/release. U1 may be deferred until D1/D2 are resolved. All shared hud.ts/styles.css changes are serial collision hotspots; never dispatch these cards concurrently against the same base. Each card carries this project context and the approved D1/D2 decisions in its body.

### U1 — Truthful dice presentation and last-roll chip (8 files; D1/D2 approval required)

Files:
- Create src/ui/diceRoll.ts and test/ui/diceRoll.test.ts under apps/client.
- Modify apps/client/src/main.ts:95-124,154-187,322-403 (both local and online paths, initial/destroy lifecycle).
- Modify apps/client/src/ui/hud.ts:21-34,60-71,207-232.
- Modify apps/client/src/ui/styles.css (new `.dice-roll` and `.last-roll-chip` rules; do not refactor existing media queries).
- Modify apps/client/src/i18n/en.json and th.json.
- Create apps/client/e2e/dice-roll.spec.ts.

Interfaces, fixed before dispatch:
- `type RollResult = { seat: number | null; total: number; count: number; sides: number }`.
- `readRollResult(event: GameEvent): RollResult | null`: only DiceRolled, finite positive integral count/sides and finite integral total; invalid data yields null, never an exception or game action. No per-face field.
- `createDiceRoll(root: HTMLElement): { play(result: RollResult, options: { speed: number; reduced: boolean; waitBeforeMovement: boolean }): Promise<void>; destroy(): void }`.
- `play` replaces the previous transient visual, updates its persistent chip immediately, and settles after 900*speed + 1400*speed ms ONLY for approved local-human waitBeforeMovement=true. Reduced or speed=0 or waitBeforeMovement=false settle without any additional timer. Rendering is text/SVG/CSS, no RNG and no engine action. The persistent chip lives outside HUD nodes replaced by renderHud or is restored from view-only data during every HUD refresh.
- Extend HudOptions with `presentationBusy?: boolean`; OR it with online.awaitingView for tray buttons, phase/reward dialogs and the existing renderBattleUi awaitingView argument. Keep existing optional legal/online fields compatible. The dispatch closure must also ignore stale queued clicks while busy; CSS pointer blocking alone is insufficient. Clear busy before committing the actionable final HUD, not in a microtask after enabled buttons mount.
- Use existing animateThenRender(animate,render). For approved local-human rolls, old displayed HUD is made busy first; await play BEFORE BoardScene.playEvents, then commit HUD/guide/banner/registry/scene-state together. Do not render nextState's shop/perk/battle before movement. Preserve guide eligibility rules and the existing online legal/view handoff. Online and bot paths get no additional awaited hold under approved D2.
- New translations: `dice.rolling`: TH “กำลังทอย…” / EN “Rolling…”; `dice.result`: TH “ทอยได้ {value}” / EN “Rolled {value}”; `dice.count`: TH “{count} × d{sides}” / EN same. t() already supports parameter interpolation. U3 owns tip-copy changes, not these keys.

Five execution steps:
- [ ] Write failing tests in test/ui/diceRoll.test.ts: the real `{value:5,dice:1,sides:6}` payload produces total=5/count=1; multi-dice 9/count=2 has no fake face array; fake timers prove local play remains pending at 899 ms, result visible at 900, movement callback not called until 2300; reduced/speed0/online/bot paths add no timer; replacing/destroying settles pending play and removes old overlay without erasing a newer chip; no GameState/transport references. E2E seed ux-18 proves token display coordinates unchanged through B/C and only then move, no premature shop, persistent result survives language and HUD refresh, double-click produces one roll. Expected before implementation: missing module/overlay/total and early dialog failures.
- [ ] From apps/client run `../../node_modules/.bin/vitest run test/ui/diceRoll.test.ts` and capture actual red output; do not describe baseline tests as red.
- [ ] Implement the exact interfaces above and both main.ts paths. Snapshot previous display state, not controller.state after a local roll. Attach ownership/abort cleanup to destroyGame; an exited game's finally must not remount old UI. Existing GameController guard and online.awaitingView remain; no controller/protocol/save edits.
- [ ] Re-run the new unit file and baseline event-order/controller/onlineController tests. Run targeted browser command from repo: `/home/jaochai/.local/bin/run-locked dice-bandits-e2e npm run e2e -w apps/client -- dice-roll.spec.ts --workers=2`. Record real outputs. At card end run the complete gate below, full E2E at most once.
- [ ] Self-review truthfulness, cancellation, both entry paths, actual D2 timing policy, and commit only this approved card's files on its feature branch. Hand off evidence; no deploy/merge.

Acceptance: B/C visible before local-human movement; total exact; no faces fabricated; no next-phase clickable UI during presentation; clean destroy and pending-promise settlement; D2 exceptions visible in release notes; both languages; baseline flows preserved. Out of scope: per-die engine telemetry, online view-queue rewrite, RNG, changing bot delay, replacing BoardScene effects, audio redesign.

### U2a — One compact bar and accessible player summaries (7 files)

Files:
- Modify apps/client/src/ui/hud.ts:69-96,163-206,235-249.
- Modify apps/client/src/ui/styles.css:302-440,965-1156,1440-1469,1547-1584 (board-only selectors).
- Create apps/client/src/ui/seatDetails.ts.
- Modify apps/client/test/hud.test.ts, test/reskin.test.ts, e2e/layout.spec.ts, e2e/mobile-fill.spec.ts.

Interfaces:
- Keep renderHud(root,state,dispatch,options?):void, all existing data-testid values, action indexes and event text status semantics. Move turn-ribbon and event-banner nodes INSIDE game-topline; do not leave hidden duplicate elements with the same IDs.
- Keep existing audio-toggle accessible; a compact icon fits the same bar alongside world-chip/map-toggle/menu. The mockup routes sound via menu; the product must retain the established standalone audio test contract unless the owner explicitly approves migrating it. Round, turn, world details and event expansion remain keyboard-operable.
- `showSeatDetails(root: HTMLElement, state: GameState, seat: number, onClose: () => void): () => void` in seatDetails.ts: reuse existing localized player-card data, display name/prank alias, class, gold, level, owned towns, HP with max, bandit-card count/list and takeover/reclaim information. No game mutation. Native summary buttons are labelled and restore focus on close/Escape; no reliance on hover/title.
- Preserve existing corner-* classes for compatibility but position the BOARD summaries in the approved right rail. Do not change the `.battle-mode` card placement or HP cards. Compact summaries show name/gold and an explicit takeover indicator when present; details contain the fields moved out of the summary.

Five execution steps:
- [ ] Add red assertions in test/hud.test.ts for exactly one top bar owning all status/control IDs, four labelled open-detail controls, readable detail meter/stats/card count even zero, correct local/online takeover details, Escape/focus restoration and no dispatched actions. Update the old “four corners” expectation to preserve seat order/classes but assert rail/detail behavior. Extend layout/mobile-fill tests with composite union coverage and sibling-surface overlap checks; do not sum header and children. Expected red: separate turn/event nodes and no accessible detail control.
- [ ] Run the changed unit files to capture actual failures: `../../node_modules/.bin/vitest run test/hud.test.ts test/reskin.test.ts` from apps/client.
- [ ] Implement the header/rail/detail interfaces and the approved token sizes. Scope all rail rules to `.game-shell:not(.battle-mode)`; leave native menu/language/audio behavior intact. Long names wrap in details without shrinking below 12 px or hiding takeover status.
- [ ] Run changed units and targeted browser specs: `/home/jaochai/.local/bin/run-locked dice-bandits-e2e npm run e2e -w apps/client -- layout.spec.ts mobile-fill.spec.ts --workers=2`. Initial/midgame ordinary board HUD with tips off <=22% at 915×412 (U3 owns the final guide-inclusive target), all mutually exclusive modal cases reported separately; non-overlapping top surfaces and 44 px controls. Keep existing FPS/full-bleed assertions, no threshold weakening. Run full gate once at the end.
- [ ] Self-review both languages and battle CSS exclusion, commit only the seven files, and hand off exact changed selector contracts/results.

Acceptance: round/turn/world/menu/map/audio/event and all player information still reachable; no duplicate status IDs; ordinary phone chrome with tips off <=22% (guide-inclusive target owned by U3); no HUD/HUD intersection; battle HP/takeover behavior unchanged. Out of scope: camera geometry (U2b), dialog/tray dedupe and guide positioning (U3), modifying the menu protocol, shrinking typography to conceal overlap.

### U2b — Safe gameplay camera with full-bleed decorative backdrop (7 files)

Files:
- Modify apps/client/src/scenes/board/camera.ts:61-110.
- Modify apps/client/src/scenes/BoardScene.ts:37-58,121-167,170-233.
- Modify apps/client/test/art/camera.test.ts, test/art/boardScene.test.ts.
- Modify apps/client/e2e/board-edge.spec.ts, e2e/board-m5a.spec.ts, e2e/mobile-fill.spec.ts.

Interfaces:
- `type BoardInsets = { left: number; top: number; right: number; bottom: number }`.
- `boardViewport(logical: {width:number;height:number}, css: {width:number;height:number}, insets: BoardInsets): {x:number;y:number;width:number;height:number}`: clamp finite positive dimensions and convert CSS lane insets to logical pixels. Insets are the approved lanes incl. device safe areas; never mix CSS and logical pixels.
- Gameplay camera remains `scene.cameras.main` so existing helpers.ts:26-76, forkArrows, spaceTaps, and getViewMatrix tests use the actual correct camera. Retain the original camera as full-canvas decorative backdrop; add safe gameplay camera with `cameras.add(x,y,w,h,true,'board-playfield')`. The pinned Phaser declaration supports add(...makeMain,...name), types/phaser.d.ts:4296, and camera.ignore(entries), :3365. Isolate background map objects from foreground/token objects; never show duplicate playable tokens outside the safe viewport.
- Existing cameraTarget(state,wholeMap,view) and cameraBounds(view,wholeMap) signatures remain; use actual safe-camera width/height for whole-map fit. Preserve gameplay zoom's minimum CSS tile size rather than zooming out to fit HUD. Background is decorative, not a second input surface. Paint existing gutters so canvas edges never reveal the renderer background.
- Reapply viewports, bounds, main-camera centering, background isolation and culling after resize/redraw; stop/remove the extra camera on scene shutdown. Do not recreate map every animation frame. The mockup captures only the intended framing; actual two-camera FPS must be tested.

Five execution steps:
- [ ] Write red unit cases for viewport CSS→logical conversion at both targets and 932×388, bounded invalid dimensions, whole-map fit, main camera identity, shutdown and resize, background camera excluding all tokens/buildings/roads/interactive markers. Extend existing scene doubles to include camera.add/ignore. E2E projects through main getViewMatrix after postrender and asserts active token/neighbor path clear all chrome, active actor complete, tile >=48 CSS px on phone, CTA/guide clear visible path, and painted edges/full-bleed/FPS unchanged. Expected red: current single camera has no lane inset/background isolation.
- [ ] Run `../../node_modules/.bin/vitest run test/art/camera.test.ts test/art/boardScene.test.ts` from apps/client and capture actual failures.
- [ ] Implement boardViewport and camera isolation without changing draw assets, engine coordinates, logical game dimensions or Scale.EXPAND. Keep fork arrows hit-tested through the safe main camera; backdrop cannot absorb touches.
- [ ] Re-run unit cases and targeted browser specs: `/home/jaochai/.local/bin/run-locked dice-bandits-e2e npm run e2e -w apps/client -- board-edge.spec.ts board-m5a.spec.ts mobile-fill.spec.ts --workers=2`. Existing full-bleed/layout FPS gates remain in the final full suite. Report actual token/tile intersection and FPS values; static mockups are not evidence for these. Full gate once at card end.
- [ ] Self-review whole-map/resize/click projection and second-pass renderer cost, commit only the seven files and hand off measured results. If the camera pass misses the existing FPS gate, stop for design review rather than lowering the threshold.

Acceptance: gameplay actors/path remain in the safe area and tappable; tile size preserved, full-bleed painted background; no duplicate outside-camera actors; whole-map and portrait guard still work; existing Canvas fallback FPS gate passes. Out of scope: map reauthoring, new backgrounds/art, physics or board graph edits, helper instrumentation in shipped code, redesigning battle camera.

### U3 — Single modal choice surface and anchored truthful Dicey (8 files)

Files:
- Modify apps/client/src/ui/hud.ts:207-232.
- Modify apps/client/src/ui/diceyTip.ts:30-85,125-162.
- Modify apps/client/src/ui/styles.css:1137-1156,1765-1793,1816-1863.
- Modify apps/client/src/i18n/en.json and th.json:305.
- Modify apps/client/test/hud.test.ts and test/ui/diceyTip.test.ts.
- Create apps/client/e2e/hud-dialog-guide.spec.ts.

Interfaces:
- Preserve showPhaseDialog(root,state,actions,dispatch,disabled=false):void and showActionDialog(root,actions,dispatch,disabled=false):void. No dialogs.ts changes are needed for action dedupe: HUD owns the decision.
- For actionable human/local-online shop and levelUp, and for pvpReward with reward choices, render exactly ONE appropriate dialog and mark action-tray hidden/inert with no mirrored action buttons. Do not create a blank phase dialog for a bot or remote/noneligible human. Awaiting views/roll presentation cannot mount fresh choices; townManage remains a tray phase, not a modal. Restore tray on leaving modal/battle transitions, and never hide battle/pass controls accidentally.
- Preserve action index mapping and every `shop-shopBuy-*`, `shop-shopSell-*`, `shop-leave-*`, `perk-*`, data-choice and existing dicey-tip/dicey-tip-ok selector.
- Keep showDiceyTip(root,topic,onDismiss):()=>void and createDiceyGuide(root) update/dismiss/destroy contract unchanged. Position the visible roll tip in the approved bottom lane, using measured CTA coordinates; triangle points to action-roll, not the decorative die. For shop/levelUp/reward point toward the modal or omit the pointer, never leave a misleading roll pointer. Bind resize/ResizeObserver only while a tip exists; clean subscriptions/observer on dismissal/destroy/reset.
- Exact `dicey.tip.roll`: TH “แตะปุ่มทอยเต๋า แล้วดูแต้มก่อนเดิน”; EN “Tap Roll, then watch the result before you move.” Under approved D2, the guide is local-human only as today; online variant must not promise a timed before-movement hold that D2 excludes. If shared online roll copy is required, use EN “Tap Roll to see your dice total.” / TH “แตะปุ่มทอยเต๋าเพื่อดูแต้มที่ได้” consistently in both modes instead, and have owner approve that copy before dispatch. No tip delays, no acknowledgement required to play.

Five execution steps:
- [ ] Add failing unit tests: local and online-eligible shop/levelUp each have one choice set, zero tray choice buttons, disabled dialogs cannot dispatch, bot/remote shop has no empty modal; pvpReward one set, townManage tray restored; tip/triangle tracks real roll CTA through resize and language switch; OK/action dismissal leaves GameState unchanged and cleans observer/subscriptions. New E2E exercises real shop, levelUp, townManage and both languages, rectangle intersections plus elementFromPoint hit checks, 44 px OK and controls, no ellipsis; also battle/pass/takeover regression cases. Expected red: duplicated choice sets and fixed-left guide.
- [ ] Run `../../node_modules/.bin/vitest run test/hud.test.ts test/ui/diceyTip.test.ts` from apps/client and capture actual failures.
- [ ] Implement dedupe/eligibility in HUD and view-only guide positioning/copy. In modal states hide the entire tray, not just its text children; keep the guide in the exterior bottom lane. Do not introduce guide callbacks into controllers or transport. Preserve text-only art fallback, seen-topic behavior, settings reset and both existing online view handoffs.
- [ ] Re-run units and targeted browser command: `/home/jaochai/.local/bin/run-locked dice-bandits-e2e npm run e2e -w apps/client -- hud-dialog-guide.spec.ts dicey-core.spec.ts dicey-rework.spec.ts dicey.spec.ts battle-hud.spec.ts --workers=2`. All existing Dicey semantics and battle HP/takeover/hidden-pick tests must remain green; capture exact numbers. Full gate once at card end.
- [ ] Self-review modal exit/role/keyboard behavior, cleanup, both languages and timing exceptions, commit only these eight files and hand off evidence.

Acceptance: no duplicate modal/tray choices, guide points to the real roll control, text truthful in the approved timing modes, every existing Dicey lifecycle and battle/takeover condition preserved. Out of scope: changing tips topics/triggers, game turn scheduling, loot/shop rules, random copy edits to unrelated tips, controller/protocol/save changes.

## Existing selectors/assertions affected

- hud.test.ts:57-78 checks corner classes and labelled stats. Keep seat order/corner classes; move expanded stats to an accessible detail panel and update the assertion to open it rather than silently dropping those fields.
- layout.spec.ts and mobile-fill.spec.ts currently measure .seat-card/.action-tray/.event-banner/.turn-ribbon and game-topline children. Composite top bar becomes one measurement surface; do not also count its descendants. Use real projected camera bounds via helpers.ts:26-76; preserve full-bleed/FPS/min-font and visible-token assertions.
- dicey-core.spec.ts:28-38 and dicey.spec.ts:58-69 measure ancestor .game-topline alongside child controls. Once the guide clears the bar, zero-overlap still holds. Their IDs, 44 px checks, real-state immutability, queue seen/reset, online eligibility and both-language expectations must remain. Copy expectations import locale files and should follow the approved exact text, not be weakened.
- dicey.spec.ts:83-137 selects shop-shopBuy-<item> and expects real engine state transition and tip dismissal. Preserve those dialog IDs. Do not keep duplicate hidden test-id buttons that cause strict-locator ambiguity.
- battle-hud.spec.ts:19,83-100 requires menu/map/audio controls visible and HP clear; keep standalone audio-toggle in the shipped bar, all takeover cards and the actual battle geometry. Board-only rail CSS must not change those battle placements. The prototype's menu-only sound shortcut is not approval to delete that contract.
- fork-popup.spec.ts, board-edge.spec.ts, board-m5a.spec.ts and helpers.ts use the real scene's main camera. Keep that camera as gameplay main; do not retrofit helper calculations to “make” a broken camera pass.
- reskin.test.ts and reskinPalette.test.ts lock token values/legacy removal. Leave theme.css intact; amend a structural expectation only where the owner-approved bar/summary layout truly changes it, never to bypass palette or font constraints.

## Complete implementation gate (exact commands, run separately from repo root)

1. `npm run test`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run build`
5. `/home/jaochai/.local/bin/run-locked dice-bandits-e2e npm run e2e`

The last command builds the client with VITE_TEST_HOOKS=1 using the existing package script and runs the entire suite, including online workers. Preserve existing storage-state defaults: global E2E disables tips; tip-specific tests enable them themselves. Record exit codes and the actual result lines. No full E2E was run by the architect. Later implementation artifacts must exclude mockup/ from feature commits; do not blindly lint or publish this approval bundle as product source.

## Release acceptance / unresolved risks

- Owner approves phone imagery, the right rail/detail tradeoff, copied real-art camera composition, D1 telemetry limitation, D2 local-human-only timed policy and final tip text. Until then the brief is an approval deliverable, not an implementation authorization.
- All four implementation cards pass their own red/green cycle and the complete gate, with no threshold weakening. Independent QA exercises 915×412, 932×388, 1280×720, TH/EN, reduced motion/speed0, fresh start/resume, bot handoff, online reconnect/stale clicks, shop/perk/reward/town, full/return map, fork popup, battle/pass/takeover and exit during hold.
- Ordinary phone HUD <=22%, no HUD/HUD intersections; modal standard HUD and complete dialog coverage are reported separately. Open shop will intentionally exceed 23% total; the measured prototype is 43.49%, not 21.56% all-surfaces. Owner must approve this modal exemption or request a different modal design.
- Static lane compositing does not prove runtime path/actor visibility, tile >=48 px or FPS. U2b carries those live acceptance tests; camera pass overhead and map culling are explicit risks.
- A large die/result can temporarily cover map art during B/C; it must not be mistaken for a permanently smaller gameplay board. No concealed engine mutation or hypothetical multi-dice faces.
- Full production accessibility is not audited here. Implementers must verify focus, screen-reader status ordering, hit targets and language changes, not merely rectangle area.
- Global out of scope: engine/protocol/save format, bot rules/AI, asset regeneration, new dependencies, unrelated page redesign, analytics, gameplay balance, audio engine, deployment or default-branch writes by Architect.
