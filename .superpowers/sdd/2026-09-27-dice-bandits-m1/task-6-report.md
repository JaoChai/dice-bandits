# Task 6 report — spaces, towns, shop, items, leveling

**Commit:** `9f7779abb37739720863d8f9bf5574bcf85878f5` — `feat(engine): spaces, towns, shop, items and leveling`

## Changes

- Added landing-space resolution for castle healing, town encounters, shops, chests, regional monsters, six random events, and traps. Random draws persist their advanced RNG state.
- Added town taxes, tax holidays, Frenzy doubling, town investment/challenge phases, guardian ownership transfer, town-flip statistics, and monster XP/level-up integration.
- Added regional shop stock, Black Market stock, buy/sell pricing, Haggler discounts, equipment stat changes, inventory-cap auto-sale, and field/battle item effects.
- Added XP thresholds, three distinct perk offers, class stat growth, full healing, perk selection, and level cap handling. Extended legal-action enumeration and turn movement to resolve these phases; implemented Quick Feet and Thick Skin effects.
- Added Task 6 tests and updated earlier flow tests to account for real landing encounters.

## RED / GREEN evidence

- **RED:** Before implementation, `npm test -w @dice-bandits/engine -- --run test/spaces.test.ts` failed because `../src/rules/spaces` did not exist; Vitest could not load the suite (0 tests executed).
- **GREEN:** Final `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, and `git diff --check` all passed. Vitest reported **10 test files, 77 tests passed**.

## Judgment calls

- Interpreted Taxman’s “+20% tax” as a 1.2× multiplier on the configured tax rate.
- Shop stock is six weighted draws without replacement from the region-tier-capped item pool; Black Market adds a distinct random tier-3 equipment item.
- An unowned town’s guardian is the first data-listed monster available in that town’s region, scaled to its guardian level; Monster Surge adds one level. Enemy-town challenges use a synthetic guardian scaled from the town owner’s stats and value-derived level.
- Map Scroll selects a forced 1–6 roll; Quick Feet applies to a raw roll of exactly 1. Poison Blade applies its configured percentage of max HP at the end of each full exchange; Iron Skin halves incoming ordinary damage.

## Concerns

- `looter` and `grudgeHolder` are offered and stored as perks, but their PvP/leader-dependent behavior is outside Task 6 and remains for the corresponding PvP/ranking work.
- Poison and Iron Skin timing/mitigation were not numerically specified beyond the item data and perk descriptions; the interpretations above are deterministic and covered by engine tests.

## Fix: battle deadlock

- **RED:** `npm test -w @dice-bandits/engine -- --run test/liveness.test.ts` failed at the liveness assertion because at least one non-game-over state had no legal action for any seat.
- **GREEN:** The new test drives 50 seeded 2–4-seat games through `gameOver` within 20,000 steps, checks each live state has an action, and validates final invariants. The targeted fast-monster test confirms start-time RNG advancement, a pre-drawn monster attack, available player defense actions, and no pick event before the player acts. Both tests pass.
- Auto-draw monster picks at battle start and after each half advances. Monster pick events are emitted only when that half resolves, preserving the reveal timing. Reviewed level-up, town-management/challenge, and shop action generation; leave/decline actions are present as needed, and the 50-game liveness run found no additional deadlocks.
- Existing battle, item, and town tests were updated for the pre-drawn-pick flow. Engine suite: 11 test files, 79 tests passed.

## Fix: review findings

- **RED:** `npm test -w @dice-bandits/engine -- --run test/spaces.test.ts` failed on the new placed-trap landing test and tier-weight distribution assertion before the implementation changes. The initial wider run also exposed fixture issues in the new focused castle, guardian, and pinned-seed checks; those fixtures were corrected and the expected regressions remained.
- **GREEN:** A player-owned trap now triggers before castle/chest behavior when another player lands on that non-trap space, costs the configured gold, may skip the visitor, is consumed, and leaves normal landing behavior intact. The placer remains immune. Shop stock now uses seeded weighted sampling without replacement: each eligible item whose price tier matches the region tier gets weight 3, lower tiers weight 1; RNG state is persisted. Black Market's extra tier-3 equipment draw is unchanged.
- Added focused assertions for tier weighting across 100 deterministic seeds, castle full/half healing, guardian town claim and `TownClaimed`, Black Market tier-3 stock, Gold Rush/scavenger chest multipliers, pinned trap skip, and placed-trap firing/consumption/placer immunity.
- **Verification:** `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, and `git diff --check` pass. Vitest: 11 files, 88 tests passed.
