# Task 9 report — Pixelize pipeline and prototype sprites

## Changes
- Added the `tools/pixelize` npm workspace, pinned `sharp@0.35.4`, `tsx@4.23.15`, and `vitest@5.0.2`, and updated the root lockfile so root `npm test` includes the pixelize suite.
- Implemented the deterministic Sharp/TypeScript pipeline: crop, edge-connected gray flood removal (tolerance 18), premultiplied-alpha area-average pre-shrink, nearest-neighbor scaling, palette mapping, and binary alpha output. Added the `--extract-palette` k-means CLI path and froze its 32-color output in `palette.json`.
- Measured character and monster foreground bounds from connected components in the concept sheets and recorded padded source rectangles in `crops.json`; terrain rectangles are 32×32 visual samples from `style_16bit.png`.
- Authored the 12 base-32 icon matrices, assembled `icons.png`/`icons.json`, added CLI documentation, and generated the sprites under `apps/client/public/sprites/`. Did not add an `apps/client/package.json` or workspace.
- Added tests for exact output names/dimensions, palette-only opaque RGB values, alpha restricted to 0/255, icon frames, and byte-identical repeated runs.

## RED → GREEN
- RED: `npm test -w @dice-bandits/pixelize` failed as expected before implementation because `pixelize.ts` was absent (`Cannot find module './pixelize.js'`; 0 tests executed).
- GREEN: pixelize workspace suite passes 3/3 tests. Full root verification passes: typecheck, lint, format check, and `npm test` (engine 113/113 plus pixelize 3/3).

## Generated sprites
- 32×32: `hero-knight.png`, `hero-thief.png`, `hero-mage.png`, `hero-cleric.png`.
- 48×48: `hero-knight-portrait.png`, `hero-thief-portrait.png`, `hero-mage-portrait.png`, `hero-cleric-portrait.png`.
- 32×32: `monster-goldSlime.png`, `monster-mushroomBandit.png`, `monster-lanternGhost.png`, `monster-shadowImp.png`.
- 48×48: `monster-mimic.png`, `monster-rockGolem.png`.
- 32×32: `tiles-meadow.png`, `tiles-desert.png`, `tiles-snow.png`, `tiles-volcano.png`.
- 64×48 icon atlas: `icons.png` (12 16×16 frames, mapped by `icons.json`).
- Total: 19 PNG files plus `icons.json`.

## Contact-sheet review
- `tools/pixelize/contact-sheet.png` is generated and gitignored.
- Visual inspection found all character/monster crops contained and recognizable, tiles differentiated, icon atlas present, and no obvious transparency artifacts. The unused final grid cell is unobtrusive.
- Labels remain small at full-sheet scale; icons are also small in the atlas preview by design. Shadow imp has low internal contrast from the source concept, but the silhouette and eyes remain discernible on the neutral gray review panels.

## Judgment calls and concerns
- Used character-sheet emote busts for 48×48 class portraits; the top-row figures supply the 32×32 hero sprites.
- Kept mimic and rock golem at 48×48 as specified; all other monsters are 32×32.
- Preserved the listed engine IDs verbatim in monster filenames. Terrain is sampled from the board-map concept because there is no separate regional tile sheet.
- These are prototype-scale reductions of detailed AI concept art, so small source details inevitably collapse at 32×32; final art may need artist-authored revisions.

## Fix: visual review
- Redrew all 12 icon matrices as conventional 16×16 silhouettes using the fixed palette: coin, diagonal silver sword, question mark, wood-and-gold chest, red heart, bone skull, striped shop stall, stone castle, multi-house town, steel bear trap, jeweled crown, and standalone wizard hat. Added dark outlines and kept the art inset from cell edges; removed eye-like details from non-creature icons.
- Re-picked the volcano source crop to a dark-rock/lava area, then replaced the contaminated source crop output with a deterministic palette-only basalt tile and branching orange/red fissures after visual inspection showed the source reduction did not produce a clear lava tile. The generated tile contains no blue-dominant colors.
- Added unconditional regressions for terrain color families, icon inset/opaque pixel counts, and a red-dominant heart. Pixelize suite passes 6/6; full verification passes: `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm test` (engine 113/113, pixelize 6/6).
- Inspected 10× nearest-neighbor previews at `/home/jaochai/.hermes/profiles/hermes-dev/cache/scratch/icons_x10.png` and `/home/jaochai/.hermes/profiles/hermes-dev/cache/scratch/volcano_x10.png`. Icons read conventionally; the town, trap and sword are simplified but clear. Volcano reads as dark basalt with branching lava cracks and no blue water/ice.
- Regenerated `apps/client/public/sprites/` and `tools/pixelize/contact-sheet.png` from the updated pipeline.
