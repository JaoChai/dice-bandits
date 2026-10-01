# Dice Bandits — M5a Cartoon Redesign (visuals + fixed map) — Design

Status: draft for owner review · Date: 2026-10-02 · Milestone: M5a
Owner: Marci · Planner/lead: Monday · Implementation: Worker subagents (dev-* kanban team)

## 1. Goal

Replace the 16-bit pixel look with the approved **chibi cartoon** style
(thick dark-brown outlines, cel shading, candy colours, ~2.5-head-tall characters) across the
whole game, move from a fully random board to a **fixed authored map** with randomised space
contents, and make the board screen self-explanatory. Game rules stay as they are today.

Why: the owner rejected the live game as "not pretty, not understandable, not like Dokapon".
The live review (2026-10-01) found: tiny unreadable space icons with no legend, a path that
blends into the desert, no turn indicator, a pixel world under a plain-web HUD, and no sense
of place. M5a fixes the look and readability; story (M5b) and new rules (M5c) follow.

Approved concept set (owner chose style A, 2026-10-01), stored as WebP in
`docs/concepts/m5/` (full-size PNG originals in `~/Code/dice-bandits-art-staging/story1-concepts/`;
attach the PNGs as image-model references):
`01_world_map`, `02_heroes`, `03_cast`, `04_monsters`, `05_spaces`, `06_items`, `07_places`,
`09_board_screen`, `10_battle_screen`, `13_title_screen`, `14_palette_ui` (+ story images used
by M5b). Concept explainer: ELI5 gist `bcfb1acfda72780b7708a2e571961d92`.

## 2. Owner decisions (brainstorm 2026-10-01/02)

| # | Decision |
|---|---|
| 1 | Art style: chibi cartoon (not pixel art, not 3D). |
| 2 | Redesign split into **M5a** visuals + fixed map → **M5b** story + Dicey tutor → **M5c** King's Orders, Baron boss, Mask Gang. Each ships and is play-tested before the next. |
| 3 | **Fixed map, random contents:** one authored road layout; which space is Monster/Chest/Trap/etc. is re-rolled per game under the existing guarantees. |
| 4 | **Close camera that follows the active player** + a "whole map" button. |
| 5 | Animation by **paper-puppet tweening**: a few static poses per character, motion from squash/stretch/hop/tilt/shake tweens. No frame-by-frame sheets. |
| 6 | **Landscape only**, desktop + phone; portrait shows the existing rotate hint. |
| 7 | Map art: **Monday authors the road graph first**; the image model paints only terrain/scenery around it; the game draws road + tiles on top. |
| 8 | All four new systems (Dicey, King's Orders, Baron, Mask Gang) are wanted — but not in M5a. |

## 3. Scope

In scope (M5a):
- Renderer switch to smooth cartoon rendering at **1280×720** logical resolution.
- Fixed map graph in the engine + randomised kinds (§5).
- Painted world-map background + game-drawn road and round tiles (§6).
- Follow camera, whole-map view, tap-a-space info popup, fork arrows, active-turn glow (§7).
- New hero art and names, 8 new monsters replacing the 6 old ones (§8).
- Full UI re-skin: title, setup, lobby/online screens, board HUD, battle, dialogs, results (§9).
- Asset pipeline from generated images to shipped WebP atlases (§10).

Out of scope: intro comic, Dicey, King's Orders, Baron boss, Mask Gang (M5b/M5c); new items
or item behaviour; audio changes (existing M4b audio kept as is); accounts (M3).

## 4. Constraints kept

- Hot-seat and online share one renderer; engine stays pure and deterministic; the room/worker
  protocol shape is unchanged (the board is still part of `GameState`).
- Every existing `data-testid` keeps its name and meaning; new elements get new ids.
- i18n: every new visible string in `en.json` and `th.json`; Thai wraps, never clips.
- `?speed=0` makes all motion instant; `prefers-reduced-motion` disables shake, flashes,
  ambient loops and camera easing (camera snaps).
- No third-party CDN; fonts self-hosted.
- Hero names are display flavour: class ids (`knight`, `thief`, `mage`, `cleric`) and Secret
  Moves stay. Default seat names become the hero names; players can still type their own.

## 5. Fixed map, random contents (engine)

- New data file `packages/engine/src/data/map.json`: the authored graph — about **40 spaces**,
  one closed loop with **2 forks** (each fork rejoins), the Castle as start, and each space's
  `region` (Honey Meadow = `meadow`, Coin Dunes = `desert`, Frostbite Peaks = `snow`,
  Ember Volcano = `volcano`; engine ids unchanged). Coordinates are in map pixels on the
  painted background (§6), so `Space.x/y` meaning changes from grid units to map pixels.
- Each map space is either **fixed** (Castle; one Shop per region) or a **slot**. Per game,
  `generateBoard(seed)` assigns slot kinds from the seeded RNG and runs the existing repair
  rules. Guarantees kept and tested over **10,000 seeds**: each region ≥ 2 Towns and 1 Shop,
  no two Traps adjacent, every space reachable, same seed → same board.
- Danger still rises Meadow → Volcano. Old chunk generator and `chunks.json` are removed once
  the new generator passes the same test suite.
- World Rule `slipperyRoads` (snow spaces) keeps working because regions are still tagged.
- **Save / online compatibility:** local save version bumps (`SAVE_VERSION` 1 → 2) so old
  saves are discarded cleanly; online rooms created before the deploy are not migrated (they
  are short-lived). Both documented in the release note.
- Balance: run `sim` before/after; mean game length, win-rate spread by class and KO counts
  must stay within ±10 % of the current baseline, else tune `balance.json`/`monsters.json`.

## 6. Map art

1. Monday exports the road graph as a guide image (1:1 with map pixels: road centreline,
   tile circles, region borders, landmark spots for the Castle, 3 town sites, the shop cart,
   Baron's stump fortress).
2. The image model paints **terrain and scenery only** for each region using the guide image
   plus `01_world_map` and `07_places` as references — no road, no tiles.
3. The game draws the **road** (cream fill, dark outline, readable on every ground) and the
   **round tiles** (7 kinds from `05_spaces`; King's Order tile reserved for M5c) at the graph
   coordinates. Towns show the level 1/2/3 building from `07_places` next to the tile.
4. Map size target ~ **3200×1800** map pixels, delivered as region tiles (WebP) so the phone
   only decodes what is on screen.
5. Ambient life is tween-only (bobbing bees, smoke puffs, lava glow) — cheap and optional.

## 7. Board screen and camera

- Camera zoom shows ~ **7–9 spaces across**; it eases to the active player at turn start and
  follows the token while moving; tiles are ≥ **48 px** on a 915×412 phone.
- **Whole-map button** (top-right): zooms out to fit the map with all tokens and owned-town
  flags visible; tap again or tap a space to return.
- **Tap/click any space** → small popup: tile icon, name, one-line effect (TH/EN), owner and
  value for towns. Keyboard: focusable and closable with Esc.
- Forks: animated arrows on each branch; choosing works by tapping the arrow or the tile.
- Turn clarity: active token gets a pulsing gold ring; its corner player card glows; a short
  "<name>'s turn" ribbon appears at turn start.
- Player colours are one system: card frame, token ring, and town flag use the same colour
  per seat (blue, green, purple, red/white — the hero signature colours, or seat colours when
  two players pick the same class).

## 8. Characters

- **Heroes** (from `02_heroes`): Sir Bram (knight, blue), Mint (thief, green), Opal (mage,
  purple), Sunny (cleric, white/red). **5 poses** each: idle, attack, hurt, happy, sad, plus a
  head portrait cut from the idle pose.
- **Monsters** (from `04_monsters`), 8 ids replacing the 6 current ones, two per region:
  meadow `jellyBun`, `mushroomBonk`; desert `cactusPunch`, `coinScorpion`; snow `yetiBunny`,
  `penguinKnight`; volcano `lavaImp`, `maskGoon`. **3 poses** each: idle, attack, hurt.
  Stats are derived from the current table by region tier (the two monsters of a region bracket
  the old monster(s) of that region), then checked by `sim` (§5 balance rule).
- Puppet motion (all tweens, speed-aware): idle breathe (scale-y 1.00↔1.03), hop with squash
  on land, attack lunge + tilt, hurt shake + white flash, happy jump, sad droop, KO spin-off.
- Expressions shown on events: robbed → sad, win → happy, prank hat overlay on the hurt pose.

## 9. UI re-skin

- Visual system from `14_palette_ui`: 10-colour palette (royal blue `#2E7FE0`, meadow green
  `#3BA84A`, sunset orange `#F07818`, coin gold `#F5C51C`, berry red `#D42B3A`, magic purple
  `#6C2EBE`, stone grey `#8E8E93`, princess pink `#F06EA9`, cream `#F5EEDC`, cocoa outline
  `#5C3317`), chunky rounded buttons (normal/pressed/disabled), parchment dialog with gold
  border, ribbon banner, heart HP bar, coin pill, 3D die button. Implemented as CSS + 9-slice
  images; a rounded display font with Thai coverage, self-hosted.
- Board HUD: 4 corner player cards (portrait, gold, hearts/HP, level, towns, card count —
  same fields for every seat), top-centre round ribbon "Round 3/12" + world rule chip with a
  tap-to-explain popup, bottom-centre die button, settings/language/sound tucked into one
  menu button (no loose TH/EN squares on the board).
- Battle: side view, region backdrop, fighters facing each other, HP bars with numbers, the
  three command cards (Attack, Strike, Secret) as large cards with icons **and** labels.
- Title, setup, online create/join/lobby/claim, perk/shop/reward dialogs and results: same
  system, no flow change. Title uses `13_title_screen` key art.

## 10. Asset pipeline

- Generation: Hermes `openai-codex` image backend (gpt-image) with the approved concept images
  attached as references every call; pose prompts on a flat `#bdbdbd` background, one pose per
  image or a fixed-cell row.
- Processing tool `tools/cartoonize/` (replaces `tools/pixelize/` for new art): background key
  → alpha, trim, baseline-align feet, fit to a fixed cell (hero/monster 512 px tall source,
  shipped at 256 px), pack into atlases, export **WebP** (+ PNG fallback only if a target
  browser lacks WebP). Deterministic for the same inputs.
- Budget: all new image assets ≤ **6 MB** total over the wire; first board render on a mid
  phone ≤ 2.5 s after load.
- Old pixel sprites and `tools/pixelize/` are removed at the end of M5a.

## 11. Testing and acceptance

Automated (CI, all must pass):
- **Engine:** map graph loop/fork/reachability tests; kind-assignment guarantees over 10,000
  seeds; seed determinism; existing rule tests unchanged.
- **Sim:** 200-game room sim with 0 crashes, 0 stuck games, 0 invariant alarms; balance
  metrics within the §5 band.
- **Assets:** every hero has 5 poses + portrait, every monster 3 poses; sizes match the
  manifest; transparency present; total size within budget.
- **E2E:** existing hot-seat, online, audio, i18n, layout, rotate suites pass; new checks at
  1280×720 and 915×412 in TH and EN: no overflow outside viewport/panels, tiles ≥ 48 px on
  phone, tap-a-space popup opens/closes, whole-map toggle, active-turn indicator present,
  fork arrows selectable.
- Existing gates unchanged: typecheck, lint, format, unit, worker, build, production build has
  no test hooks.

Owner checkpoints (Monday sends, owner approves before continuing):
1. All character poses on one sheet, before wiring into the game.
2. The painted map with road and tiles drawn on top.
3. A preview deploy link to play, before production.

Done when: CI green, the three checkpoints approved, deployed to production, live check (one
hot-seat game + one two-browser online game, no console errors) passes.

## 12. Risks

- **Character drift between poses** → always attach `02_heroes`/`04_monsters`; vision-check
  each pose against a written outfit checklist; regenerate on mismatch.
- **Painted terrain fights the road** (props on the road line) → guide image marks a keep-clear
  band; the game draws the road last; reject paintings with props in the band.
- **Phone performance** with a large painted map → tiled WebP, camera culling, one ambient
  layer; measured against the §10 budget.
- **Balance shift** from the fixed map and new monster table → §5 sim band, tune data only.
- **Scope creep** into story/rules → parked for M5b/M5c.
