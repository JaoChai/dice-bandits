# M7-A0: measured bot-wait options and implementation plan

> For a downstream implementer after owner approval: use the team's Kanban implementation/review lane; execute the brief task-by-task with the writing-plans/TDD workflow. This read-only card does not authorize implementation.

**Goal:** Identify the actual local/online wait costs and choose a readable, low-risk local bot-pacing change.

**Architecture:** Change only the local controller's per-action thinking timer. Keep its serialized engine step, per-action save and awaited presentation; leave authoritative online batching and detached cosmetic playback unchanged.

**Tech stack:** TypeScript, Phaser, Vite, Vitest and Playwright; Cloudflare Worker/Durable Object room runtime. Existing pinned dependencies only.

**Spec:** Kanban card `t_690ddfc3`, “M7-A0 · Measure where the bot-turn wait goes, then propose options (Architect, read-only).”

Status: measurement and implementation brief only; no feature approved or implemented.
Base: `wt/m7-botwait`, `468e9951d06180f26856133dcbec45fbd86b5682`.

## Recommendation

Use a fixed **100 ms local bot-action pause**, instead of the current random 400–900 ms pause. Keep every existing movement, arrival, battle, HUD update, autosave and human-choice boundary. Do not change online scheduling.

The measured pause is the largest local component, but not the entire wait: it accounts for **55.32% desktop / 56.15% phone** of the sampled automated time. Battle presentation remains significant. Shop/perk/reward dialogs do not introduce an additional awaited modal timer.

For the five uninterrupted three-bot sweeps in each capture, the measured median is **17.02 s desktop / 16.31 s phone**. Replacing only the pause predicts **7.97 s / 7.89 s**, saving a paired median **9.05 s / 8.43 s** while keeping all visual playback. These are arithmetic projections from baseline recordings, **not measured results of an implementation**.

## Measurement method and limits

- Built the unchanged production application with `VITE_TEST_HOOKS=1` to expose the existing state/art probes; used `vite preview` on a separate port, 4273. No dev/HMR client was measured.
- Local: one knight human, three bots; seed `e2e-1`; production setup's 12-round state. Speed 1, reduced motion off; 1280×720 desktop and 915×412 phone emulation in Chromium. Existing intro/tips preferences were disabled by the probe, not by product edits.
- Ten **continuous automated windows** per viewport, 94 bot actions each. A window starts when `runBotsIfNeeded()` begins, after the human action's presentation, and ends at the first post-run animation frame with an enabled action passing a center-point hit test. Subsequent input also waited for the controller's dispatch guard to release.
- Windows 1–5 are uninterrupted seat-1-through-seat-3 sweeps ending at the human's next roll. Windows 6–10 split the following sweep at real human PvP choices. They must not be described as ten full three-bot sweeps. Human decision time and presentation triggered by those human choices are excluded.
- This explains why the all-window median below is about 9 s rather than the earlier Lead's approximately 17 s gap: interrupted PvP windows are short. The separately reported full-sweep sample has only five observations per viewport.
- Timestamped the real built bundle with a Playwright response wrapper and native timers/tween callbacks. No production source, existing tests, engine/room code or project config was edited. An isolated scratch copy of the built Worker logged `runBotChain` time without modifying its result or protocol.
- Walk includes actual token tween completion and per-space hold. Arrival includes the arrival-card hold and awaited coin/frenzy effect waits. Other awaited UI is chiefly the board's dice-effect pause. Human-only dice telemetry is not charged to bot windows.
- Board and battle are awaited in parallel. For an additive critical-path partition, overlapping time is charged to battle before walk, arrival and other UI; think time is separate. Remaining CPU/autosave/DOM/microtask time is shown explicitly. Independent component medians do not sum to the median total.
- The clickable gap is a **conservative first-frame observation**, not an exact measurement of the earliest instant a button could accept input. It is not evidence of a new product timer.
- Median and p90 use linear interpolation on sorted samples. This is a single seeded trajectory, not a balance, hardware or production-network benchmark. Phone is viewport/touch emulation, not a physical phone.

Raw measurements and executable probe sources are provided with the timing evidence archive. The scratch source directory is `/home/jaochai/.hermes/profiles/dev-architect/cache/scratch/m7-botwait`.

## Local time partition

All durations are milliseconds, with ten windows in each viewport.

| Component                                   | Desktop median |   Desktop p90 | Phone median |     Phone p90 |
| ------------------------------------------- | -------------: | ------------: | -----------: | ------------: |
| Bot think pauses, elapsed                   |       5,066.60 |     12,422.71 |     4,914.90 |     12,874.11 |
| Token walk and step holds                   |       1,007.40 |      1,717.04 |       998.55 |      1,705.07 |
| Arrival card / awaited toast effects        |         555.25 |        801.03 |       559.05 |        798.19 |
| Battle playback, critical-path share        |       2,519.75 |      5,047.90 |     2,510.40 |      5,048.72 |
| Other awaited UI, mainly board dice effect  |         702.70 |      1,051.15 |       700.10 |      1,050.95 |
| CPU / autosave / render / dispatch residual |          24.60 |         68.82 |        24.10 |         70.68 |
| Bot-loop end to observed clickable frame    |          10.50 |         15.49 |         7.30 |         16.43 |
| **Total continuous automated window**       |   **9,024.40** | **21,588.48** | **8,842.85** | **22,050.62** |

Maximum total: 26,209.80 ms desktop; 27,175.40 ms phone.

Bot action counts:

- Per automated window: median 8, p90 19.7, range 1–26, 94 actions total in each viewport.
- Grouped by `(round, active turnSeat)`: 17 observed bot turns per viewport, median 6 actions, p90 9, range 1–13. Human-turn bot responses are not classified as a bot-owned turn. These are observed actions, not turn-duration samples; interrupted turns are combined by identity.
- Phase coverage in each capture: `awaitRoll` 23, `battle` 48, `levelUp` 6, `endOfTurn` 6, `duelOffer` 2, `pvpReward` 1, `townChallenge` 1, `chooseBranch` 3, `shop` 4.
- The five uninterrupted sweep medians are 17,016.30 ms desktop and 16,312.90 ms phone. Do not use the all-window table to claim a full three-bot sweep already takes only 9 s.

## Online: computation, actionable commit and detached presentation

Used **two independently launched Chromium browsers in one real local room**, with two humans and two bots, for each viewport. Two human seats are required for two independently actionable clients: unseated visitors receive seats, not a game `view` (`packages/room/src/play.ts:46`). This is not presented as a measured one-human/three-bot online topology.

Both browsers used speed 1 and reduced motion off. Final captures reached round 11: desktop 88 views per browser, 87 human actions, authoritative turn 205; phone 98 views per browser, 97 human actions, turn 189. There were 19 positive bot batches desktop and 26 phone. Only those positive batches contribute to the batch comparison.

| Component, ms                                               | Desktop median / p90 | Phone median / p90 |
| ----------------------------------------------------------- | -------------------: | -----------------: |
| Live Worker `runBotChain`, excluding storage/network        |          1.00 / 2.20 |        1.00 / 1.00 |
| Same inputs replayed in Node, first measured execution      |          0.40 / 1.36 |        0.29 / 0.84 |
| Human action send to received batch view, local round trip  |        12.90 / 19.62 |      12.75 / 15.50 |
| Received view to queued callback start                      |          0.10 / 0.10 |        0.00 / 0.10 |
| Awaited client view/presentation callback                   |          2.60 / 3.73 |        2.30 / 3.70 |
| Received batch view to human's observed clickable frame     |        12.50 / 14.82 |       9.75 / 14.75 |
| Commit end to observed clickable frame                      |        10.10 / 11.24 |       6.55 / 10.40 |
| Visible detached movement lifetime, including cancellation  |       88.15 / 116.24 |     86.75 / 104.11 |
| Nontrivial detached battle lifetime, including cancellation |        84.15 / 97.90 |     94.20 / 114.10 |

- Live Worker readings are integer milliseconds, including zeros; a zero is not proof of zero computational cost. Maximum positive-batch runtime was 4 ms desktop and 2 ms phone. Node replay corroborates the order of magnitude but is not a substitute for a deployed Durable Object CPU benchmark.
- Reconstructed the real recorded human action sequence using the server-side seed (the client correctly redacts it). Replay matched every input turn and the final authoritative turns/rounds. Each positive batch was additionally replayed 20 times with identical resulting game state.
- Online has **no local random think timer**. Awaited walk, arrival-card and battle-animation hold time on its actionability path is **0 ms by the detached control flow**, not the visible lifetime of those effects. The remaining awaited callback above is authoritative commit/setup work. Phase modals do not add an awaited bot-choice hold.
- Actual input was sent while cosmetic presentation was still alive: 33 desktop sends and 40 phone sends. This directly demonstrates that animation lifetime is not a prerequisite for acting.
- Autoplay supersedes presentation rapidly, so the cosmetic lifetimes are cancellation-heavy observations, not natural full-playback durations. The movement source has a 600 ms wall-clock expiry; that is a code bound, not the measured lifetime in this capture.
- Callback samples include both browsers: 38 desktop / 52 phone. Clickable observations include the active human only: 19 / 26. Detached lifetime samples include ordinary human views too, not only positive bot batches.
- Local round-trip figures do not estimate Internet latency. Storage, delivery and commit are outside the pure `runBotChain` runtime. Do not subtract separately sampled medians to invent their individual costs.

Conclusion: local bot pauses are an actionable bottleneck. Online already avoids waiting for the same animation chain; adding local-style waits there would be a regression.

## Options for owner selection

All savings below are **baseline-derived projections**, not executed performance improvements. They use each recorded window's actual requested pauses and event counts before taking percentiles. No game actions are removed in A, B or C.

| Option                                                   | Predicted saving per automated window: desktop / phone                                                                              | Risk and files                                                                                                                                                                                                                                                    | Human still sees                                                                                                                                           | Online impact                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **A. Fixed 100 ms think pause — recommended**            | Median **4.27 / 4.11 s**; p90 **10.45 / 10.88 s**. Full-sweep sample paired median **9.05 / 8.43 s**.                               | Low: only `apps/client/src/controller.ts` and `apps/client/test/controller.test.ts`. Validate serialized ownership and autosaves.                                                                                                                                 | Every actual space/hop, arrival outcome, pick/reveal, battle beat, shop/perk/reward state and next human choice; only the blank thinking interval shrinks. | None: keep room batching, online controller and detached presentation unchanged.          |
| B. Zero think pause                                      | Median **5.07 / 4.91 s**; p90 **12.42 / 12.85 s**. Full-sweep sample paired median **10.75 / 10.13 s**.                             | Low–medium: same files as A. Consecutive nonvisual state changes may be too quick to follow; test that repeated zero-delay microtasks do not create new re-entry problems.                                                                                        | All existing awaited animations remain, but no pause separates actions without visual beats.                                                               | None, unless mistakenly applied to room code; no online timer currently exists to remove. |
| C. Bot walk 120→80 ms, hold 40→20 ms, arrival 250→100 ms | **Nominal** median **0.56 / 0.56 s** total: 0.33 s walking and 0.225 s arrival. Full-sweep sample nominal median **0.99 / 0.99 s**. | Medium: `apps/client/src/scenes/board/movementPlan.ts`, `apps/client/src/scenes/BoardScene.ts`, `apps/client/test/art/movementOverlay.test.ts`, movement e2e. Frame/tween effects require a new real capture; nominal savings are not measured wall-time savings. | Every visited space and outcome, with less time to read each step/arrival. Human walk remains 280+120 ms and human arrival remains 180+650 ms.             | Must remain bot-only. Keep `online` hop scaling and detached 600 ms deadline unchanged.   |

Projection formulas:

- A: `sum(recorded requested think milliseconds) - 100 * botActionCount`.
- B: `sum(recorded requested think milliseconds)`.
- C: `60 * actual Moved-event count + 150 * actual completed landing count`. The estimates use the counted trajectory and chosen proposed timings; they do not model browser frame quantization or visual readability.
- A's all-window paired projected total median: **4.87 s desktop / 4.86 s phone**. Full-sweep sample projected median: **7.97 / 7.89 s**.

Do not batch away intermediate `onEvents` callbacks or run authoritative bot turns in parallel in this first change. That would sacrifice the owner's ability to follow events and require new snapshot/ordering/lifecycle design. A fast-forward button similarly needs a separate owner-approved interaction brief; no new control or page is proposed here.

## Card-ready implementation brief for A

Approval required before implementation. This task does not authorize product edits or a PR.

### Goal and owned files

Reduce only local blank bot thinking time; preserve step-by-step readability and game semantics.

- Change `apps/client/src/controller.ts:92–125,143–150`.
- Extend `apps/client/test/controller.test.ts`.
- An implementer may add a narrow bot-pacing e2e spec under `apps/client/e2e/` if necessary. Do not commit this card's scratch measurement probes as application tests without adapting them deliberately.
- No changes to `main.ts`, engine, room, Worker, protocol, save schema, UI/CSS, or dependencies.

### Exact behavior/interface

- Define a private module constant `BOT_ACTION_DELAY_MS = 100` in `controller.ts`.
- Replace `await delay(randomDelay() * this.speed)` with `await delay(BOT_ACTION_DELAY_MS * this.speed)`; remove the now-unused `randomDelay()` function.
- Preserve the existing constructor interface `{ state: GameState; speed: number; onEvents: (events: GameEvent[], state: GameState) => Promise<void> }`.
- Preserve `dispatch(action: Action): Promise<void>`, `pendingHumanSides()` and all existing bot-run/dispatch guards. Do not introduce a pacing setting, button or exported API.
- Keep the post-delay legal-actor recheck, one `chooseAction`/`step` per bot action, per-action JSON state/autosave, and `await onEvents` before the next bot action.
- At speed 1 the pause is exactly 100 ms requested per bot action; speed 0.5 requests 50 ms; speed 2 requests 200 ms; speed 0 still follows the existing resolved-promise path. Preserve negative-speed clamping.
- `GameController.dispatch` must not accept a second human mutation while its existing presentation/bot chain is pending. Keep the existing `botRun` single-chain owner.

### Failing tests to write first

1. Fake timers, the existing one-human/three-bot configuration, and a legal human `endOfTurn` fixture (`createGame(config)`, then set only `phase = { kind: 'endOfTurn' }`). Dispatch `endTurn`; after the human callback settles, assert that the first bot callback has not run at 99 ms and has run at 100 ms. This fails against the current minimum 400 ms pause.
2. Table-test speed 0.5 and 2 with corresponding 49/50 ms and 199/200 ms boundaries. Preserve the existing speed-0 controller test. Do not assert elapsed browser time in this unit test; assert requested-timer behavior.
3. Hold the first bot's `onEvents` promise unresolved, advance fake time beyond a further 100 ms and assert no subsequent bot callback occurs. Release it; assert the next action waits another full 100 ms. State commits and saves remain one per action.
4. Dispatch a second human action while a bot presentation is pending and assert it does not mutate state. Retain the existing human-animation re-entry regression test.
5. Retain/extend the full seeded controller journey: same legal actions, identical resulting saved state, no `console.error`, and a human opportunity/game-over boundary rather than a stuck bot chain. Animation duration tests remain unchanged.

Existing relevant tests were inspected and run; controller/movement/battle baseline currently passes 57 tests. No new failing tests were written by this read-only architecture task.

Use explicit test names: `waits exactly 100ms before a bot action at speed 1`, `scales the fixed bot pause at speed 0.5 and 2`, `awaits bot presentation before scheduling the next fixed pause`, and `ignores human dispatch while a bot presentation is pending`. Retain the existing full-game/autosave and illegal-action tests.

### Task 1 execution checklist

- [ ] Write the named timer/ownership tests in `apps/client/test/controller.test.ts`.
- [ ] From `apps/client`, run `../../node_modules/.bin/vitest run test/controller.test.ts`; expect the new 100 ms timer boundary assertions to fail against the current 400–900 ms pause.
- [ ] Make only the constant/call-site/removal change defined in Exact behavior/interface above.
- [ ] Re-run the same targeted command; require all controller tests, including the existing seeded autosave journey, to pass.
- [ ] Re-capture the two normal-speed viewports and publish actual per-part median/p90; run the complete gate below, with full local e2e once at the end.
- [ ] Hand off through the assigned implementation card's review graph. Commit/push only if that later card explicitly authorizes them; this measurement card does not.

Review focus: repeated input during an unresolved bot presentation; a bot participating in a human-owned PvP battle; speed 0/negative-speed clamp; the same actor changing after the wait/recheck boundary; and game-over/no-legal-action termination. The first three are covered by the ownership/speed tests and unchanged battle tests; retain the legal-actor recheck and full-game termination tests for the last two. Do not weaken these guards to achieve a timer reduction.

### Presentation contract

No new page, control, loading/empty/error state, or style direction. Retain the shipped M5a design, not a new design system:

- `apps/client/src/ui/theme.css`: cream `#f5eedc`, panel `#fffdf5`, cocoa ink/outline `#5c3317`, blue `#2e7fe0`, gold `#f5c51c`; panel radius 14 px.
- `apps/client/src/ui/styles.css`: existing Mitr typography (400/600), existing component spacing and radii; do not override them. Existing menu gap/padding remain 10/12 px (`theme.css`).
- Preserve board with bot/human turn ribbon, movement counter/arrival, battle pending-pick/reveal/result, human phase dialogs, and exit/cancellation states. Online reconnect/error/empty event-batch behavior is unchanged.
- Verify at 1280×720 and 915×412, including reduced motion and speed 0; no additional actionability gate or decorative overlay.

### Verification/gate commands

Run each line as its own plain command. The full gate mirrors the repo's `.github/workflows/ci.yml`; it was **not run in full** for this documentation-only card.

From the repository root:

```text
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:worker
npm run build
npm run sim -- --games 200 --players 4
npm run sim:room -- --games 200
VITE_TEST_HOOKS=1 npm run build -w @dice-bandits/client
```

Targeted iteration from `apps/client`:

```text
../../node_modules/.bin/vitest run test/controller.test.ts
/home/jaochai/.local/bin/run-locked dice-bandits-e2e ../../node_modules/.bin/playwright test movement-readability.spec.ts battle-feel.spec.ts online-turn-handoff.spec.ts --workers=1
```

Full local e2e, at most once at the end, from `apps/client`:

```text
/home/jaochai/.local/bin/run-locked dice-bandits-e2e ../../node_modules/.bin/playwright test --workers=1
```

### Acceptance criteria

- Requested bot pause matches the exact fixed-delay/speed contract and new unit tests fail before/pass after the change.
- All existing action, save, engine RNG, battle privacy and dispatch-serialization behavior is preserved; no skipped `onEvents`/autosave and no new callback overlap.
- Humans still see the existing sequential visual history; human timings and human PvP battle beats are unchanged.
- Repeat the normal-speed baseline capture on both widths; publish per-part median/p90 and actual savings rather than promoting this document's projections to measured outcomes. Separate full sweeps from interrupted PvP windows again.
- Online actionability remains independent of detached presentation; do not add local pacing to room execution.
- Full local gate passes with real command exit codes/counts. No default-branch push, merge or deployment is part of this brief.

### Out of scope

New skip/fast-forward UI, parallel bot state mutations, dropped/coalesced local event playback, engine/balance changes, human-animation shortening, online protocol/batch changes, new replay/snapshot format, dependency/audit fixes, PR publication, merge and deployment.

## Execution evidence for this architecture task

Repository path: `/home/jaochai/Code/dice-bandits/.worktrees/m7-botwait`.
Probe path: `/home/jaochai/.hermes/profiles/dev-architect/cache/scratch/m7-botwait`.

- `git status --short --branch`: clean before documentation; branch `wt/m7-botwait...origin/main`.
- `git rev-parse HEAD`: `468e9951d06180f26856133dcbec45fbd86b5682`.
- `npm ci`: exit 0; 210 packages added, 217 audited; reported 7 high-severity advisories. No dependency files changed and no audit fix attempted.
- From `apps/client`, `env VITE_TEST_HOOKS=1 ../../node_modules/.bin/vite build`: exit 0; 97 client modules transformed, built in 383 ms; emitted `index-CzkCY8di.js`. Existing large-chunk warning was present.
- Preview command: `npm run preview -- --port 4273 --strictPort`; separate `curl --fail --silent --show-error http://localhost:4273/` returned the built HTML, exit 0.
- Root command, desktop: `/home/jaochai/.local/bin/run-locked dice-bandits-e2e node_modules/.bin/playwright test --config /home/jaochai/.hermes/profiles/dev-architect/cache/scratch/m7-botwait/probe.config.ts --project desktop --grep 'local bot' --workers=1`: exit 0, **1 passed (2.7m)**, ten windows/ten clickable.
- Same command with `--project phone`: exit 0, **1 passed (2.7m)**, ten windows/ten clickable.
- Final isolated Worker command: `node_modules/.bin/wrangler dev --config /home/jaochai/.hermes/profiles/dev-architect/cache/scratch/m7-botwait/worker/worker.config.json --port 8877 --ip 127.0.0.1 --persist-to /home/jaochai/.hermes/profiles/dev-architect/cache/scratch/m7-botwait-serverstate-final > /home/jaochai/.hermes/profiles/dev-architect/cache/scratch/m7-botwait/worker.log 2>&1`.
- `curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8877/api/health`: exit 0, `{"ok":true,"db":{"ok":1}}`.
- Root online command: `/home/jaochai/.local/bin/run-locked dice-bandits-e2e node_modules/.bin/playwright test --config /home/jaochai/.hermes/profiles/dev-architect/cache/scratch/m7-botwait/probe.config.ts --grep 'online server' --workers=1`: final capture exit 0, **2 passed (24.5s)**; final authoritative turns 205/189.
- `node_modules/.bin/tsx /home/jaochai/.hermes/profiles/dev-architect/cache/scratch/m7-botwait/server-replay.ts`: exit 0; replay verified desktop 87 human actions/19 bot batches/final turn 205, phone 97 human actions/26 bot batches/final turn 189, both round 11.
- `python /home/jaochai/.hermes/profiles/dev-architect/cache/scratch/m7-botwait/analyse.py` and `python /home/jaochai/.hermes/profiles/dev-architect/cache/scratch/m7-botwait/analyse-online.py`: each exit 0, generated the tables from saved observations.
- From `apps/client`, `../../node_modules/.bin/vitest run test/controller.test.ts test/art/movementOverlay.test.ts test/art/battlePresentation.test.ts`: exit 0, **3 files / 57 tests passed**, 1.49 s.
- `git diff --exit-code`: exit 0 after probes, before adding this document. Source/tests/config/dependency manifests remained unchanged.

Excluded setup failures are not performance evidence: the initial local probe timed out behind the intro comic (1 failed); the first online launch used a wrong lobby selector (2 failed); a first replay attempt incorrectly used the client's redacted empty seed and failed. Probe-only fixes resolved those. A diagnostic state directory inside the Worker watch tree caused a reload loop and one 30-second health timeout (exit 124); moving persistence outside that tree resolved it. Two earlier successful online captures were replaced, not pooled, after refining the probe-only movement-cancellation marker.

Only this document is a repository change. No commit, push, PR, merge or deploy was performed. Only probe-owned servers were stopped; the pre-existing port-4173 service was not touched.
