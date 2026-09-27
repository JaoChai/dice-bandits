# Task 7 implementation report

## Changes

- Added PvP reward resolution and action enumeration for Rob, concrete item Loot, owned-town Seize, and preset-name Prank. Duel acceptance now starts a PvP battle; a draw ends the initiator's turn without a reward; KO applies the normal penalty, and a bounty is paid when its marked player is KO'd in PvP.
- Added net-worth/leader calculation, the round-start underdog-card grant and effects, bounty/prank expiry, and Final Frenzy entry/reward multipliers. Round-one underdog state is initialized in `createGame`; later rounds run `startOfRound` during turn advancement.
- Added `looter` (40% Rob) and `grudgeHolder` (+15% attack against the current leader), with tunable percentages in `balance.json`.
- Replaced seat-order game-over ranking with net worth → towns → level → seat-order ranking; `finishGame` also emits the three requested highlights.
- Extended seeded liveness coverage to prefer duel acceptance and Bandit Cards. Added focused tests for PvP rewards, legal/illegal actions, battle draw/KO, bounty, underdog cards and RNG advancement, rankings/highlights, and Final Frenzy.

## RED / GREEN evidence

- **RED:** `npm run test -w @dice-bandits/engine -- test/pvp.test.ts test/underdog.test.ts test/endgame.test.ts` initially failed all three suites because the new `pvp`, `underdog`, and `endgame` rule modules did not yet exist.
- **GREEN:** After implementation, the final root checks passed: `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm test` (**14 test files, 102 tests passed**). `git diff --check` also passed. The commit was verified at `ac5d75d` (`feat(engine): pvp, underdog, world rules and endgame`); the worktree was clean after the commit.

## World-rule map

- `slipperyRoads` → `packages/engine/src/rules/movement.ts:102`
- `taxHoliday` → `packages/engine/src/rules/towns.ts:6`
- `goldRush` → `packages/engine/src/rules/spaces.ts:185`
- `monsterSurge` → `packages/engine/src/rules/spaces.ts:98,141` (space monsters and town guardians)
- `blackMarket` → `packages/engine/src/rules/spaces.ts:38`
- `cursedCapital` → `packages/engine/src/rules/spaces.ts:72`

## Judgment calls

- Prank aliases are explicit, concrete legal choices because the winner picks from the preset list. Applying that selected alias does **not** draw RNG; a regression test confirms the RNG state remains unchanged. This follows the action-enumeration and spec semantics over interpreting “prank alias draw” as random selection.
- Duel offers are made for occupied pass-over spaces as specified in §5.3; a final landing on an occupied space does not independently offer a duel.
- Initial round underdog processing mutates setup state but its event is not returned, because `createGame` has no event-channel return type. Subsequent round-start events are returned normally.

## Concerns

- The round-one `BanditCardGranted` event is not observable to callers during setup (the card and RNG state are still applied). Exposing setup events would require an API change outside this task's existing `createGame` return shape.
- No other known blockers; all required checks passed.

## Fix: review findings

- Preserved `ranking` as the full ordered list with seat order only as the final display tiebreak, and added `winners: number[]` containing all seats tied at the top by net worth → town count → level. `GameEnded` retains `winner` and now includes comma-separated `winners` in event params.
- Changed the `hotTown` highlight to `{ key: 'hotTown', spaceId, flips }`, choosing the highest flip count then lower space ID; no flips yields `{ spaceId: null, flips: 0 }`.
- **RED:** `npm test -w @dice-bandits/engine -- test/endgame.test.ts` failed 6 tests, exposing the missing shared-winner state/event and wrong hot-town identity.
- **GREEN:** Focused endgame suite passed (8 tests). Root `npm run typecheck && npm run lint && npm run format:check && npm test` passed; full suite: 14 test files, 107 tests passed. `git diff --check` passed.
- Added regressions for shared/sole winners, town and level tie-breaks, hot-town identity/tie-breaking, and the no-flips case.
