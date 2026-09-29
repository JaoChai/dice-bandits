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
