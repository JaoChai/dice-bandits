# Task 8 report — rule-based bots and balance simulator

**Date:** 2026-09-27
**Status:** DONE

## Changes

- Added personality-weighted, rule-based bot action scoring with deterministic ±10% noise seeded independently of game RNG; bot choices do not mutate or consume `state.rng`.
- Added a simulator/CLI that asks all seats with legal actions (including non-turn-seat battle actors), runs seeded games to completion, and reports win rates, comeback rate, liveness, and engagement.
- Fixed root `sim` argument forwarding and added the 200-game simulator to CI after tests.
- Tuned only `data/classes.json` during the balance pass: Mage base MAG 15→11 and MAG growth 3→2.
- Added bot legality/personality and 50-game simulator tests; recorded both 1,000-game balance iterations in `docs/balance-log.md`.

## RED/GREEN

- RED: bot and simulator test files failed to load because `src/bots` and `src/sim` did not exist.
- GREEN: focused tests passed after implementation. The bot test samples 200 live state-seat pairs across pinned seeds, verifies returned actions are legal, and checks game RNG is unchanged. The simulator test completes 50 pinned games with zero crashes/stuck games.

## Final simulation

Command: `npm run sim -- --games 1000 --players 4`

```json
{
  "games": 1000,
  "crashes": 0,
  "stuck": 0,
  "avgRounds": 12,
  "classWinRate": {
    "knight": 0.245,
    "thief": 0.2525,
    "mage": 0.3265,
    "cleric": 0.176
  },
  "comebackRate": 0.134,
  "seatWinRate": [0.26, 0.2775, 0.2195, 0.243],
  "engagement": {
    "townsClaimed": 1316,
    "townFlips": 270,
    "townAttacks": 493,
    "monsterBattles": 8513,
    "investments": 95,
    "equipmentBought": 2922,
    "levelUps": 1869,
    "duelsAccepted": 5076,
    "banditCardsUsed": 11728,
    "averageFinalLevel": 1.46725
  }
}
```

## Balance iterations and judgment calls

1. Baseline failed class balance: Knight .1245, Thief .1275, Mage .678, Cleric .07; comeback .097; zero crashes/stuck. Logged full report in `docs/balance-log.md`.
2. Reduced Mage MAG data only. All class rates moved into [0.15, 0.35], comeback remained above .08, and liveness stayed clean. Full report logged in `docs/balance-log.md`; stopped after this passing iteration.

The root `sim` script originally failed to forward flags to the engine workspace; corrected argument forwarding and verified the requested command executes with those options. The round-6 comeback snapshot removes round-7 taxes emitted in the transition step so the ranking reflects end-of-round-6 net worth.

## Concerns

- Final Mage rate (.3265) is near the upper bound (.35); within the specified target, but worth monitoring if bot policies or game data change.
- Investment is active but comparatively infrequent (95 per 1,000 four-player games); no threshold was specified for it.

## Fix: review findings

- Replaced the weak “some personalities differ” assertion with seeded fixture tests: greedy selects rob over a low-value seize while vengeful chooses seize; vengeful duels its top-grudge target while greedy targets the other seat; cowardly declines a dangerous duel while greedy accepts; greedy avoids a monster while rich/current leader and chooses danger while poor and behind.
- RED: focused `npm test -- test/bots.test.ts` failed on the poor greedy danger fixture with the unconditional monster penalty. GREEN: focused tests passed after the scoring fix.
- Greedy monster aversion now applies only when greedy is the current leader or has at least `2 * BALANCE.startGold` gold.
- Verification: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, and the requested 1,000-game simulation all passed.

Command: `npm run sim -- --games 1000 --players 4`

```json
{
  "games": 1000,
  "crashes": 0,
  "stuck": 0,
  "avgRounds": 12,
  "classWinRate": {
    "knight": 0.242,
    "thief": 0.2525,
    "mage": 0.3275,
    "cleric": 0.178
  },
  "comebackRate": 0.135,
  "seatWinRate": [0.261, 0.2845, 0.2185, 0.236],
  "engagement": {
    "townsClaimed": 1314,
    "townFlips": 270,
    "townAttacks": 490,
    "monsterBattles": 8513,
    "investments": 95,
    "equipmentBought": 2917,
    "levelUps": 1850,
    "duelsAccepted": 5059,
    "banditCardsUsed": 11732,
    "averageFinalLevel": 1.4625
  }
}
```

- Commit: `253ac91 fix(engine): sharpen bot personalities and their tests` (implementation and tests; report appended afterward).
