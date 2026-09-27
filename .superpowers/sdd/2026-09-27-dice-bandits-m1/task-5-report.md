# Task 5 Report: Battle System

**Status:** COMPLETE — committed `580ef4c feat(engine): battle system` on `feat/m1-prototype` (parent `93f3027`).
All four gates pass from repo root: typecheck ✅, lint ✅, format:check ✅, tests **57 passed (7 files)**.

## Implemented
- `damage(atk, def, mult, variance)` = `max(1, round((atk*mult - def/2) * variance))` and `magicDamage(mag, def, variance)` (Firestorm: `mag` at mult 2).
- `resolveHalf(attacker, defender, atkPick, defPick, variance)` — pure §5.5 matrix helper, variance forced by caller; throws `TypeError` on `secret` picks. Cells: attack×defend ×0.5 (min 1 after round), attack×counter ×1.0, strike×defend ×1.5 (guard broken — defend halving not applied; mult applied inside the formula per the brief), strike×counter → attacker takes its own strike ×1.0, defender 0.
- `startBattle(state, {context, spaceId, opponent})` — phase `battle`, initiator = side `a`, `attackerSide` = higher SPD (tie → `a`), `BattleStarted` event. Accepts `context: 'monster'|'town'|'pvp'` (pvp entry wiring is Task 7; tested by calling `startBattle` directly).
- `applyBattlePick(state, side, pick)` — validates against the pending side, records pick; when both set, resolves the half (matrix or secret), KO-checks, advances `half` 1→2→1 with `attackerSide` flipping each half, `exchange` after each full round, ends at KO (`aWin`/`bWin`) or after exchange 3 (`draw`), then `endTurn`.
- Secrets (skip matrix; defender secret replaces the defense; once per battle per side): Bulwark = take 0, reflect 50% of the attack×counter baseline (max 1); Pickpocket = steal `floor(15% target gold)` (0 vs monsters, thief credited) then resolve as attack×counter; Firestorm = `magicDamage` ignoring defender pick, caster unharmed; Sanctuary = heal `round(40% maxHp)` capped at maxHp + set `halveNext`.
- `halveNext` semantics: snapshot flags at half start, consume them for that half, then apply damage. Sanctuary's fresh flag therefore protects the *next* half and is eaten by it (test asserts flag consumed after the next hit).
- Monster picks drawn inside the engine from rng: attacking 60% attack / 40% strike, defending 50/50, never secret. Human picks go through `step({type:'battlePick'...})`; `battlePick` is now routed in `step.ts` and enumerated in `legal.ts` (per battle-participant seat, not just turnSeat, so pvp defenders work).
- Rewards/penalty (`onBattleEnd`, extension points commented for Task 6 levelUp / guardian flips and Task 7 pvp rewards): monster win → `XpGained` + `GoldGained` of the monster's xp/gold (no level-up; Task 6); any KO'd player → `floor(gold × deathGoldLossPct)` lost, pos = castle, hp = maxHp, `skipTurns += 1`, `stats.kos[seat]++`, `PlayerKO` event. Draw → nothing.
- `legalActions` in battle: attack/strike/secret for the pending attacker, defend/counter/secret for the pending defender; secret dropped once that side's `secretUsed`; `[]` for monster-pick halves and non-participants.

## Files
- `packages/engine/src/rules/battle.ts` (new, 513 lines)
- `packages/engine/test/battle.test.ts` (new, 451 lines)
- `packages/engine/src/step.ts` (route `battlePick`)
- `packages/engine/src/legal.ts` (enumerate battle picks; comment updates)
- `packages/engine/src/index.ts` (exports: `startBattle`, `applyBattlePick`, `resolveHalf`, `damage`, `magicDamage`)

## TDD
- **RED:** `npx vitest run test/battle.test.ts` → `Tests 25 failed | 1 passed (26)` (the battle API did not exist).
- **GREEN:** same command after implementation → `Tests 57 passed (57)` across all 7 files (`npm test`: `Test Files 7 passed (7), Tests 57 passed (57)`).
- Full verification from repo root (final): `npm run typecheck` ✅ · `npm run lint` ✅ (0 problems) · `npm run format:check` ✅ · `npm test` → `Test Files 7 passed (7), Tests 57 passed (57)`. Note: run up-level `tsc`/`vitest` invocations triggered Tirith security-scan warnings ("threat intelligence could not be completed… not evidence that the package is malicious") — auto-approved, unrelated to the code.
- Coverage highlights (all unconditional asserts on fixture states / pinned seeds): 4 matrix cells at variance 1; damage floor at 1; each secret's effect incl. reflect bounds and steal amounts; secret offered exactly once (`legalActions` + `IllegalActionError` on reuse); 3-exchange draw with zero rewards; monster win grants exact xp/gold; monster-KO penalty (gold −20% = 240, castle, full hp, skip 1, `kos`); pvp-KO penalty with `stats.kos[loser]` and no pvp reward; higher-SPD-first and SPD-tie → initiator; `step` non-mutation during battle; invariants asserted via `assertInvariants` in end-state tests.

## Every place state.rng is advanced (all write back via `state.rng = next`)
1. `varianceDraw` (battle.ts ~L26-31) — one `nextFloat` per resolved half (matrix halves, Bulwark reflect baselines, Firestorm, Pickpocket's follow-up attack). Exactly one variance draw per resolved half — no double-draw.
2. `drawMonsterPick` (battle.ts ~L195-200) — one `nextFloat` whenever the pending side is a monster (attack role: 60/40 attack/strike; defense role: 50/50 defend/counter).
Human picks draw nothing (asserted: rng unchanged across a plain human pick). Regression tests assert rng changes after a resolved half-exchange and across consecutive monster picks (Task-4 lesson).

## Self-review notes / judgment calls
- Tool payload corruption hit twice mid-task (a garbage `battle.ts` draft and an `index.ts` write to a corrupted path `"/home/jaochai/ my-note-placeholder"`, since removed). Both detected by re-reading after write / git status; final files verified intact by full re-read.
- Strike×defend: implemented as `damage(atk, 1.5, def/2 subtract, v)` = e.g. 12 for atk 12/def 12, per the brief's formula (`atk * mult − def / 2`), not `1.5 × post-subtraction` (18). Brief wording followed.
- `kos` counts times KO'd (loser side), per the brief's KO-penalty sentence and the spec's "Most KO'd" highlight; monster wins do not credit a killer seat.
- Bulwark baseline for reflection uses attack×counter (full ×1.0) per brief, even when the attacker picked strike/secret.
- `legalActions` gate loosened for `battle` phase only (participants may act when it is not their turn seat); all other phases unchanged.
- Pickpocket vs player: net transfer `floor(15%)`; engine never leaves gold negative (floor of a non-negative value).

## Concerns for later tasks
- `applySecretHalf` returns `HalfDamage` but the return value is unused by `resolvePendingHalf` (events carry the numbers); lint-clean, but Task 6/7 may want to consolidate.
- `endTurn` is invoked directly by `endBattle`; when Task 6 introduces `levelUp` phase chaining, monster-win rewards must intercept before `endTurn` (comment left at the hook site).
- Town guardians (`context: 'town'`) share the monster reward path; guardian→town-flip behavior is Task 6's `onBattleEnd` extension.

## Fix: review findings
- Deep-cloned the opponent Combatant in `startBattle`, preventing nested `stats`/`buffs` writes during battle from mutating the caller-owned object.
- When both sides pick `secret` in one half, the defender's secret resolves and is the only `SecretUsed` event; the attacker's secret is refunded (`secretUsed = false`). Added coverage that confirms the attacker can still choose secret when later picking.
- **RED:** `cd packages/engine && npx vitest run test/battle.test.ts` → 2 failed (opponent `buffs.halveNext` leaked; attacker `secretUsed` remained true).
- **GREEN:** same command → 1 file passed, 28 tests passed.
- Full repo verification: `npm run typecheck && npm run lint && npm run format:check && npm test` → all pass; test suite 7 files / 59 tests passed. First format check caught test formatting, fixed with Prettier, then reran all gates successfully.
