# M8 R3-A: frozen tutorial route feasibility

## Decision and scope

GO for the engine-only route feasibility gate, subject to reviewer acceptance of the presentation risks below. This is not a delivered practice screen or a measured 3–5-minute user journey. R3-B/C/D remain separate work.

Base: `wt/m8-r3` at `3e9b0d84a08e21cbfd0590e73027a44b4ecf26cd` (main). The R3 brief was re-read, and the current engine/controller/presentation implementations were traced rather than using the brief's old line anchors. Only the three files allowed by the card are added.

`TUTORIAL_SCRIPT` implements the prescribed `TutorialScript` contract. It contains ordinary `GameConfig`, replay actions with acting seats, and lesson metadata; no `GameState` fixture, checkpoint, engine override, mock, UI, persistence or networking code. The seed has no privileged treatment in the engine. Starting with `createGame(config)`, every transition is a real `step`, preceded by payload-aware `legalActions(state, entry.seat)` validation. This includes `battlePick`, for which `step` itself has an enumeration exemption. Every bot action equals the existing deterministic `chooseAction`.

## Canonical result

- Script ID: `m8-route-v1`; ordinary seed: `m8-route-66918`; configured rounds: 12.
- Seats: human mage (0), cowardly thief bot (1).
- 67 total actions: **31 human decisions + 36 bot actions**. Every human replay action is counted, including branch choices, declining duels, perks and ending turns, not just rolls.
- Human actions: 8 rolls, 2 forks, 5 duel answers, 9 battle picks, 2 perks, 2 end-turn actions, 1 purchase, 1 shop exit, 1 robbery.
- 25 human `Moved` events, all to distinct destinations; 30 bot steps. No walking loop, castle return or repeated human destination. There is one genuine engine teleport on the first turn, not a state edit.
- Final teaching milestone: round 8, human HP 25; all intermediate human HP values are positive. No human `PlayerKO` or `TurnSkipped` event.
- Human buys/equips `crystalWand` for 400 gold at replay index 29; claims previously unowned town 27 at index 38; wins PvP at index 65; takes the `rob` reward for **15 gold** at index 66.
- End-turn taxes in that last step are separately accounted for: human gold delta is +39 (+15 robbery, +24 taxes); bot delta is +5 (-15 robbery, +20 taxes). The robbery stat increases by 15, so taxes are not misreported as theft.
- This replay ends at the lesson milestone, not `gameOver`; a practice session must stop there rather than continue playing rounds 9–12.

Hashes use SHA-256 of `JSON.stringify(state)`, then SHA-256 of the newline-joined initial and all 67 post-step state hashes. They pin the entire intermediate trajectory, not just the final score:

- Initial: `2e99e7f76012cf80418cd57ba8f62f0487a7dcfc52147d07b9cbe462648acccb`.
- Final: `4efe0d322813ce023b0c15c2149bdb040c5b6731f7a3e476ea2b5439245d8caf`.
- Full 68-state chain: `bcb7b0882800e7ac1ee33a43f050871391427b576ad7d028fdb38859066e15ed`.

## Bounded search evidence

The offline search lives only in `apps/client/test/tutor/script.test.ts`. It enumerates seed strings and 12 deterministic human-choice policies, uses the real legal engine for both seats, and never edits state. Human policies vary fork choices and legal battle picks; the refinement also tries stronger offered perks. Bot policy is never substituted.

Every trajectory has a 160-action cap. The stricter search uses at most 35 human decisions and 34 walking steps, rejecting human battles before chest, human shop entry before battle, chest before fork, town claims before shop, human KO, and long walks. It retains all eight subjects. Default runs skip search and validate only the frozen script.

Captured exploratory invocations (elapsed search time is measured with `performance.now`; seed ranges are inclusive):

| Search                                                  | Seeds tried | Human policies tried | Engine states stepped | Search elapsed | Outcome                                                                   |
| ------------------------------------------------------- | ----------: | -------------------: | --------------------: | -------------: | ------------------------------------------------------------------------- |
| Strict order, seeds 0–1999                              |       2,000 |               24,000 |                71,707 |   3,549.281 ms | Seven topics reached; best prefix at seed 472 took 19 human decisions     |
| Strict order, seeds 2000–14098, ≤40 decisions/45 moves  |      12,099 |              145,179 |               458,995 |  21,307.862 ms | Eight topics, but 40 decisions/39 moves; discarded for the shorter result |
| Strict order, seeds 14099–66918, ≤35 decisions/34 moves |      52,820 |              633,832 |             1,990,378 |  92,832.723 ms | Eight topics, 32 decisions/25 moves                                       |
| Refine seed 66918: PvP strike preference                |           1 |                    4 |                   158 |      14.977 ms | Eight topics, 31 decisions/25 moves                                       |
| Refine with offered mag/attack perk preference          |           1 |                    4 |                   158 |      15.419 ms | Same 31-decision route; stronger perks were not offered on this route     |
| Final executable refinement + frozen equality           |           1 |                    4 |                   158 |      15.458 ms | 17/17 tests passed; exact frozen script reproduced                        |

An earlier unrestricted probe was rejected because it introduced human battles before fork/chest. Its exact counters were not captured before its scratch candidate was replaced; its bounds were 2,000 seeds, 24,000 trajectories and 160 steps per trajectory. Its complete Vitest invocation took 7.05 s. Do not treat those bounds as measured counts.

All six exploratory test invocations, including that probe and Vitest startup, total **126.25 s** of captured command duration. This is a conservative upper bound on their search wall time, far below the **1,200 s (20-minute)** total cap. Subsequent invocations append counters/time to `$TMPDIR/m8-route-search.jsonl`, and the test charges both that initial 126.25 s upper bound and the ledger against the cumulative cap. Each invocation is also capped at 180 s. Candidate output goes to `$TMPDIR/m8-route-candidate.json`; neither scratch file is product data or committed.

Reproduce the final refinement from `apps/client`:

`TUTOR_SEARCH=1 TUTOR_REFINE=1 npx vitest run test/tutor/script.test.ts --disableConsoleIntercept`

Use `TUTOR_SEARCH=1` without refinement for the bounded broad seed search. The search is diagnostic, not part of the normal gate and not a global infeasibility proof.

## Lesson proof and what the player sees

Replay indices are zero-based. All eight suggestions are legal for the actual human acting seat, match their replay entries, and have the recorded `beforePhase`. Two pairs share a human action but their milestones are separate real events in engine order. R3-B/C must not request a second roll or branch choice to display those paired topics.

### 1. Roll — index 0, `awaitRoll`

The human chooses Roll and gets a real `DiceRolled(value=2, dice=1, sides=6)` result. The same result drives movement; there is no forced-roll fixture or tutorial RNG.

### 2. Move — index 0, `awaitRoll`

The token actually traverses spaces 1 and 2, after the dice result. Landing on the event at 2 produces a genuine `Teleported(to=7)`. The movement lesson must distinguish the two rolled walking steps from the subsequent event teleport rather than imply that a roll of two means seven steps.

### 3. Fork — index 4, `chooseBranch`

The next human roll stops at the authored fork at 10. The human selects branch 34 from the real legal options; `BranchChosen(to=34)` precedes movement into that tile. No arbitrary training map is introduced.

### 4. Chest — index 4, `chooseBranch`

That chosen step lands on the actual chest at 34 and emits `GoldGained(amount=74)` for seat 0. The chest milestone follows the fork event in the same step. A practice overlay should show the chest result after the fork instruction without synthesizing a chest or awarding extra money.

### 5. Battle — index 21, `battle`

After an ordinary trap and a declined pass-over duel, the human lands on monster space 16. The real first human battle pick is the mage's attack-side secret; `SecretUsed(firestorm, damage=16)` defeats `cactusPunch`, awards 120 gold and XP, and triggers level 2. The human selects the actually offered `taxman` perk and ends the turn. Defence is exercised later during PvP; the first monster fight is not a defence fixture.

### 6. Shop — index 29, `shop`

The human takes fork 20 and lands at shop 22. The legal stock and available gold permit buying `crystalWand` for 400. The engine equips it as the weapon and raises real stats; the next human action exits the shop. The inventory and gold changes, not simply seeing a shop overlay, prove completion.

### 7. Town — index 38, `battle`

The human lands on unowned town 27 and fights its real guardian. The attack-side secret deals 25 damage and emits `TownClaimed(spaceId=27, previousOwner=-1)`. Ownership becomes seat 0. Level 3 and the offered `defUp` perk follow. On later human turns the owned town pays 24 gold in taxes because the human chose `taxman` earlier.

### 8. Steal — index 66, `pvpReward`

After the town, the human accepts a pass-over duel with the bot at 28. The faster thief attacks first; the human uses a defensive secret, strikes, and defends. That first PvP ends in a genuine draw. There is only a two-space catch-up to the bot at 30 for a second duel; the human's defensive secret wins and KO's the bot, not the learner. The human then explicitly selects `rob`; the real `GoldStolen(seat=0, amount=15)` is the final teaching milestone. Nothing steals on the human's behalf automatically.

## Speed-1 runtime estimate (not a measured UI journey)

The card's supplied measured planning timings are human walk approximately 1 s/move, human resolved battle approximately 2.3 s, arrival hold 0.65 s, and bot think pause 100 ms. Counting actual replay consequences gives 25 human moves, 9 resolved human-involved battle half-steps, 6 human arrivals, and 36 bot actions. A battle pick that merely waits for the other PvP participant is not counted as an extra full battle animation.

The test also reads the existing pure movement/battle presentation plans for all real frames and traces the additional fixed waits in `BoardScene`, `BattleScene`, `diceRoll`, and `controller` at the current base. The resulting configured animation/think budget at speed 1 is:

| Component                                                                                   | Milliseconds |
| ------------------------------------------------------------------------------------------- | -----------: |
| Walking: human 25 × (280 + 120), bot 30 × (120 + 40)                                        |       14,800 |
| Arrivals: human 6 × (180 + 650), bot 7 × 250                                                |        6,730 |
| Dice: 15 × 350 board effect + 8 × (900 + 1400) human result overlay                         |       23,650 |
| Battle plans: 9 human resolved steps, 6 bot resolved steps with existing bot cosmetic scale |     23,203.8 |
| Real robbery burst                                                                          |          360 |
| Bot pause: 36 × 100                                                                         |        3,600 |
| **Configured presentation + bot-think subtotal**                                            | **72,343.8** |

This is a calculation over real replay events and existing timing constants, not stopwatch evidence. Phaser frame rounding, scene loading, focus interaction, reading, and future practice overlays are not measured here. Board and battle presentations run concurrently; this route has no movement-plus-resolved-battle overlap that would require adding both waits twice.

Using the card's more conservative walking/battle/arrival timings instead yields **86,983.8 ms** after including the existing dice, bot movement/arrival/battle and robbery costs: `25×1000 + 9×2300 + 6×650 + 36×100 + 4800 + 7×250 + 3223.8 + 23650 + 360`.

For a guided learner, explicitly assume **4 s per human decision plus 5 s of extra reading per topic**: `31×4 + 8×5 = 164 s`. Estimated guided total is therefore **236.34–250.98 s (about 3:56–4:11)**. With no reading, it is only about 1:12–1:27. The 3–5-minute target is plausible, not proven; R3-D must measure a production-speed guided run and annotate reading time rather than hide it. No e2e or real-time waiting was run for this data-only card.

## Risks and downstream contract

1. The first roll lands on an event and teleports. This is legal but adds explanation to the movement lesson. Do not replace it with a fake position/roll; if the owner requires a teleport-free first lesson, route selection needs a further scoped feasibility decision.
2. Roll/move and fork/chest are paired event milestones. Progress must consume each milestone exactly once from the same action, then await the next canonical human action. Bot cursor advancement must not auto-complete an unplayed human lesson.
3. Bot turns naturally show events, battles, town ownership, XP/perks and a bounty before the human is instructed in those mechanisms. Teaching order is pinned for HUMAN milestones, not every visible bot event. The human never claims a town before the shop lesson.
4. The first human fight is an attack-side one-shot, not the R3-C mockup's first-battle defence instruction. Real defence exists at indices 46, 52, 54 and 65. Lead/design must reconcile that later UI copy/mockup with this verified route rather than instruct an illegal first-battle defence.
5. The first PvP is a draw and the thief steals 26 gold via its legal secret; the second PvP wins and supports actual human robbery. Movement remains bounded and unrepeated, but the eventual instruction must explain the draw rather than promise an immediate victory.
6. Timing is estimated; future practice UI may add delays. The hash/legality tests intentionally fail if engine balance, seed generation or bot scoring changes. Re-search and re-review instead of refreshing hashes blindly.
7. This script is data only. It is not wired into title/comic entry, save isolation or a controller; those are R3-B/C/D responsibilities. The existing tip system and all normal gameplay are untouched.

## Verification

RED: `npx vitest run test/tutor/script.test.ts` from `apps/client` failed with exit 1: 1 failed test, because the initial seat-unaware validator accepted seat 1's roll while seat 0 was acting. Payload-aware seat validation fixed that defect before searching.

GREEN: `npx vitest run test/tutor/script.test.ts --disableConsoleIntercept` passed with exit 0: 16 passed, 1 opt-in search skipped. Final refinement command passed with exit 0: 17 passed. Tests cover illegal/desynchronised entries and lesson metadata, legal-but-noncanonical bot choices, every replay step, all eight event-driven human lessons, immutability, the 68-state hash chain, purchase/town/robbery effects, no KO/skipped turn/repeated walking destination, counts and timing calculations.

The first root `npm run typecheck` exited 2 because pre-existing `node_modules` lacked `@cloudflare/vitest-plugin/types` in the worker-test workspace. `npm ci` restored dependencies (exit 0; no lockfile change). It reported 7 high-severity dependency advisories; dependency remediation is outside this three-file card and no audit fix was applied.

Final local gate (all commands exited **0**):

| Command                                                                                   | Real output                                                                                                                       |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                       | All workspace TypeScript commands completed; no diagnostics                                                                       |
| `npm run lint`                                                                            | `eslint .`, no diagnostics                                                                                                        |
| `npm run format:check`                                                                    | `All matched files use Prettier code style!`                                                                                      |
| `npx vitest run test/tutor/script.test.ts --disableConsoleIntercept` (from `apps/client`) | 1 file passed; 16 passed, 1 opt-in search skipped                                                                                 |
| `npm test` (root)                                                                         | Engine 129 passed; room 46 passed; client 663 passed + 1 search skipped; cartoonize 13 passed; SFX 6 passed; **857 passed total** |

Root tests also passed the real asset budgets: audio `3,725,395 / 4,000,000` bytes; art `4,364,940 / 6,000,000` bytes. The root `test` script does not run worker integration tests; the normal PR CI does, and exact-head CI will be checked before review.

This card does not require local e2e, a build, screenshots, axe or visual comparison because it adds no page/screen/component. No local e2e suite was run.
