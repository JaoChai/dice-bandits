# Cartoonize asset pipeline

`cartoonize.ts` converts concept art sheets into shipped game atlases under
`apps/client/public/art/`: it keys the flat `#bdbdbd` background to transparency
where it is connected to the sheet border (per-channel tolerance 28, flood fill
from the edges, 1-px feather) — small enclosed key-coloured holes and near-key
highlights inside the character survive —, keys deep enclosed pockets like the
background (see below), trims to the alpha bounding box, scales the pose to
`shipHeight` with Lanczos3 (never up), pads it bottom-centre into its cell,
packs cells row-major, and encodes WebP at quality 82, effort 6. Encoding is
deterministic: the same input produces byte-identical output.

## Deep enclosed pockets

Background can be enclosed inside a figure — ring openings, claw gaps,
between-arm areas. Such a pocket reads as a hole in the sprite, so it gets the
same key treatment as border-connected background, but only when ALL three
rules hold (measured over the whole keyable component in the source cell):

| Rule | Threshold | Survives (stays opaque) |
| --- | --- | --- |
| area ≥ `POCKET_MIN_AREA` | 150 px | small highlights and thin grey fills |
| mean chroma ≤ `POCKET_MAX_CHROMA` | 4.0 | tinted paint (max − min of RGB) |
| mean distance ≤ `POCKET_MAX_DISTANCE` | 10 | paint darker/lighter than the key |

Mean per-pixel chroma and mean distance-to-key over the component separate real
background (near-grey, key-coloured) from painted surfaces that happen to be
keyable (silver armour, dim neutrals). The table below shows every enclosed
component on the shipped pose sheets (raw resolution, per cell) and how the
rules classify it.

<!-- POCKET-TABLE:START -->

| Sheet | Cell | Area (px) | Mean chroma | Mean distance | Decision |
| --- | --- | --- | --- | --- | --- |
| hero-cleric | idle | 158 | 3.4 | 9.4 | keyed |
| hero-cleric | attack | 975 | 2.6 | 8.2 | keyed |
| hero-cleric | attack | 309 | 3.5 | 7.9 | keyed |
| monster-jellyBun | attack | 621 | 2.9 | 8.8 | keyed |
| monster-mushroomBonk | idle | 274 | 2.9 | 8.7 | keyed |
| monster-mushroomBonk | attack | 745 | 2.9 | 7.6 | keyed |
| monster-mushroomBonk | hurt | 879 | 1.6 | 8.8 | keyed |
| monster-coinScorpion | hurt | 6791 | 2.7 | 5.1 | keyed |
| monster-yetiBunny | attack | 3096 | 2.5 | 4.4 | keyed |
| buildings | shopCart | 661 | 2.5 | 9.1 | keyed |
| ui | btnDisabled | 22851 | 12.7 | 15.8 | kept (chroma + distance) |
| icons | die | 7112 | 25.6 | 24.6 | kept (chroma + distance) |
| icons | dieFace5 | 4571 | 22.4 | 18.6 | kept (chroma + distance) |
| icons | dieFace1 | 4522 | 22.6 | 17.4 | kept (chroma + distance) |
| icons | dieFace4 | 4508 | 23.2 | 18.4 | kept (chroma + distance) |
| icons | dieFace2 | 4477 | 23.0 | 17.8 | kept (chroma + distance) |
| icons | dieFace6 | 4404 | 23.2 | 18.5 | kept (chroma + distance) |
| icons | dieFace3 | 4367 | 23.4 | 18.7 | kept (chroma + distance) |
| tiles | trap | 2749 | 7.1 | 16.0 | kept (chroma + distance) |
| hero-knight | portrait | 1853 | 8.5 | 7.8 | kept (chroma) |
| icons | skull | 1643 | 28.9 | 21.9 | kept (chroma + distance) |
| hero-knight | attack | 1377 | 6.8 | 8.1 | kept (chroma) |
| hero-knight | hurt | 1242 | 9.2 | 10.7 | kept (chroma + distance) |
| hero-knight | attack | 1110 | 9.8 | 11.5 | kept (chroma + distance) |
| tiles | castle | 1103 | 29.3 | 20.7 | kept (chroma + distance) |
| hero-knight | hurt | 1075 | 9.1 | 9.5 | kept (chroma) |
| hero-knight | portrait | 1000 | 9.9 | 10.8 | kept (chroma + distance) |

Measured by scanning every cell of every pose/grid sheet with the exact
`chromaKey` logic at raw resolution: 14 408 enclosed keyable components in
total. The table lists all 10 keyed pockets and the 17 largest kept
components (≥ 1 000 px); the remaining kept components (286 between 50 and
1 000 px, 14 095 below 50 px) stay opaque. The largest kept interiors — the
disabled-button plate (22 851 px) and the die faces (4 400–7 100 px) — are
kept purely by the chroma/distance rules: an area-only rule would punch
holes into them. Running the full pipeline with and without the pocket rule
produces byte-identical WebP on every sheet without keyed pockets; the six
sheets listed above change only inside the keyed pockets (atlas frame
geometry is unchanged everywhere).

<!-- POCKET-TABLE:END -->

## Manifest

Each entry in `sheets.json`:

```json
{
  "name": "hero-knight",
  "input": "raw/hero-knight.png",
  "kind": "pose",
  "cell": [256, 256],
  "shipHeight": 220,
  "poses": ["idle", "attack", "hurt", "happy", "sad", "portrait"],
  "out": "hero-knight"
}
```

- `kind: "pose"` — poses are equal columns in one row, in `poses` order.
- `kind: "grid"` — `grid: [cols, rows]` slices the sheet row-major; `poses`
  lists the frame names in that order.
- `kind: "map"` — cuts the input into `cell`-sized tiles written to
  `<out>/r{row}c{col}.webp` (no keying, no atlas JSON).
- `input` is relative to this tool directory; `out` is the base name written
  under `apps/client/public/art/`.

Each pose/grid sheet writes `<out>.webp` plus `<out>.json`:

```json
{
  "frames": {
    "idle": { "x": 32, "y": 16, "w": 192, "h": 220, "anchorX": 96, "anchorY": 220 }
  },
  "image": "hero-knight.webp"
}
```

Frames are the trimmed content rectangle inside the sheet; `anchorX` is the
content centre and `anchorY` the content height, so the anchor sits on the
bottom-centre baseline of the pose.

## Usage

```sh
npm run cartoonize -w @dice-bandits/cartoonize -- hero-knight
npm run cartoonize -w @dice-bandits/cartoonize -- --all
```

## Tests and budget

`npm test -w @dice-bandits/cartoonize` runs the pipeline against generated
fixtures (`fixtures/*.png` are created and removed by the test). The shipped
art size is capped by `scripts/check-art-budget.mjs` (default 6 000 000 bytes
of `.webp` + `.png` under `apps/client/public/art/`, override with
`ART_BUDGET_BYTES`); the client test script runs it alongside the sprite budget
until the pixel-art cleanup (plan Task 11) removes the old pipeline.
