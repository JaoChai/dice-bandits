# Cartoonize asset pipeline

`cartoonize.ts` converts concept art sheets into shipped game atlases under
`apps/client/public/art/`: it keys the flat `#bdbdbd` background to transparency
where it is connected to the sheet border (per-channel tolerance 28, flood fill
from the edges, 1-px feather) — enclosed key-coloured holes and near-key
highlights inside the character survive —, trims to the alpha bounding box,
scales the pose to `shipHeight` with Lanczos3 (never up), pads it bottom-centre
into its cell, packs cells row-major, and encodes WebP at quality 82, effort 6.
Encoding is deterministic: the same input produces byte-identical output.

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
