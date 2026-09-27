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
