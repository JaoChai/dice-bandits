# Dice Bandits M1 final fix report

## Changes

- Hardened saved-state validation for the fields used during Continue/render; invalid parseable saves are discarded with the existing toast.
- Made save reads, writes, and removals non-fatal when browser storage throws. Language initialization falls back to the browser preference and language changes remain in memory if persistence fails.
- Added short-viewport setup CSS. At 640×360, English and Thai both show all four seats and keep Start reachable without page scrolling.
- Localized hot-town results labels using the board space's translated region and added a translated no-town label. English and Thai dictionaries retain identical keys.
- Added regression tests for malformed saves, storage failures, language persistence failures, and localized hot-town/no-town results.

## Verification

- TDD regression checks: observed assertion failures for malformed state, storage read failure, results labels, and language read failure before the corresponding fixes; targeted suite then passed (3 files, 9 tests).
- Gate: all commands passed — typecheck; lint; format check; tests (25 files, 147 passed); 200-game/four-player simulation (0 crashes, 0 stuck); build; e2e (7 passed, 1 skipped).
- Browser setup check: 640×360 EN — document height 360, submit bottom 322.625px, 4 seats; TH — document height 360, submit bottom 315.625px, 4 seats. At 1280×720 and 844×390, document height matched viewport (no page scroll).
- Malformed saved state: title loaded with no console/page errors, Continue hidden, and discard toast shown.
- Screenshots: `~/.hermes/profiles/hermes-dev/cache/scratch/final-fix-setup-en-640.png` and `.../final-fix-setup-th-640.png`.

## Remaining notes

- Build/e2e emitted the existing Vite warning that the minified JS chunk exceeds 500 kB; it is out of scope for this fix wave.
- No push or deploy performed.

## Fix round 2

- Added hand-written, per-kind phase payload validation before accepting saved game state, including nested battle combatants/pending picks and game-over highlights.
- Added malformed-phase discard/toast cases and an 8-seed, four-bot validity sweep that saves and reloads every real intermediate engine state through game over. TDD red: the malformed-phase test failed against kind-only validation; green: targeted save suite passed (6 tests).
- Validity sweep covered: `awaitRoll`, `battle`, `chooseBranch`, `duelOffer`, `endOfTurn`, `gameOver`, `levelUp`, `pvpReward`, `shop`, `townChallenge`.
- Gate passed: typecheck; lint; format check; tests (25 files, 149 passed); 200-game/four-player simulation (0 crashes, 0 stuck); build; e2e (7 passed, 1 skipped). Ports 4173 and 4174 were free before e2e.
- Build/e2e retained the existing Vite warning about the minified JS chunk exceeding 500 kB. No push or deploy performed.

## Fix round 3

- Completed validation only for nested battle fields: all five combatant stats must be numbers; `ironSkin`, `poison`, and `halveNext` must be booleans; optional `rage` may be absent or boolean; pending attack/defense picks must match their engine literal unions or be null.
- TDD: malformed battle regression cases failed before the validator fix (save load incorrectly returned the malformed state), then passed. Added explicit round trips for a real engine battle with `rage: true` and with `rage` absent. The real-engine validity sweep remains green.
- Gate passed: typecheck; lint; format check; tests (25 files, 150 passed); 200-game/four-player simulation (0 crashes, 0 stuck); build; e2e (7 passed, 1 skipped). Ports 4173 and 4174 were free before e2e.
- Build/e2e retained the existing Vite warning about the minified JS chunk exceeding 500 kB. No push or deploy performed.
