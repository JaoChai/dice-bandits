# Balance log (2026-09-27)

Simulation command: `npm run sim -- --games 1000 --players 4`. Bot classes and personalities rotate deterministically across seats and games. Engagement values are aggregate totals per run; average final level is per player in completed games.

## Iteration 1 — baseline

**Change:** None; starting data as authored.

**Full report:**

```json
{
  "games": 1000,
  "crashes": 0,
  "stuck": 0,
  "avgRounds": 12,
  "classWinRate": {
    "knight": 0.1245,
    "thief": 0.1275,
    "mage": 0.678,
    "cleric": 0.07
  },
  "comebackRate": 0.097,
  "seatWinRate": [0.2545, 0.235, 0.239, 0.2715],
  "engagement": {
    "townsClaimed": 2120,
    "townFlips": 395,
    "levelUps": 2947,
    "duelsAccepted": 5116,
    "banditCardsUsed": 11712,
    "averageFinalLevel": 1.73675
  }
}
```

**Judgment:** No engine/liveness failures, and comeback rate clears 0.08. Mage is overrepresented and Cleric underrepresented, so tune only class data next.

## Iteration 2 — reduce Mage magical power

**Change:** In `packages/engine/src/data/classes.json`, Mage base MAG 15→11 and MAG growth 3→2; no engine rules changed.

**Full report:**

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

**Judgment:** All required thresholds pass: every class win rate is within [0.15, 0.35], comeback rate is at least 0.08, and there are no crashes or stuck games. Bots recorded substantial monster battles, town attacks/claims/flips, equipment purchases, investments, level-ups, duels, and bandit-card use. Stop tuning.

## Leveling retune — trial 1 (2026-09-27)

**Change:** Replaced `xpToLevel` with `[0, 10, 11, 12, 13, 14, 15, 20, 30, 45, 65, 90, 120, 155, 195]` (15 strictly increasing cumulative thresholds). XP-distribution probe using original monster data: 4,000 player-game samples, mean XP 23.46875, median 0, p75 30, p90 75, max 280; 2,375 players (59.4%) ended with 0 XP. The candidate run produced a mean 0.83725 XP award events/player (2,407 players got 0, 737 got 1, 405 got 2, 204 got 3, 120 got 4, 72 got 5, 36 got 6, 18 got 7, 1 got 8). Because each XP award yields at most one level, thresholds alone cannot deliver 4–6 while XP-award counts remain this low.

**Full report:**

```json
{
  "games": 1000,
  "crashes": 0,
  "stuck": 0,
  "avgRounds": 12,
  "classWinRate": { "knight": 0.228, "thief": 0.26, "mage": 0.3375, "cleric": 0.1745 },
  "comebackRate": 0.114,
  "seatWinRate": [0.261, 0.283, 0.2225, 0.2335],
  "engagement": {
    "townsClaimed": 1447,
    "townFlips": 186,
    "townAttacks": 507,
    "monsterBattles": 8556,
    "investments": 69,
    "equipmentBought": 3032,
    "levelUps": 3349,
    "duelsAccepted": 5094,
    "banditCardsUsed": 11732,
    "averageFinalLevel": 1.83725
  }
}
```

**Judgment:** Liveness/class/comeback guardrails pass; average level misses the target.

## Leveling retune — trial 2 (2026-09-27)

**Change:** Kept the trial-1 XP thresholds; halved monster base stats and reduced growths to approximately half, to increase monster-win XP awards using data only.

**Full report:**

```json
{
  "games": 1000,
  "crashes": 0,
  "stuck": 0,
  "avgRounds": 12,
  "classWinRate": { "knight": 0.282, "thief": 0.256, "mage": 0.398, "cleric": 0.064 },
  "comebackRate": 0.067,
  "seatWinRate": [0.302, 0.273, 0.212, 0.213],
  "engagement": {
    "townsClaimed": 4044,
    "townFlips": 675,
    "townAttacks": 1682,
    "monsterBattles": 8984,
    "investments": 171,
    "equipmentBought": 4722,
    "levelUps": 10549,
    "duelsAccepted": 5560,
    "banditCardsUsed": 11775,
    "averageFinalLevel": 3.63725
  }
}
```

**Judgment:** Liveness passes and level mean is nearer the target, but Mage (.398), Cleric (.064), and comeback (.067) fail their limits. Continue with a class-data adjustment and a less extreme monster rebalance.

## Leveling retune — trial 3 (2026-09-27)

**Change:** Kept trial-1 XP thresholds and trial-2 monster data; reduced Mage MAG base/growth 11/2→8/1 and raised Cleric HP/ATK/MAG base to 50/12/13 and growth to 6/2/3.

**Full report:**

```json
{
  "games": 1000,
  "crashes": 0,
  "stuck": 0,
  "avgRounds": 12,
  "classWinRate": { "knight": 0.267, "thief": 0.243, "mage": 0.224, "cleric": 0.266 },
  "comebackRate": 0.061,
  "seatWinRate": [0.293, 0.286, 0.228, 0.193],
  "engagement": {
    "townsClaimed": 4173,
    "townFlips": 792,
    "townAttacks": 1825,
    "monsterBattles": 8773,
    "investments": 180,
    "equipmentBought": 4805,
    "levelUps": 11278,
    "duelsAccepted": 5497,
    "banditCardsUsed": 11719,
    "averageFinalLevel": 3.8195
  }
}
```

**Judgment:** Every class is within range; the average level is 0.1805 short of 4.0 and comeback is below 0.08. Continue tuning.

## Leveling retune — trial 4 (2026-09-27)

**Change:** Kept the trial-3 class stats and trial-1 XP thresholds; reduced monster base stats/growth further (approx. 40% of original) and increased `bountyGold` 200→600 and `bountyRounds` 2→3.

**Full report:**

```json
{
  "games": 1000,
  "crashes": 0,
  "stuck": 0,
  "avgRounds": 12,
  "classWinRate": { "knight": 0.264, "thief": 0.243, "mage": 0.195, "cleric": 0.298 },
  "comebackRate": 0.065,
  "seatWinRate": [0.286, 0.286, 0.215, 0.213],
  "engagement": {
    "townsClaimed": 4468,
    "townFlips": 795,
    "townAttacks": 2016,
    "monsterBattles": 8820,
    "investments": 175,
    "equipmentBought": 5220,
    "levelUps": 12207,
    "duelsAccepted": 5526,
    "banditCardsUsed": 11721,
    "averageFinalLevel": 4.05175
  }
}
```

**Judgment:** Level target and class limits pass; comeback remains under .08. Increase the underdog card's direct steal effect next.

## Leveling retune — trial 5 (2026-09-27)

**Change:** Kept trial-1 XP thresholds and prior monster/class data; raised `pickpocketFarPct` 10→30 to strengthen the underdog's direct steal card. `bountyGold` remains 600 and `bountyRounds` 3.

**Full report:**

```json
{
  "games": 1000,
  "crashes": 0,
  "stuck": 0,
  "avgRounds": 12,
  "classWinRate": { "knight": 0.239, "thief": 0.242, "mage": 0.201, "cleric": 0.318 },
  "comebackRate": 0.076,
  "seatWinRate": [0.265, 0.27, 0.211, 0.254],
  "engagement": {
    "townsClaimed": 4465,
    "townFlips": 797,
    "townAttacks": 2028,
    "monsterBattles": 8734,
    "investments": 188,
    "equipmentBought": 5302,
    "levelUps": 12131,
    "duelsAccepted": 5512,
    "banditCardsUsed": 11718,
    "averageFinalLevel": 4.03275
  }
}
```

**Judgment:** Level/class/liveness pass; comeback is close but still 0.004 below the guardrail. Continue.

## Leveling retune — trial 6 (2026-09-27)

**Change:** Kept trial-1 XP thresholds, monster data, class stats, `bountyGold` 600, and `bountyRounds` 3; increased `pickpocketFarPct` 30→50.

**Full report:**

```json
{
  "games": 1000,
  "crashes": 0,
  "stuck": 0,
  "avgRounds": 12,
  "classWinRate": { "knight": 0.246, "thief": 0.237, "mage": 0.215, "cleric": 0.302 },
  "comebackRate": 0.128,
  "seatWinRate": [0.254, 0.257, 0.235, 0.254],
  "engagement": {
    "townsClaimed": 4453,
    "townFlips": 806,
    "townAttacks": 2000,
    "monsterBattles": 8799,
    "investments": 196,
    "equipmentBought": 5531,
    "levelUps": 12223,
    "duelsAccepted": 5466,
    "banditCardsUsed": 11724,
    "averageFinalLevel": 4.05575
  }
}
```

**Judgment:** All gates pass: average final level 4.05575, class rates 0.215–0.302, comeback 0.128, no crashes or stuck games. Stop tuning.

## M5a fixed map — data-only tuning (2026-10-02, M5a Task 2 step 5)

Board is the authored fixed map (35 free slots; meadow 7, desert 11, snow 11, volcano 6). Two gates must pass on the branch: (A) `npm run sim -- --games 200 --players 4` exit 0 (every class win rate in 0.15–0.35, comeback ≥ 0.08); (B) n=1000 within the plan Step-5 band vs main (`|branch − main| ≤ 0.10 × main` for class win rates, comebackRate, `engagement.townFlips`).

**Main reference (bda7adc, trial-6 data), measured fresh on this branch's toolchain:** knight .246, thief .237, mage .215, cleric .302, comeback .128, townsClaimed 4453, townFlips 806, monsterBattles 8799, avgFinalLevel 4.056 → band ceilings knight .271, thief .261, mage .237, cleric .332; comeback floor .115; townFlips ceiling 887.

Starting point (authored branch data `slotWeights {town:3, monster:4, chest:2, event:2, trap:1}`, new monster table): n=200 cleric **.380** → gate A FAIL; n=1000 townFlips **977** → gate B FAIL (cleric .325 in band).

| Iter | Change                           | n=200 cleric (gate A)   | n=1000 townFlips (ceiling 887) | Verdict                                           |
| ---- | -------------------------------- | ----------------------- | ------------------------------ | ------------------------------------------------- |
| 0    | authored data                    | .380 FAIL               | 977                            | both fail                                         |
| 1    | monster weight 4→3               | .325 pass               | 1001                           | A pass, B fail (comeback .115 grazes floor .1152) |
| 2    | town weight 3→2                  | .275 pass               | 946                            | A pass, B fail                                    |
| 3    | monster gold −20% (xp untouched) | .285 pass               | 954                            | A pass, B fail                                    |
| 4    | town weight 2→1                  | .265 pass               | 865                            | B pass but board repair breaks (see finding F3)   |
| 5    | monster xp −20%                  | .285 pass               | 954                            | byte-identical to iter 3 — xp inert (F2)          |
| 6    | town 2, monster 4                | .335 pass (margin .015) | 929                            | A pass, B fail; comeback/levels drifting up       |

**Current tree = iteration 3** (best candidate: `slotWeights {town:2, monster:3, chest:2, event:2, trap:1}`, monster gold 32/48/120/40/40/72/96/72, xp original). Engine suite 128/128 green under it. Remaining gap: townFlips 954 vs 887 (+7.5%).

**Findings (measured on this branch, probes in scratch):**

- **F1 — townFlips are duel seizes, not town battles.** Full sim-loop probe (bots, 200 games): flips 177 = 174 via `pvpReward reward:'seize'` (duel win on a town) + 3 via town-guardian battle wins. Flip volume therefore scales with town-space count and duel frequency, not monster rewards.
- **F2 — monster xp is inert on the sim path.** Probe: jellyBun xp 16 → 500 produced byte-identical reports. `xpToLevel` thresholds (10,11,12,13,14,15,20,30,45,65…) are smaller than typical grants (16–48), and xp accumulates without reset, so effectively every battle win levels the player: grant size changes cannot change level counts.
- **F3 — town weight 1 is structurally invalid.** Board repair guarantees ≥2 towns/region by donating from the bag pool; at weight 1 several seeds leave volcano with zero town donors (`no donor space in region volcano`), and seeded test `targeted.test.ts` 'end' hits an early gameOver (skip-chain past a trap skip at round 12). Town ≥ 2 is a hard floor.
- **F4 — monster gold −20% moved flips by <1%** (946→954, within sampling noise): seizes are driven by duel dynamics, not attacker wealth from monster gold.
- **F5 — cleric's n=200 ceiling needs monster share ≤ 33%.** At share 25% (monster 3): cleric .285–.311; at 36% (monster 4): .335–.380. The gate band's top (0.35) allows little headroom above share 33%.

Untested data lever (weak, risk noted): diluting town share via `event` weight 2→4..5 (flips −3.5% per observed dilution elasticity — likely short of −7.5% — while event spaces teleport players onto towns, a countervailing flip pressure).

**Status after 6 data-only iterations:** gate A passes; gate B fails on `engagement.townFlips` alone (all other band metrics — 4 class rates, comebackRate — inside 10% of main). Blocked per ruling: next step needs the lead's call.

Ruling: accepted iter 3 under the one-sided townFlips band (954 ≤ 1.25 × 806 = 1007).

## M5a review round 1 — final reports (2026-10-02, review fixes on wt/m5a-t2)

**Full main + branch reports, n=1000, `npm run sim -- --games 1000 --players 4` (review items 3–5).**

Main (bda7adc, trial-6 data, measured fresh on this branch's toolchain):

```json
{
  "games": 1000,
  "crashes": 0,
  "stuck": 0,
  "avgRounds": 12,
  "classWinRate": { "knight": 0.246, "thief": 0.237, "mage": 0.215, "cleric": 0.302 },
  "comebackRate": 0.128,
  "seatWinRate": [0.254, 0.257, 0.235, 0.254],
  "engagement": {
    "townsClaimed": 4453,
    "townFlips": 806,
    "townAttacks": 2000,
    "monsterBattles": 8799,
    "investments": 196,
    "equipmentBought": 5531,
    "levelUps": 12223,
    "duelsAccepted": 5466,
    "banditCardsUsed": 11724,
    "averageFinalLevel": 4.05575
  }
}
```

Branch (iter 3 data, current head — byte-identical to the accepted iter 3):

```json
{
  "games": 1000,
  "crashes": 0,
  "stuck": 0,
  "avgRounds": 12,
  "classWinRate": { "knight": 0.2515, "thief": 0.2155, "mage": 0.229, "cleric": 0.304 },
  "comebackRate": 0.126,
  "seatWinRate": [0.2625, 0.257, 0.223, 0.2575],
  "engagement": {
    "townsClaimed": 5416,
    "townFlips": 954,
    "townAttacks": 2203,
    "monsterBattles": 8437,
    "investments": 235,
    "equipmentBought": 5563,
    "levelUps": 12846,
    "duelsAccepted": 5507,
    "banditCardsUsed": 11665,
    "averageFinalLevel": 4.2115
  }
}
```

Band check vs main: knight +.0055 ≤ .0246 ✓, thief −.0215 ≤ .0237 ✓, mage +.014 ≤ .0215 ✓, cleric +.002 ≤ .0302 ✓, comeback −.002 ≥ −.0128 (floor .115) ✓, townFlips 954 within one-sided band [725, 1007] ✓ (lead ruling 2026-10-02).

**Per-seed generateBoard timing (review item 3; 2,000 seeds/run, same vitest worker/transform both trees, 3 runs each, medians):** pre-fix (def4f58) typical 26.3 µs/seed, adversarial-retry seed 24.0 µs/seed; post-fix (current head) typical 27.8 µs/seed, adversarial-retry seed 23.3 µs/seed — parity within run-to-run variance; no retry-path cost regression (probe in scratch, not committed).
