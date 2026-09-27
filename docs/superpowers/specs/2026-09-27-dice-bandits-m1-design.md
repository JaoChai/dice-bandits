# Dice Bandits (โจรลูกเต๋า) — M1 Prototype Design

- Date: 2026-09-27
- Status: Draft for owner review
- Owner: Marci · Planner/lead: Monday (Sol) · Implementation: Worker subagents
- Repo: `~/Code/dice-bandits` → GitHub `JaoChai/dice-bandits` (private)

## 1. Vision

A browser party board-RPG in the spirit of Dokapon Kingdom: roll dice, move on a board,
fight monsters, own towns, and — most importantly — rob, prank, and betray friends.
The product promise is **"the friendship-ruining game you can finish in one evening"**.

Design pillars (every feature must serve at least one):

1. **Drama between players** — PvP theft, pranks, betrayal moments people retell.
2. **Nobody is out of the game** — trailing players get tools to hurt the leader.
3. **Every run is different** — random board, random world rule, 1-of-3 level-up picks.
4. **Short and peaking** — a Quick game ends in ~30 min and the last rounds hit hardest.

## 2. Milestones (only M1 is in scope for this spec)

| Milestone | Goal | Proves |
|---|---|---|
| **M1 Prototype** | Browser game, 1–4 humans hot-seat on one device + bots, deployed on Cloudflare | The loop is fun |
| M2 Online | Durable Object room, room codes, reconnect, bot takeover | Remote play with friends |
| M3 Accounts | D1 + R2, match history, unlocks, shareable recap | Retention |
| M4 Art polish | Production sprites, animations, juice, audio | Presentation |

M2–M4 each get their own spec → plan cycle. M1 must not block them (see §4 engine boundary).

## 3. M1 scope

### In scope
- 2–4 seats, each seat Human or Bot; humans share one device (hot-seat).
- One board generator (seeded), 4 classes, ~30 item cards, 6 monster types.
- Quick mode only (12 rounds).
- Thai + English UI, switchable at any time.
- Autosave to `localStorage`; "Continue" resumes the last unfinished game.
- Deployed to `https://dice-bandits.<account-subdomain>.workers.dev`.

### Out of scope (explicitly deferred)
Online play, accounts, unlocks, story mode, audio, production sprite animation,
custom domain, analytics, monetization, Standard/Campaign modes.

## 4. Architecture

Approach **C — shared pure engine**, chosen over hot-seat-only (rewrite risk in M2)
and online-first (slow path to first playtest).

```
dice-bandits/
  packages/engine/      pure TypeScript game rules — no DOM, no Phaser, no I/O
  apps/client/          Vite + Phaser 4 + DOM UI; deployed as Workers Static Assets
  tools/pixelize/       concept-art → grid-snapped, palette-locked sprites
  docs/concepts/        ChatGPT-image concept art (reference only, not shipped)
```

- **Engine contract:** `step(state, action) → { state, events[] }`.
  `state` is plain JSON (serializable, structured-cloneable). `events` describe what
  happened (`DiceRolled`, `Moved`, `BattleRound`, `GoldStolen`, …) and carry i18n keys +
  params, never display strings. The client animates events; it never mutates state.
- **Determinism:** all randomness comes from a seeded PRNG stored inside `state`
  (e.g. `mulberry32`/`sfc32`). Same seed + same actions ⇒ identical game. This enables
  replays, reproducible bug reports, and in M2 the Durable Object runs the same `step`.
- **Validation:** `legalActions(state, seat)` lists what the current seat may do; `step`
  rejects anything else. In M2 the server trusts only this.
- **Bots:** `chooseAction(state, seat, personality, rng)` in the engine package — pure,
  rule-based, no LLM, no network.
- **Client:** Phaser renders board, tokens and battle scene on a canvas; menus, HUD,
  dialogs and card hands are **DOM overlays** (crisp Thai text, accessible, easy
  Playwright selectors). A thin `GameController` owns `state`, feeds actions to `step`,
  queues `events` for animation, triggers bot turns, and autosaves.
- **M1 Worker:** assets-only SPA via `@cloudflare/vite-plugin` + `wrangler.jsonc`
  (`assets.not_found_handling = "single-page-application"`). No Worker script yet;
  M2 adds `main` + Durable Object without restructuring.

## 5. Game rules (M1)

Numbers below are **starting values**; the balance simulator (§8) may tune them, and
tuned values live in `packages/engine/src/data/*.json`, not in code.

### 5.1 Setup
- Seats 2–4; each chooses a class and (bots) a personality. Start: 300 G, level 1,
  all tokens on the Castle space.
- Seed from URL `?seed=` or random. One **World Rule** is drawn per game (§5.8).

### 5.2 Board
- 40 ± 4 spaces assembled from hand-authored **chunks** (8–12 spaces each) into a loop
  with 2 branch forks. Four regions (Meadow, Desert, Snow, Volcano) — each with its own
  color and monster table; danger rises Meadow → Volcano.
- Space types: **Castle** (start, heal, respawn), **Town** (ownable, taxes),
  **Shop** (buy/sell), **Chest** (random item/gold), **Monster** (fight),
  **Event "?"** (random event), **Trap** (lose gold or skip a turn).
- Generator guarantees: every region has ≥ 2 Towns and 1 Shop; no two Traps adjacent;
  every space reachable. Checked by tests over 10,000 seeds.

### 5.3 Turn flow
1. Start of turn: collect tax from owned towns (Final Frenzy ×2); underdog check (§5.6).
2. Optionally use one field card.
3. Roll 1d6 (Dash cards/abilities may add dice); move exactly that many spaces,
   choosing a direction at forks. Passing another player lets you **stop to duel** them.
4. Resolve the landing space.
5. End turn. A round = every seat has taken one turn. Game ends after round 12.

### 5.4 Characters and classes
Stats: HP, ATK, DEF, SPD, MAG. Level-up after enough XP → full heal + choose **1 of 3**
random perks (stat boosts or small passives). Level cap for M1: 15.

| Class | Identity | Secret Move (once per battle, shown face-down as "?") |
|---|---|---|
| Knight | tanky, town defender | **Bulwark** — take 0 damage this exchange, reflect 50% |
| Thief | fast, steals | **Pickpocket** — steal 15% of target gold, then Attack |
| Mage | burst damage | **Firestorm** — 2× MAG damage, ignores Defend |
| Cleric | sustain, support | **Sanctuary** — heal 40% max HP, next hit taken halved |

### 5.5 Battle
- A battle is up to 3 **exchanges**; each exchange both sides act once, higher SPD
  first. The acting side is the Attacker for that half-exchange.
- Attacker picks secretly: **Attack**, **Strike**, or **Secret**.
  Defender picks secretly: **Defend** or **Counter**.

| Attacker \ Defender | Defend | Counter |
|---|---|---|
| Attack (1.0×) | damage × 0.5 | damage × 1.0 |
| Strike (1.5×) | damage × 1.5 (guard broken) | **attacker** takes its own Strike × 1.0; defender unharmed |

- Damage = `max(1, (ATK × mult − DEF / 2) × variance[0.9–1.1])`.
- Secret Move: once per battle, either side may play it instead of its normal pick
  (as Attacker or Defender). It skips the matrix and resolves exactly as its text says;
  against a monster, Pickpocket steals 0 G but still Attacks.
- Battle ends at KO or after 3 exchanges (nobody wins; no rewards).
- **Monster win:** XP + gold. **KO'd by monster/trap:** lose 20% gold, respawn at the
  Castle, skip next turn.
- **PvP win:** winner chooses one: **Rob** (take 30% of loser gold), **Loot** (take one
  chosen item), **Seize** (take one of the loser's towns), or **Prank** (loser's
  token wears a silly hat and their name is replaced by one the winner picks from a
  preset list, for 3 rounds). Loser respawns as above.

### 5.6 Towns and comeback
- **Town:** landing on an unowned town starts a fight with its occupying monster;
  winning claims it. Owner may **Invest** (pay gold, +50% town value, +tax). An enemy
  landing on your town may attack it (fight a guardian scaled to town value) to seize it.
- **Underdog rule:** at the start of each round, the seat with the lowest net worth gets
  one **Bandit Card** (hold max 2): *Pickpocket from afar* (steal 10% of the leader's
  gold), *Cursed Legs* (leader rolls 1d3 next turn), *Bounty* (whoever KOs the leader
  in the next 2 rounds gains +200 G). Bandit Cards can only target the current leader.
- **Leader crown:** the leader is always visibly marked.

### 5.7 Items (~30 cards, data-driven)
Three kinds: **Field** (use before rolling: Dash, Warp to Castle, Trap Card, Smoke Bomb),
**Battle** (use during battle: Potion, Iron Skin, Poison Blade), **Equipment**
(permanent stat items; one weapon + one armor slot). Inventory max 6.
Full list and prices are authored in `data/items.json` during implementation and
tuned by simulation.

### 5.8 World Rules (1 random per game)
Starting set of 6, e.g. *Gold Rush* (Chest gold ×2), *Tax Holiday* (no tax rounds 1–4),
*Monster Surge* (monsters +1 level), *Slippery Roads* (Snow spaces move you +1),
*Black Market* (Shops sell a rare item), *Cursed Capital* (Castle heals only 50%).

### 5.9 Endgame and winning
- Rounds 10–12 are **Final Frenzy**: all gold rewards and taxes ×2; banner + camera
  shake on entry.
- After round 12: highest **net worth** wins = gold + item resale value + town values.
  Tie → more towns → higher level → shared win.
- Results screen: final ranking + 3 highlight lines from the event log
  (e.g. "Biggest robbery", "Most KO'd", "Town that changed hands most").

### 5.10 Bot personalities
All bots use the same legal-action enumeration and score actions with weights:
- **Greedy** — prioritizes chests, towns, Rob; avoids danger when rich.
- **Vengeful** — remembers who hurt it and hunts that player (PvP, Seize, Prank).
- **Cowardly** — avoids players/strong monsters, invests in towns, Defends often.
Bots add small seeded noise so they do not play identically. Thinking delay in the UI:
400–900 ms (0 ms under test speed).

## 6. Client and presentation

- Base resolution **640×360** (16:9), Phaser `pixelArt: true` (nearest filtering,
  `roundPixels`), `Scale.FIT` + `autoCenter`. Mobile: landscape is the target; portrait
  shows a "rotate your device" hint.
- Art style **A (16-bit SNES)** per `docs/concepts/style_16bit.png`; locked 32-color
  palette derived from the concepts, stored in `tools/pixelize/palette.json`.
- M1 art: board spaces drawn from pixel tiles + icons; class and monster sprites cropped
  from concept sheets and run through `tools/pixelize` (nearest downscale to a
  32×32 grid, palette quantization, transparent background). Hand touch-up is M4.
- Juice minimum for M1: dice roll animation, token hop per space, damage numbers,
  screen shake on hits, coin burst on theft, crown on leader.
- **i18n:** `apps/client/src/i18n/{th,en}.json`; engine events carry keys; language
  switch in settings, persisted to `localStorage`, default from `navigator.language`.
- **Fonts:** DOM UI uses **Chakra Petch** (OFL, Thai + Latin) for body text and a
  Latin pixel font (OFL) for numbers/titles. Canvas text is limited to numbers and
  short Latin labels. Fonts are self-hosted with the build (no third-party CDN).
- Test hooks, enabled only when built with `VITE_TEST_HOOKS=1`: `?seed=`, `?speed=`
  (animation multiplier; `0` = instant), and `window.__db.getState()`.

## 7. Error handling

- Illegal action → `step` throws `IllegalActionError`; controller logs it and keeps the
  prior state (UI should never offer illegal actions; tests assert this).
- Corrupt/incompatible autosave (schema `version` mismatch) → discarded with a toast,
  never crashes the title screen.
- Asset load failure → error screen with Retry.
- Engine invariants checked in tests and in dev builds after each step: gold ≥ 0,
  HP within [0, max], exactly one current seat, round ≤ 12.

## 8. Testing and quality gates

- **Engine unit tests (Vitest):** combat matrix, damage formula, movement/forks,
  tax, PvP outcomes, underdog rule, save/load round trip, board generator guarantees
  over 10,000 seeds.
- **Simulation (`npm run sim`):** 1,000 bot-only games with fixed seeds. Pass criteria:
  0 crashes/stuck games; every game reaches the results state after round 12; every class win
  rate between 15% and 35% in 4-player games; last-place-at-round-6 player wins ≥ 8%.
- **Playwright (`@playwright/test`):** Chromium desktop 1280×720 and mobile landscape
  (Pixel-class 915×412): title → setup (1 human + 3 bots) → play a full seeded game at
  `speed=0` to results; TH↔EN switch changes visible text; Continue after reload
  resumes the same state; portrait shows the rotate hint.
- **Static checks:** `tsc --noEmit`, ESLint, Prettier check.
- **CI:** GitHub Actions on push/PR runs typecheck, lint, unit, sim (reduced to 200
  games), Playwright, and build. CI green is required before any deploy.
- **Deploy:** `npm run deploy` (Vite build + `wrangler deploy`) from this machine after
  CI is green and the owner approves; then a live smoke test on the workers.dev URL.

## 9. Acceptance criteria for M1

1. Opening the workers.dev URL on desktop and mobile landscape loads the title screen.
2. A game with 1 human + 3 bots can be played to the results screen in ~30 minutes at
   normal speed; a 4-human hot-seat game also works.
3. All rules in §5 are implemented and covered by unit tests; simulation thresholds in
   §8 pass.
4. UI fully available in Thai and English.
5. CI green on `main`; Playwright journeys pass on both viewports.

## 10. Documentation basis (checked 2026-09-27)

- npm latest: `phaser` 4.2.1, `vite` 8.3.1, `wrangler` 4.141.0; local Node v26.9.0.
- Cloudflare docs: Vite plugin + Workers Static Assets; SPA requires
  `assets.not_found_handling = "single-page-application"`; with the Vite plugin the
  `assets.directory` field is not used (build output is wired automatically);
  `.wrangler` and `.dev.vars*` belong in `.gitignore`.
- Phaser docs (Context7 `/websites/phaser_io_api-documentation`, `/websites/phaser_io_phaser4`):
  `pixelArt: true` sets nearest filtering, disables antialias, enables `roundPixels`;
  `Scale.FIT` fits the parent; Phaser 4 keeps a largely Phaser-3-compatible public API
  with a migration guide — implementation tasks must re-check any API against Phaser 4
  docs before use.
- Durable Objects WebSocket Hibernation (for M2): confirmed available; details go into
  the M2 spec.

## 11. Risks

- **Fun is unproven** → the simulation plus a real 4-person playtest decide whether
  rules change before M2.
- **Concept art is pixel-styled, not true pixel art** → pixelize pipeline for M1,
  hand-made sprites in M4.
- **Phaser 4 is new** → fewer examples; verify APIs against docs per task.
- **Hot-seat hides secret battle choices poorly** → each human picks behind a
  "pass the device" screen before choices are revealed.
