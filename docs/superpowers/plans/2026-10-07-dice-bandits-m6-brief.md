# M6 executable release briefs

Status: awaiting owner design approval. This document proposes future build cards; none were created or dispatched. No product code/PR/commit/deployment on this architectural card.

## Shared context and gate

Repository `/home/jaochai/Code/dice-bandits`, GitHub `JaoChai/dice-bandits`; base `main`/`origin/main` at `6784c4b0e490c4ccc9aad2425105660b625ede48`. Anchors below refer to that exact checkout. Rebase/retrace before implementation if main has advanced. Only `apps/client/src/**`, `apps/client/test/**`, `apps/client/e2e/**`, and explicitly approved replacement audio under `apps/client/public/audio/**` are eligible. No `packages/engine`, `apps/server`, online protocol, `save.ts`, `.github`, `tools`, engine balance, deployments or pushes to main. No new dependencies/lockfile edits.
All `src/`, `test/`, `e2e/`, and `public/` manifests below are relative to `apps/client/`; `docs/` paths are relative to the repository root. New paths are explicitly marked new.

Build order: R1 correctness + calmer defaults, then R2 battle, then R3 practice. Land one small card at a time. QA/release are separate team roles. Every card: write its red tests first, implement within its file manifest, run targeted tests while iterating, full gate at the end. Run the full local e2e suite at most ONCE per implementation run. Every browser command, including targeted e2e, uses the lock. Never alter e2e timeouts/FPS floors to make new waits pass.

Full local gate (assembled from the current `.github/workflows/ci.yml:11–20`, using the mandatory browser lock and installed executables; not executed on this design-only card):

```sh
npm run typecheck && npm run lint && npm run format:check && npm test && npm run test:worker && npm run build -w @dice-bandits/client && npm run sim -- --games 200 --players 4 && npm run sim:room -- --games 200 && /home/jaochai/.local/bin/run-locked dice-bandits-e2e npm run e2e
```

Targeted unit pattern: `node_modules/.bin/vitest run --root apps/client test/<spec>.test.ts` (verify client Vitest config resolution); safer existing workspace invocation: `npm run test -w @dice-bandits/client -- <relative-spec>` also runs audio/art budgets. Targeted browser command: `/home/jaochai/.local/bin/run-locked dice-bandits-e2e node_modules/.bin/playwright test --config apps/client/playwright.config.ts <spec>`. Build test hooks beforehand with `VITE_TEST_HOOKS=1 npm run build -w apps/client`. All commands run from repo root; confirm `git status --short --branch` before writes. Use exact-head CI for any later implementation PR; one `gh pr checks <pr> --watch` after final push.

## Design contract: pending approval, not a new design system

Reference `m6/prototype.html`, `m6/gallery.html` and shots. Preserve theme.css: cream `#f5eedc`, cocoa `#5c3317`, panel `#fffdf5`, blue `#2e7fe0`, green `#3ba84a`, gold `#f5c51c`, red `#d42b3a`, purple `#6c2ebe`; other existing class colours unchanged. Secondary readable copy proposal `#805c43` is local component ink, not a replacement for existing global grey. Mitr, existing bundled Thai/Latin fonts; body 16/24 px, compact copy 12/18–14/21 px, phone headings 26 px, desktop 36 px. Spacing grid 4/8/12/16/24/32 px; panel radius 14 px, buttons 12 px, chip radius pill; 2–3 px cocoa outline, existing soft cocoa shadow. Touch controls ≥44×44 CSS px, 3 px blue keyboard focus. Existing atlases only: hero idle/attack/hurt/happy, jellyBun and other monster poses, region backdrops, tile/icon frames, Dicey happy/point/surprised. New art needs a separate owner checkpoint, not a worker's substitute.

Target 915×412 TH and 1280×720 EN; regression target 932×388 TH/EN; preserve existing portrait rotate handling, safe-area insets, whole-map/camera lanes. Mockup fighters are 180 CSS px phone, 330 desktop; tune through the viewport layout function, not DPR/device detection. Never hide remote-seat takeover/reclaim indicators or reveal a pending secret to fit the design. HUD coverage is measured lane union: 21.24→27.56% phone, 11.73→14.79% desktop. This proposal increases coverage; acceptance is no collisions/readability, not an unsupported coverage reduction.

States required across releases:
- Loading: existing art/audio readiness; no gameplay blocking on a new asset. Practice shows Dicey/preparing route until its prevalidated script is available.
- Empty/no events: clear stale movement chip and render the authoritative view; retain current online empty-event handoff fix.
- Error: existing grey art fallback; sound fails silently with existing warnings; unavailable practice script shows retry/back without creating/writing a save. Keep engine/board-outdated error handling.
- Reduced motion: no hopping/lunge/flash/shake/idle breathing; display static source/result and counters immediately. Damage/HP consequence remains legible text; no blocking presentation wait. Speed=0 bypasses all waits/tweens. Stop/destroy/resize/reconnect resolves outstanding work and clears transient DOM/ghosts.

## R1 — fix movement before polishing speed; make sound calmer

### R1-A: all destinations must animate (3 files, 4 steps)

Files:
1. `src/scenes/BoardScene.ts:165–205, 278–317`.
2. `test/art/boardScene.test.ts` (extend existing).
3. `e2e/movement-readability.spec.ts` (new).

Interface: retain `BoardScene.playEvents(events: GameEvent[]): Promise<void>` in this card; no callers changed. At render, populate `spacePositions` from EVERY `state.board.spaces` entry, separately from occupied-token placement. Current code `:312` stores only occupied destinations and silently skips movement. Preserve IDs, coordinates and occupied offsets; do not infer a rectangular grid.

Steps: write red unit for five empty destinations → fix complete lookup → real seeded five-step local scene test → rerun camera/fork tests. Red tests: positions 5→6→7→8→9→10 produce five ordered 200 ms position tweens; destination map includes unoccupied spaces; final token matches real `step` result; speed=0 reaches endpoint with zero tween waits. E2e observe the real Game via existing `observeBoardGame`, assert intermediate projected positions, not only final `getState().players[pos]`.

Acceptance: all five destinations animate in order; no teleport at final commit, no change to engine replay. Baseline expected failure is zero tweens, documented by `m6/evidence/before.json`. This correctness change adds real waits where the bug skipped them: up to 1,000 ms for five steps in BOTH existing local and online awaited playback. Do NOT independently release before R1-C's non-gating online presentation and timing test are integrated; the end-to-end handoff budget must remain unchanged.

Out of scope: slower hops, chip, popup, sound, battle, persistence. Risks: camera pan overlapping the next step; render destroys tokens after animation; stopped scenes leaving promises unresolved.

### R1-B: quieter defaults only (3 files, 3 steps)

Files: `src/audio/settings.ts:9–13`; `test/audio/settings.test.ts`; `e2e/audio.spec.ts`.

Change `DEFAULT_AUDIO_SETTINGS` to `{muted:false,music:0.20,sfx:0.60}`; preserve `AudioSettings`, key `diceBandits.audio`, clamping, mute/autoplay unlock, sliders and every valid saved choice. Fresh/invalid/missing fields inherit new defaults, stored finite values remain authoritative. No migration, no new storage key. Red tests: empty storage gets new gains; existing 0.5/0.8 survives; partial/corrupt/nonfinite values follow existing fallback rules; mute true survives reload. E2e initial slider values and saved preference reload.

Acceptance: new-install volume change only, no audible autoplay before gesture, no autounmute. Out of scope: track replacement, ducking/compression, SFX generation, audio APIs. Ship this independently if layout approval is delayed. Track substitution is optional R1-E after owner audition.

### R1-C: make online presentation non-gating (7 files, 5 steps; prerequisite to R1-A release)

Files: `src/main.ts:179–225`; `src/scenes/BoardScene.ts`; `src/scenes/board/movementPlan.ts` (new); `src/scenes/board/movementOverlay.ts` (new); `test/art/movementOverlay.test.ts` (new); `test/onlineController.test.ts` (extend without editing production OnlineController); `e2e/online-turn-handoff.spec.ts`.

Exact new interfaces:
- `planMovement(previous: GameState, events: readonly GameEvent[], mode: 'human'|'bot'|'online'): MovementPlan`, pure, no RNG/window/imported controller. `MovementPlan = {segments: Array<{seat:number;from:number;to:number;remaining:number;hopMs:number;holdMs:number}>;landingSeat:number|null;landingSpace:number|null}`. The planner follows actual event order and actual board coordinate IDs. `Moved.params.remaining` currently describes BEFORE-consumption except terminal 0: display `n>0?n-1:0`, not `n`, and never derive movement from dice faces alone (perks can alter distance).
- `BoardScene.presentOnlineMovement(previous: GameState,next: GameState,events: readonly GameEvent[],generation: number): void`; detached, non-awaiting. Render authoritative next state first; then create a separate ghost overlay from previous→next; no state mutation and no delayed registry emits.
- `createMovementOverlay(scene): {play(plan:MovementPlan,generation:number):void;destroy():void}`; ghost sprites/rings owned by this overlay, destroyed on generation change/new view/shutdown. Reconcile endpoint token visibility immediately on cancellation. A fresh view/real input supersedes the ghost, including during reconnect.

Steps: red tests for immediate event/view completion → build pure plan → detached scene layer → integrate ONLY online callback after authoritative scene commit → verify real two-device handoff. Remove awaited online `scene.playEvents(events)` from the Promise.all seam; keep existing dice `waitBeforeMovement:false`. Preserve `OnlineController` event/view ordering and public/legal commit. Empty batches still set registry and emit game-state. Do not run engine `step` on received views.

Timing: online added await = 0 ms. Cosmetic walk per segment 120 ms; cap an entire catch-up route at 600 ms by scaling visual segment durations, never by dropping authoritative events. User action/new view cancels presentation; never holds controls disabled once the authoritative view grants legality. Camera/input remain on authoritative board while ghost moves; no viewport-follow that obscures a newly actionable next seat. No extra websocket messages/server deadlines/choice delays. Online battle remains baseline until R2-C supplies equivalent detached playback.

Tests: fake timers prove onEvents resolves before any delayed tween and empty views commit; rapid views only show latest generation; shutdown resolves/no detached DOM; exact ordered endpoint and no token left hidden. Real online-turn-handoff regression must remain within its EXISTING deadline. Acceptance: both clients agree on state/turn/legal, no duplicated dispatch, no ghost writes after reconnect. Out of scope: protocol, OnlineController refactor, battle timing.

### R1-D: local countable walk + arrival card (8 files, 5 steps)

Files: `src/scenes/BoardScene.ts:165–205`; `src/scenes/board/movementPlan.ts`; `src/ui/movementReadout.ts` (new); `src/ui/styles.css` (movement-only rules); `src/i18n/th.json`; `src/i18n/en.json`; `test/ui/movementReadout.test.ts` (new); `e2e/movement-readability.spec.ts`.

Interfaces: extend `playEvents(events:GameEvent[],options?:{mode:'human'|'bot';onStep?:(remaining:number,seat:number)=>void}):Promise<void>`. Without an explicit mode, infer human/bot from the moved seat in this scene's latest state, not turnSeat in the next state. No main.ts change is needed in this card. BoardScene owns `createMovementReadout(root): {step(remaining:number,seat:number):void;land(spaceId:number,events:readonly GameEvent[]):void;clear():void;destroy():void}`, using its canvas's nearest app mount; destroy it on scene shutdown. Consume actual GoldGained/space outcome text; never invent a reward or reopen interactive dialogs. Keep existing `spaceInfo` tap popup and blocking dialogs untouched.

Human target per space: 280 ms hop + 120 ms planted pause, five spaces 2,000 ms; landing highlight 180 ms plus non-modal outcome card 650 ms = total 2,830 ms, excluding roll/fork/user/bot waits. Bot: 120 ms motion + 40 ms pause, landing 250 ms, five steps target 1,050 ms excluding existing random bot think delay. Add no new think delay. Reduced/speed=0: static endpoint/counter, no added wait. Fork/duel pauses exactly where the engine emits them; only passed tiles get temporary highlight; popup ONLY true final landing. Clear on next turn, battle/pass/dialog, exit, online view, or language change as appropriate. String keys `movement.remaining`, `movement.arrived`, `movement.gold`; Thai `เหลือ {count} ช่อง`, not English in a Thai frame.

Red tests: counter 4,3,2,1,0 for the five-event fixture (not erroneous 5,4,3,2,0); duplicate/invalid events don't dispatch; fork resumed batch starts from real phase; bot policy is faster; loading/error/empty batch cleanup; reduced motion no animation wait. E2e exact per-space dwell and usable next action, camera clamped, event card doesn't cover mover or actionable dialog. Existing affected: dice-roll, board-m5a, board-edge, fork-popup, hud-dialog-guide, dicey-rework, mobile-fill, full-game, online-turn-handoff. Keep full-game's 90-second budget and local rAF floor ≥30 from layout.spec.ts:133/board-edge.spec.ts:248. This study did NOT measure new production FPS.

Out of scope: map replacement, tutorial, new art, changes to dice result/engine. Hotspots: main.ts integration, styles.css, TH/EN. Serialize ownership with R1-C, then R2/R3.

### R1-E (optional after music decision): replace the two existing tracks (7 files, 4 steps)

Files: `public/audio/music/board.ogg`, `board.mp3`, `battle.ogg`, `battle.mp3`; `public/audio/CREDITS.md`; `test/audio/assets.test.ts`; `e2e/audio.spec.ts`.

Keep `MusicId='board'|'battle'`, URLs, cache/crossfade and selector unchanged. Proposed choices A/B in STUDY; C remains provisional until artist grant verified. Steps: retain source/grant/hash evidence → audition loop/normalise to existing -18 LUFS/-2 dBTP process → replace both codecs → budget/autoplay/load-failure tests. Red test asset hashes/duration/codec/URL, then decoded playback continuity. Acceptance: verified CC0/CC-BY grant and credits/modification notice; actual loop audition; ≤1,500,000 bytes/file, ≤4,000,000 total audio, SFX ≤300,000; fallback MP3 works. No new track ID/dependency. Do NOT implement before owner's listening choice; no candidate bytes downloaded in this card.

## R2 — causal battle presentation without changing combat

### R2-A: viewport-owned combat composition (6 files, 4 steps)

Files: `src/scenes/battle/layout.ts:1–44`; `src/scenes/BattleScene.ts:122–154`; `src/scenes/battle/fighters.ts:175–252`; `src/ui/styles.css:1274–1438,1465–1467`; `test/art/battleLayout.test.ts`; `e2e/battle-hud.spec.ts`.

Retain `battleLayout(width,height):BattleLayout`; add `fighterHeight:number`, `groundY:number`, `exchangeY:number` to returned layout. Consumers stop using fixed global Y/height for viewport-sensitive placements; preserve exported constants until all callers/tests migrated. Logical battlefield fills canvas; target CSS fighters 180 phone/330 desktop after real canvas scaling. HP at side corners below top controls, command row bottom-centre, role/exchange label top-centre in available gap; reserve existing safe areas/takeover rows.

Red tests: 1280×720 AND actual EXPAND logical size mapping from 915×412, plus 932×388; feet/torso/hit labels/card lanes agree. E2e real sprite bounds and DOM rects, no fighter overlaps HP/command row, no top controls/ribbon overlap, TH long names wrap without clipping. Existing layout720/coords/language tests remain part of full gate; update expected design coordinates only after owner approval, not delete regressions. Acceptance: same roster/art/backdrops, command labels legible, remote status still visible. Out of scope: effect timing/damage/turn/privacy.

### R2-B: pure seven-beat plan (3 files, 4 steps)

Files: `src/scenes/battle/presentation.ts` (new); `test/art/battlePresentation.test.ts` (new); `src/scenes/battle/effects.ts:14–35` (export/reuse `DamageEvent` and existing `damageTargets`, no playback changes here).

Interface: `planBattle(previous:GameState,next:GameState,events:readonly GameEvent[],mode:'human'|'bot'|'online',reduced:boolean): BattleBeat[]`. `BattleBeat={kind:'reveal'|'anticipation'|'lunge'|'impact'|'damage'|'drain'|'result';duration:number;targets:Array<{side:'a'|'b';amount:number;fromHp:number;toHp:number}>;result:'nextHalf'|'nextExchange'|'win'|'loss'|'draw'|null}`. Resolve identities using battle a/b's seat or monsterId, never assume a always attacks or the turn player is the recipient. Derive damage from events and clamp displayed HP against authoritative stats; no new rules/random numbers.

Human durations: reveal240, anticipation220, lunge160, impact100, damage500, drain350, result650; sum 2,220 ms, excluding human command selection. Eight understandable stages include the untimed command choice. Bot uses total ≤600 ms by proportional scaling; online duration is cosmetic, ≤600 ms and never awaited. Reduced/speed=0 duration zero/static result, no flash/shake. Counters can damage the attacker or both targets; use one simultaneous consequence beat rather than doubling wait per target. Secret card back stays secret until reveal event; no inspecting opponent pending pick for a pre-reveal label. Zero/miss uses explicit miss/blocked text, not a made-up −0 hit.

Red cases first: fixture monster attacks a; player a attacks b; counter reflection; mutual damage; KO/overkill/clamp; zero damage; secret privacy; no-battle/no-damage/empty event batches; result nextHalf vs victory; reduced/online budget and deterministic repeatability. Acceptance: exactly event-derived values and identities; no “win” when exchange continues. Out of scope: DOM, new SFX, controller/protocol.

### R2-C: play beats and tween display HP safely (8 files, 5 steps)

Files: `src/scenes/BattleScene.ts:45–80`; `src/scenes/battle/effects.ts:52–107`; `src/ui/battleUi.ts:33–50,72–109`; `src/main.ts:179–225,389–437`; `src/i18n/th.json`; `src/i18n/en.json`; `test/battleUi.test.ts`; `e2e/battle-feel.spec.ts` (new).

Interfaces: `BattleScene.playEvents(events,speed,options?:{previous:GameState;next:GameState;mode:'human'|'bot'|'online';onBeat?:(beat:BattleBeat)=>void}):Promise<void>`; `createBattleReadout(root): {showBeat(beat:BattleBeat):void;reset(state:GameState):void;destroy():void}` exported from battleUi.ts. Use R2-B's plan, R2-A's actual layout torso/label positions. HP numeric display/aria meter stays at its currently presented value until drain; animates from previous HP to authoritative next HP; controller state is never edited. On cancel/reduced motion/speed0 reset display to authoritative final HP synchronously. Existing `renderBattleUi` signature remains source-compatible; add optional readout parameter only if needed, after existing booleans.

Steps: red DOM display/aria/motion tests → action/reveal sequence → anchored effect+HP drain → main local/online lifecycle integration → real battle E2e. Local humans await seven beats; local bots cap presentation at600 ms (no extra think delay). Online callback commits registry/view exactly as before; schedule separate generation-owned ghosts/readout only AFTER the commit, returns immediately. New views, actions, pass screen, exit and reconnect cancel ghosts/tweens and reconcile display HP; no long await in OnlineController and no secret leaking into spectator/hot-seat DOM. Preserve action dispatch lock and existing awaitingView legal gates. Pending hot-seat picks still require passDevice flow. Never store a hidden pick in HTML or accessible text.

Acceptance: one correct attack→hit→damage→HP→result sequence; no action dispatch during local presentation; online newest legal action immediately available after view; no new server timeouts; all local waits settle on scene shutdown before animateThenRender's10-second fallback. Existing regressions: battle-hud, layout, art-readiness/fallback, online-turn-handoff, reconnect, full-game, console, i18n, audio. Test real reduced-motion matchMedia, speed=0, counter/miss/secret and battle end transition. No FPS floor reductions; requestAnimationFrame cadence alone is not proof of rendered scene FPS, retain existing gate and record actual renderer when collecting evidence. Out of scope: new art, voiceover, engine damage, changes to legalActions or online protocol.

## R3 — on-rails first practice, isolated from real games

Strictness recommendation: on-rails by default, one clear legal highlighted action per teaching step; secondary Exit practice always available. This is an OWNER decision, not already approved. Free exploration would need recovery logic and another scope/design round. Keep the already approved eight subjects, one human + one bot, entry title + offer after first comic, ending Start real game. No separate training map without owner/engine review.

### R3-A: seed feasibility and executable script (3 files, 5 steps; explicit go/no-go)

Files: `src/tutor/script.ts` (new pure config/data); `test/tutor/script.test.ts` (new); `docs/plans/m6-tutorial-route.md` (new proof/report).

`TutorialScript={id:string;config:GameConfig;replay:Array<{seat:number;action:Action}>;lessons:Array<{topic:'roll'|'move'|'fork'|'chest'|'battle'|'shop'|'town'|'steal';replayIndex:number;beforePhase:GameState['phase']['kind'];suggested:Action}>}`. Use `createGame(config)` and only `step`/`legalActions`; validate each suggested action for its real acting seat. Bot actions must match existing deterministic `chooseAction`. No setting `forcedRoll`, RNG/HP/gold/positions, engine mocks, canned fake results or arbitrary intermediate state fixtures in product.

Steps: red validator for illegal/desynchronised replay → bounded offline seed+human-choice search in the TEST file (not tools/**) → freeze one canonical script → replay/hashes/lesson coverage test → report observed action counts and estimated/measured runtime. Target ≤40 human decisions and 3–5 minutes; these are acceptance targets, not demonstrated facts. Search budget is finite (document seeds/states tried and real elapsed time); failed search is a go/no-go handoff, not permission to edit engine. This study proved only a five-step movement and a battle fixture, NOT the complete short eight-topic route.

Acceptance: legal replay covers the eight topics in teaching order, town claim and HUMAN robbery demonstrated, no unwanted human KO/long detours, bot replay stable, seed not a privileged production cheat. If infeasible, block the tutorial build and return a concrete owner choice (shorter curriculum vs checkpoint chapters vs scoped engine support); do not silently implement a different tutorial. Out of scope: tutorial screen, networking, save changes.

### R3-B: practice state machine and save isolation (5 files, 4 steps)

Files: `src/tutor/practice.ts` (new); `src/controller.ts:21–30,59–61,118–125`; `test/tutor/practice.test.ts` (new); `test/controller.test.ts`; `e2e/practice-isolation.spec.ts` (new).

Add optional constructor flag `persist?:boolean` to GameController, default true; guard ALL existing saveGame calls (constructor/human/bot/error paths) through one private persist helper. Do not edit save.ts or change normal controller defaults. `createPractice(script,onProgress): {controller:GameController;topic:TutorialScript['lessons'][number]['topic'];allowedActions():Action[];dispatch(action:Action):Promise<void>;restart():void;destroy():void}` uses persist=false and deterministic script policy. Reject unintended human actions against BOTH legalActions and current canonical suggestion; never auto-dispatch a human teaching action. Bot loop remains existing chooseAction; bot results advance replay cursor but not an uncompleted human lesson. Completion occurs only after real scripted milestone events, not a slide advance.

Red tests: initial save sentinel unchanged on construction, dispatch, bot action, error, restart, exit and completion; normal controller still saves; exact script progression, double click ignored, invalid action does not mutate; lesson completed once; destroyed callback ignored. E2e actual localStorage bytes preserved (not only has-save boolean). Acceptance: all eight goals achieved via engine, one human/one bot, no room/session creation, no save overwrite. Out of scope: new UI, engine changes, persistence redesign.

### R3-C: practice UI and title/comic entry (8 files, 5 steps)

Files: `src/ui/practiceUi.ts` (new); `src/ui/screens.ts:1–90`; `src/ui/introComic.ts:17–38,110–125`; `src/main.ts:355–364,474–506`; `src/ui/styles.css` (practice-only rules); `src/i18n/th.json`; `src/i18n/en.json`; `test/ui/practiceUi.test.ts` (new).

Exact interfaces: `showTitle(onNewGame,options?:{onPractice?:()=>void})` source-compatible optional parameter; `openIntroComic({onClose,onPracticeOffer?})` optional callback; only the first-visit completion offers practice (not every story replay/skip). `mountPracticeUi(root,session):{update():void;destroy():void}`; `startGame(state,options?:{practice?:ReturnType<typeof createPractice>})` in main must use session controller when practice is supplied, not construct a second saving controller. Game exit routes through practice.destroy back to title; Start real game opens the existing setup, never silently starts a seeded real game. Preserve comic seen flag, Continue button, tips toggle and intro focus management.

Screens: four approved key frames: Dicey invitation/progress, first roll halo, first battle defence instruction, completion with Start real game + Replay. Also script-loading, unavailable-script/retry/back, empty/finished, exit confirmation. Overlay highlights one existing action; never covers the actual action, HP or moving token. During practice disable competing first-time tips without writing their settings/seen flags. TH/EN live change, keyboard focus, Escape/Tab, ≥44 px targets, reduced motion static pointers. Do not add practice to online routes. Red unit tests: entry callback isolation, four states, title Continue unchanged, first-visit offer once, focus restoration, no duplicated tooltip; no valid-script means no controller/save created.

Acceptance: owner-approved mockups realised using existing Dicey art and tokens; user can exit/replay/start setup; no storage/protocol side effects. Out of scope: free exploration, new characters/maps/music.

### R3-D: real tutorial journey verification (3 files, 3 steps)

Files: `e2e/practice.spec.ts` (new); `e2e/practice-isolation.spec.ts`; `e2e/intro.spec.ts` (extend first-visit offer assertion).

No fake `window.__db` state replacement in acceptance journey. Begin at title, follow actual highlighted controls, verify eight event-driven goals and completion using the frozen seed; try exit/replay and real setup; prove the saved game can still Continue unchanged. Run TH915×412, EN1280×720, 932×388 regression and reduced-motion/speed0. Deterministic test atspeed0 verifies legality; separately record a production-speed guided run to check 3–5-minute target (allow deliberate user reading time to be annotated, not hidden). Test console errors, action collision and bot waits; no test-time forced-roll endpoint in prod.

Acceptance: all goals + entry/comic/replay/exit/save isolation verified, exact durations/event counts recorded. Out of scope: full gameplay mechanic changes or lowering existing gate thresholds.

## Risks, collisions and approval gates

1. Correct movement restores previously missing waits: release only after non-gating online integration. Longer local human presentation may threaten full-game90 s atspeed1; the existing journey uses speed0, but test it rather than assume. Keep existing budgets.
2. Main.ts owns generation, HUD commit, event ordering, Dicey and scene lifecycle. It is the highest collision hotspot: R1-C → R1-D integration → R2-C → R3-C serially, never parallel main edits. styles.css and TH/EN are secondary serial hotspots. Comments must identify them.
3. A large token fixture can have forks/duels split across event batches; planner state must not reset “remaining” per batch. Reflect counters, missing art, damage to both sides and battle ending within same batch.
4. CSS geometry evidence covers the prototype, not Phaser performance/network/timer gates. No claim of production correctness/FPS based on these mockups.
5. Tutorial seed feasibility is genuinely unproven; R3-A must pass before promising implementation. No engine change is currently justified.
6. Audio loudness/mood/loop is not established by slider screenshots. Artist grant for candidateC remains provisional; owner listening approval before track work.

Owner decisions required before UI build: approve M1/M2/M3/M4 visual direction and reuse of existing art; local400ms/step and2,220ms battle timings; accept or compact the measured HUD coverage increase; approve quieter new-install gains; choose auditioned tracks or retain placeholders; approve on-rails practice and feasibility-first route gate. New art is optional and outside this proposal. No implementation cards created until those decisions arrive.

## Evidence actually executed on this architectural card

- `git status --short --branch` → exit0, clean detached HEAD at start.
- `git rev-parse HEAD` / `git show-ref --verify refs/remotes/origin/main` → exit0, both `6784c4b0e490c4ccc9aad2425105660b625ede48`.
- `node_modules/.bin/tsx m6/fixtures.ts` → exit0; seedm6-study-1, five Moved events to6…10 after66 replay actions; damaging battle after2 replay actions.
- `/home/jaochai/.local/bin/run-locked dice-bandits-e2e node m6/capture-before.mjs` → final exit0; zero walk tweens; phone0.10ms/desktop0.20ms; battle511.70/501.10ms; HUD21.24/11.73%. Earlier failed runs recorded a timeout from expecting nonexistent tweens and unavailable/conflicting static-server port; no failure hidden.
- `/home/jaochai/.local/bin/run-locked dice-bandits-e2e node m6/capture-after.mjs` → final exit0;14 view geometry checks passed;0 page errors/0 broken images; prototype walk2832.90/2832.00ms, battle2222.90/2222.80ms; HUD27.56/14.79%; fighters180/330CSSpx. Initial specimen had a top-variable collision, fixed and rerun.
- Product unit/e2e/full gate, external CI and deployment were NOT run; this is a design artifact, not an implementation approval. Nodev26.9.0 was observed; current CI asks for Node24.
