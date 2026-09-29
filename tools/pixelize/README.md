# Pixelize prototype art

`pixelize.ts` crops concept-art reference sheets into small PNG sprites, removes connected flat-gray margins (RGB tolerance 18), area-shrinks each cutout to at most 2× its target size, downsamples with nearest-neighbor, locks every opaque pixel to the frozen 32-color palette, and thresholds alpha to 0/255.

From the repository root, generate the client assets with:

```sh
npx tsx tools/pixelize/pixelize.ts --config tools/pixelize/crops.json --out apps/client/public/sprites
```

The command also writes `tools/pixelize/contact-sheet.png` for visual review. That generated sheet is gitignored. Individual source rectangles are recorded in `crops.json`; character and monster bounds were measured from connected non-background components in the supplied sheets and padded slightly to preserve outlines. Terrain rectangles are small visual samples from the board-map concept image.

The palette is frozen in `palette.json`. To regenerate it intentionally, run:

```sh
npx tsx tools/pixelize/pixelize.ts --extract-palette docs/concepts/style_16bit.png tools/pixelize/palette.json
```

This downsamples the style map and runs deterministic 32-cluster k-means. Review the resulting palette before committing; normal sprite generation never changes it.

`icons/*.txt` are 16×16 matrices using one base-32 digit per pixel (`0` is transparent; `1` through `v` select palette entries 1–31). `icons.json` maps each icon name to its top-left atlas frame in `icons.png`.

Run `npm test -w @dice-bandits/pixelize` for pipeline tests, or `npm test` at the repo root to include them in the full workspace suite.

## Spritesheet mode

Add one entry per sheet to `sheets.json`. `source` is relative to that manifest; frames are equal-width columns in one row. The configured cell is the output art-pixel size. `palette` defaults to `main`; use `backdrop` only for scenery. Animations use inclusive frame indices (`from`/`to`), fps, and loop. `anchor` defaults to `feet`; `center` anchors at the cell center.

```json
{
  "sheets": [
    {
      "name": "hero-knight",
      "source": "raw/hero-knight.png",
      "frames": 8,
      "cell": { "width": 64, "height": 64 },
      "animations": {
        "idle": { "from": 0, "to": 1, "fps": 6, "loop": true },
        "attack": { "from": 4, "to": 6, "fps": 10, "loop": false }
      }
    }
  ]
}
```

Generate all configured sheets, or select one by name:

```sh
npx tsx tools/pixelize/pixelize.ts --sheets tools/pixelize/sheets.json --out apps/client/public/sprites
npx tsx tools/pixelize/pixelize.ts --sheets tools/pixelize/sheets.json --out apps/client/public/sprites --only hero-knight
```

Each sheet produces `<name>.png` (frames packed left-to-right) and `<name>.json` with cell rectangles, anchor and expanded animation frame lists. The shared trimmed bounds preserve frame motion; feet-anchored output is baseline-aligned. `assertPaletteOnly(pngPath, palette)` validates opaque palette pixels and binary alpha, and throws with the first offending pixel's `(x, y)` coordinate; `palette` is `'main'` or `'backdrop'`. It is exported from `pixelize.ts` for asset tests.

### Grid-grouped sheets (`split: "grid"`)

Battle sheets rarely align poses to equal columns: lunging strikes cross column boundaries and poses contain detached islands (floating coins, star companions, eyes). With `"split": "grid"`, connected components are unioned by nearest expected column centre. For unevenly spaced poses, provide `sourceRanges` as one inclusive `[left,right]` source-x interval per frame, covering the full source width without gaps or overlaps; component centres are assigned to those measured intervals. `noiseFloor` (pixels) drops background specks; generation throws if any pose is empty. Grid frames share one scale across the whole sheet so wide poses do not shrink their body relative to idle. Set `scaleBy: "animation"` for an FX sheet whose independent animation families each need their own shared scale. Feet anchoring still places each monster on the same baseline.

The approved `fx.png` has 16 occupied x-runs whose widths/gaps are irregular (first `24–100`, last `2031–2151`), so its explicit `sourceRanges` partition prevents the tail of spark frame 5 from entering coin frame 6. The coin's four poses share scale, preserving full/three-quarter/edge/three-quarter shape and height.

Flood keying also leaves a semi-blended ring of background at sprite edges, so after the flood any still-opaque boundary pixel near the key colour is flooded away too (limit 24, or 34 when the key is a mid-grey). Interior greys are never touched — only pixels on the transparency boundary.

### Whole-image sheets (`fullFrame: true`)

Backdrops are opaque scenes whose sky may share the corner colour, so keying would eat the sky. `"fullFrame": true` skips keying and trimming entirely and downscales the whole image to the configured cell with Lanczos. Use `palette: "backdrop"` for scenery; its 32 colours never include the pure key, so quantisation cannot paint transparency.

### Battle art reference

Approved raw battle sheets live in `docs/concepts/m4/battle/`. All six monster sheets share one pose order: **frame 0–1 idle, 2 attack wind-up, 3 attack strike, 4 recovery, 5 hurt** — mapped to `idle` (0–1), `attack` (2–4), `hurt` (5). The `fx` sheet is fixed as **slash 0–2, spark 3–5, coin (spin) 6–9, dust 10–12, sparkle 13–15**. The `cards` sheet is fixed as **0 attack (sword), 1 strike (lightning), 2 secret (?), 3 defend (shield), 4 counter (sword + parry arc), 5 item frame (blank)**.
