# Dice Bandits — M4a Visual Polish — Design

Status: draft for owner review · Date: 2026-09-29 · Milestone: M4a (visuals). Audio is M4b.

## 1. Goal

Make the live game look as close as possible to the approved concept art
(`docs/concepts/style_16bit.png`, `characters.png`, `monsters.png`, `battle.png`) without
changing any game rule, so the prototype reads as a finished 16-bit party RPG on desktop and
on a phone in landscape. Fix the layout defects found on the live site at the same time.

Owner decisions (2026-09-29 brainstorm):

| # | Decision |
|---|---|
| 1 | Split M4: **M4a** = art + animation + juice + layout fixes; **M4b** = audio, later. |
| 2 | New art is **generated with the Codex image backend using the concept images as references**, then normalised to real pixel art (§4). |
| 3 | Board stays **procedurally generated**; each region gets concept-style ground art, rounded path tiles and decorations. No fixed map. |
| 4 | Battle screen follows `battle.png`: large facing fighters, region backdrop, framed HP bars top-left/top-right, **3 command cards** (the real picks) + small item cards, slash/spark/damage/coin effects. |
| 5 | Board screen: **full-screen board with HUD overlaid at the edges** (4 corner player cards, thin top banner that wraps, actions bottom-centre). |
| 6 | Animation set **A**: heroes idle/hop/attack/hurt, monsters idle/attack/hurt, 2–4 frames each; a few ambient loops (water, flags, lava). |

Approved samples (reference only, not shipped): `docs/concepts/m4/knight-sheet.png`,
`board-meadow.png`, `battle-screen.png`.

## 2. Scope

In scope:
- Hero sprites (4 classes: knight, thief, mage, cleric) and portraits, monster sprites (6:
  goldSlime, mushroomBandit, lanternGhost, mimic, rockGolem, shadowImp), with the frame set in §5.
- Board art for the 4 engine regions (`meadow`, `desert`, `snow`, `volcano`): ground/terrain
  layer, path road, space tiles for every `SpaceKind`, decoration props, 1 ambient loop each.
- Battle backdrops (one per region), battle layout, cards, HP bars, hit effects.
- HUD / DOM re-layout for board and battle, shared 9-slice pixel frame style.
- Live-site layout defects: truncated top event text, battle dice overflowing the panel,
  HP text rendering as `3E/38`, unreadable player-card stats, left-aligned action bar,
  unused screen width, dead vertical space.
- Title, setup, lobby and results screens re-skinned with the same frame style (no flow change).

Out of scope: audio (M4b); any rule, balance, board-generation or protocol change;
accounts (M3); new screens or modes; hand-drawn art commissions.

## 3. Constraints kept from M1/M2

- Engine, room package, worker and protocol are untouched. M4a is client + assets + tooling.
- Base resolution stays **640×360**, Phaser `pixelArt: true`, `roundPixels`, `Scale.FIT`.
  Integer display scaling only for sprites (no fractional scaling of pixel art).
- Locked 32-colour palette `tools/pixelize/palette.json`. It may be regenerated once from the
  concept images + new approved art; after that it is locked again and every shipped sprite
  must use only palette colours (tested, §8).
- All existing `data-testid`s keep their names and meaning (hot-seat and online E2E must pass
  unchanged). New elements get new test ids.
- Hot-seat and online share the same renderer; online-specific banners from M2 stay.
- i18n: every new visible string in `en.json` and `th.json`; Thai must fit (wrap, never cut).
- `?speed=0` keeps all animations instant; `prefers-reduced-motion` disables screen shake,
  flashes and ambient loops.
- No third-party CDN; fonts self-hosted as today.

## 4. Art pipeline

```
concept refs ──► image_gen (Codex, reference_image_urls) ──► raw sheet PNG (scratch)
     ──► tools/pixelize (extended): slice frames ► trim ► nearest downscale to grid
         ► palette quantise ► baseline align ► pad to fixed cell
     ──► apps/client/public/sprites/<name>.png + <name>.json (frame rects, anchor, fps)
```

- **Generation.** One prompt template per asset family, always attaching the matching concept
  image(s). Colours and outfits must match the concept sheet (knight: blue plate with gold
  trim, white plume, red cape, blue heater shield with gold lion; etc.). Raw outputs live in
  the scratch dir; only normalised results are committed. Approved raw sheets are copied to
  `docs/concepts/m4/` as reference.
- **`tools/pixelize` extension.** New `sheet` mode driven by `tools/pixelize/sheets.json`:
  input image, frame count / cells, target cell size, anchor (feet centre), fps per animation.
  Output: one spritesheet PNG + JSON atlas per sprite. Same determinism rule as M1: same input
  → byte-identical output (tested).
- **Target sizes (art pixels):** board hero token 32×32; battle hero 64×64; monster 64×64
  (rockGolem/mimic may use 80×80); portrait 32×32; board space tile 24×20 (+ icon 12×12);
  decoration props 16–32 px; region ground tile 32×32 (tileable); battle backdrop 640×360.
- **Review gate per family.** Each family (heroes, monsters, board region, backdrops, UI) is
  vision-checked (anatomy, frame consistency, facing, palette, no text) and shown to the owner
  as a contact sheet before it is wired in. A family that fails twice falls back to the M1
  pixelized crop + tween animation for that asset; that fallback is reported, not hidden.

## 5. Animation set

| Asset | Animations (frames) |
|---|---|
| Heroes ×4 | `idle` 2 · `hop` 2 · `attack` 3 · `hurt` 1 (+ tint flash) |
| Monsters ×6 | `idle` 2 · `attack` 2–3 · `hurt` 1 |
| Board | water shimmer (meadow), flag wave (castle), lava glow (volcano), snow drift (snow): 2–4 frames |
| Effects | slash arc 3 · impact spark 3 · coin 4 (spin) · dust puff 3 · level-up sparkle 3 |

Frames face right; left-facing is a horizontal flip. Effects are drawn in-palette (no soft
gradients). Timing lives in the atlas JSON so tuning does not need code changes.

## 6. Screens

### 6.1 Board (full screen + edge HUD)
- Phaser canvas fills the game area; the board is laid out from engine `Space.x/y` as today,
  scaled to fill 640×360 with margins for the HUD.
- Layers: region ground (tileable, per region, soft dithered border between regions) → cream
  road following the path edges → rounded space tiles (colour + icon by `SpaceKind`; town tiles
  show owner colour) → decorations placed deterministically from the board seed, never on or
  touching the road → ambient loops → tokens (idle loop, `hop` per space with dust puff).
- Space colours/icons: castle white+crest, town green+house, shop blue+bag, chest blue+chest,
  monster red+swords, event yellow+`?`, trap purple+skull (final table fixed in the plan from the
  approved board contact sheet).
- HUD (DOM overlay, 9-slice navy frame with gold border):
  - 4 player cards in the 4 corners, class colour accent, 32 px portrait, name, gold, level,
    towns, HP bar with track, status badges (takeover, leader crown). Min 12 px text on a
    915×412 phone; nothing truncated.
  - Top-centre thin banner: round, world rule, latest event text. Wraps to 2 lines max, then
    the full text is available by tap/hover (no ellipsis-only text).
  - Bottom-centre action tray: centred buttons, same frame style; disabled state visible.
  - Existing dialogs (perk, shop, reward) re-skinned in the frame style.

### 6.2 Battle
- Region backdrop (from the space's region) with a ground line; attacker left facing right,
  defender right facing left (flip), battle sprites at 64 px art size shown at integer scale.
- Framed HP bars top-left and top-right: name, bar with dark empty track, `hp/max` in the pixel
  number font with enough size and contrast (fixes `3E/38`).
- Bottom-centre card row (DOM, keeps test ids `pick-*`, `action-useItem-*`): 3 pick cards with
  icon + translated label, selected glow + cursor; item cards smaller to the right. Cards are
  disabled while awaiting a view (M2 hotfix behaviour kept).
- Dice pools are shown inside a reserved row between the fighters and the cards, clipped to the
  panel (fixes overflow).
- Hidden-pick state keeps the M2 behaviour: `online-opponent-picked` note, secret card flip.
- Hit sequence: attack frames → slash arc → impact spark + hurt frame + flash → damage number
  pops and floats → shake (skipped under reduced motion). Theft → coin burst.

### 6.3 Other screens
Title, setup, online create/join/lobby/claim, results: same frame style, pixel title logo,
class portraits from the new art. Layout and flows unchanged.

## 7. Code structure (client only)

- `apps/client/src/art/` (new): atlas loader + typed animation keys, region/space-kind visual
  tables, decoration placement (pure, seeded, unit-tested).
- `BootScene` loads atlases from `public/sprites/*.json`; missing asset → fallback to the M1
  sprite with a console warning (never a crash).
- `BoardScene` / `BattleScene` split drawing into small layer modules; event playback keeps its
  current contract (awaitable, speed-aware) so hot-seat and online controllers are unchanged.
- `ui/hud.ts`, `ui/battleUi.ts`, `ui/styles.css`: new layout; test ids preserved.

## 8. Testing and acceptance

Automated (CI):
- **Asset tests:** every committed sheet has an atlas; frame sizes match the manifest; only
  palette colours + transparency; each hero/monster has all required animations; pixelize
  `sheet` mode is deterministic.
- **Unit:** decoration placement never overlaps road/tiles and is seed-stable; region/kind
  visual tables cover every `Region` and `SpaceKind`.
- **E2E (existing suite unchanged + new):** full hot-seat game and online journey still pass;
  new layout checks on desktop 1280×720 and mobile 915×412, TH and EN: no element overflows the
  viewport or its panel (bounding-box assertions), top event text not truncated, HP text
  matches state, action tray centred, all four player cards visible and ≥12 px text.
- Existing gates unchanged: typecheck, lint, format, unit, worker, both sims, build, e2e;
  production build contains no test hooks.

Manual/visual (before merge):
- Screenshot set (board each region, battle each region, dialogs, lobby, results) × desktop and
  mobile landscape × TH/EN, vision-checked and shown to the owner next to the concept images.
- Live check after deploy: one hot-seat game and one two-browser online game on the production
  URL, no console errors.

Performance budget: total new sprite PNGs ≤ 1.5 MB; first board render on a mid phone
≤ 2 s after load; steady 60 fps on desktop, no frame drops below 30 fps on the mobile
emulation profile during a battle.

Done when: all automated gates green in CI, owner approves the screenshot set, deployed, live
check passes.

## 9. Risks

- **Frame consistency of generated art** (outfit drifts between frames) → generate a whole
  sheet per call, normalise, vision-check; fallback per §4.
- **Palette lock too strict** for backdrops → backdrops may use a documented second 32-colour
  palette; sprites stay on the main palette.
- **Readability on small phones** → bounding-box and min-font E2E assertions at 915×412.
- **Scope creep** into rules or audio → out of scope; parked for M4b/M3.
