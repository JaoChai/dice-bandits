import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp, { type OverlayOptions } from 'sharp';
import { cartoonizeAll, cartoonizeSheet, loadManifest, type ManifestEntry } from './cartoonize.js';

const run = promisify(execFile);
const root = new URL('../../', import.meta.url).pathname;
const toolDir = join(root, 'tools/cartoonize');
const fixtures = join(toolDir, 'fixtures');
let out: string;

/**
 * Builds a pose-sheet fixture: `count` blobs in one row on a #bdbdbd background.
 * Pose `p` is a solid ellipse of height `cell + 10*p` px — different heights prove
 * per-frame baseline alignment and that frame height ≤ shipHeight.
 */
async function writePoseFixture(path: string): Promise<void> {
  const count = 3;
  const width = 256;
  const height = 256;
  const cell = 64;
  const frameWidth = Math.floor(width / count);
  const composites: OverlayOptions[] = [];
  for (let pose = 0; pose < count; pose++) {
    const blobHeight = cell + 10 * pose;
    const blobWidth = Math.floor(cell * 0.6);
    const svg = Buffer.from(
      `<svg width="${frameWidth}" height="${height}">` +
        `<ellipse cx="${frameWidth / 2}" cy="${height - blobHeight / 2}" ` +
        `rx="${blobWidth / 2}" ry="${blobHeight / 2}" fill="#333333"/></svg>`,
    );
    composites.push({ input: svg, left: pose * frameWidth, top: 0 });
  }
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0xbd, g: 0xbd, b: 0xbd, alpha: 255 },
    },
  })
    .composite(composites)
    .png()
    .toFile(path);
}

/** Grid fixture: 4×2 cells of distinct solid rectangles on the key colour. */
async function writeGridFixture(path: string): Promise<void> {
  const cw = 64;
  const ch = 64;
  const composites: OverlayOptions[] = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      // Shades 16..51: every one at least 138 away from the key 0xbd (189),
      // i.e. far outside the 28 tolerance, and distinct per cell.
      const shade = 16 + (row * 4 + col) * 5;
      const svg = Buffer.from(
        `<svg width="${cw - 8}" height="${ch - 8}"><rect width="${cw - 8}" height="${ch - 8}" ` +
          `fill="rgb(${shade},${shade},${shade})"/></svg>`,
      );
      composites.push({ input: svg, left: col * cw + 4, top: row * ch + 4 });
    }
  }
  await sharp({
    create: {
      width: 4 * cw,
      height: 2 * ch,
      channels: 4,
      background: { r: 0xbd, g: 0xbd, b: 0xbd, alpha: 255 },
    },
  })
    .composite(composites)
    .png()
    .toFile(path);
}

/** Map fixture: opaque 3200×1800 image with distinct colour bands per tile row. */
async function writeMapFixture(path: string): Promise<void> {
  const composites: OverlayOptions[] = [];
  for (let row = 0; row < 3; row++) {
    const shade = 60 + row * 60;
    const svg = Buffer.from(
      `<svg width="3200" height="600"><rect width="3200" height="600" fill="rgb(${shade},${shade},${shade})"/></svg>`,
    );
    composites.push({ input: svg, left: 0, top: row * 600 });
  }
  await sharp({
    create: {
      width: 3200,
      height: 1800,
      channels: 4,
      background: { r: 90, g: 90, b: 90, alpha: 255 },
    },
  })
    .composite(composites)
    .png()
    .toFile(path);
}

/**
 * Enclosed-key fixture: a #bdbdbd top strip (border-connected background) over
 * a full-width dark #333333 slab containing a SMALL enclosed #bdbdbd hole and
 * a #b4bdc8 "silver" rectangle — key-adjacent pixels the key must NOT turn
 * transparent. All rects are integer-aligned, so rasterization is exact and
 * the keyed+trimmed output frame is fully predictable: the strip is keyed
 * away, the slab spans the full width, so the frame is the slab exactly
 * (256x240) and sheet coords are source coords shifted up by 16.
 *
 * The hole is exact-key (#bdbdbd: chroma 0, distance 0 — the neutral pocket
 * rules never exclude it), so it is sized BELOW POCKET_MIN_AREA (12x12 =
 * 144 px < 150) to prove the area rule keeps small key-coloured pockets
 * opaque. The silver rect (24x8 = 192 px, above the area threshold) has
 * chroma 20 > POCKET_MAX_CHROMA, proving the chroma rule keeps neutrally
 * tinted paint opaque.
 */
async function writeHoleFixture(path: string): Promise<void> {
  const size = 256;
  const composites: OverlayOptions[] = [
    {
      input: Buffer.from(
        `<svg width="${size}" height="${size - 16}"><rect width="${size}" height="${size - 16}" fill="#333333"/></svg>`,
      ),
      left: 0,
      top: 16,
    },
    {
      input: Buffer.from(
        `<svg width="12" height="12"><rect width="12" height="12" fill="#bdbdbd"/></svg>`,
      ),
      left: 48,
      top: 64,
    },
    {
      input: Buffer.from(
        `<svg width="24" height="8"><rect width="24" height="8" fill="#b4bdc8"/></svg>`,
      ),
      left: 24,
      top: 232,
    },
  ];
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0xbd, g: 0xbd, b: 0xbd, alpha: 255 },
    },
  })
    .composite(composites)
    .png()
    .toFile(path);
}

/**
 * Pocket fixture: a #bdbdbd top strip (border-connected background) over a
 * full-width dark #333333 slab (y=32..128) containing enclosed key-coloured
 * pockets on each side of the three deep-pocket rules:
 *
 *   RING  (all rules hold -> keyed): slab-coloured ring (outer r 24, inner
 *         r 12) around an exact-key #bdbdbd centre (~452 px >= POCKET_MIN_AREA,
 *         chroma 0, distance 0) — a ring opening / claw gap; becomes a hole.
 *   DIM   (distance rule saves it): flat #a6a6a6 rect x84..108 y60..68
 *         (24x8 = 192 px >= POCKET_MIN_AREA, chroma 0 <= POCKET_MAX_CHROMA,
 *         mean distance 23 > POCKET_MAX_DISTANCE) — darker neutral paint;
 *         stays opaque.
 *   SPECK (area rule saves it): exact-key #bdbdbd 6x4 = 24 px < 150 at
 *         (40,40) — a tiny highlight; stays opaque.
 *
 * The strip keys away as before, so the frame is the slab (128x96 at sheet
 * y=32) and sheet coords equal source coords.
 */
async function writePocketFixture(path: string): Promise<void> {
  const size = 128;
  const svg = Buffer.from(
    `<svg width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" fill="#bdbdbd"/>` +
      `<rect width="${size}" height="96" y="32" fill="#333333"/>` +
      `<circle cx="32" cy="80" r="24" fill="#333333"/>` +
      `<circle cx="32" cy="80" r="12" fill="#bdbdbd"/>` +
      `<rect x="84" y="60" width="24" height="8" fill="#a6a6a6"/>` +
      `<rect x="40" y="40" width="6" height="4" fill="#bdbdbd"/>` +
    `</svg>`,
  );
  await sharp(svg).png().toFile(path);
}

async function pixels(path: string): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function alphaAt(image: { data: Buffer; width: number }, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3] ?? 0;
}

beforeAll(async () => {
  await mkdir(fixtures, { recursive: true });
  await writePoseFixture(join(fixtures, 'poses-fixture.png'));
  await writeGridFixture(join(fixtures, 'grid-fixture.png'));
  await writeMapFixture(join(fixtures, 'map-fixture.png'));
  await writeHoleFixture(join(fixtures, 'hole-fixture.png'));
  await writePocketFixture(join(fixtures, 'pocket-fixture.png'));
  // The shipped manifest must parse; it lists entries once the art task lands
  // (plan Task 4), so do not assert emptiness here.
  await loadManifest();
});

afterAll(async () => {
  await rm(join(fixtures, 'poses-fixture.png'), { force: true });
  await rm(join(fixtures, 'grid-fixture.png'), { force: true });
  await rm(join(fixtures, 'map-fixture.png'), { force: true });
  await rm(join(fixtures, 'hole-fixture.png'), { force: true });
  await rm(join(fixtures, 'pocket-fixture.png'), { force: true });
});

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'dice-bandits-cartoonize-'));
});

afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

const poseEntry: ManifestEntry = {
  name: 'fixture-pose',
  input: 'fixtures/poses-fixture.png',
  kind: 'pose',
  cell: [64, 64],
  shipHeight: 48,
  poses: ['idle', 'attack', 'hurt'],
  out: 'fixture-pose',
};

const gridEntry: ManifestEntry = {
  name: 'fixture-grid',
  input: 'fixtures/grid-fixture.png',
  kind: 'grid',
  cell: [64, 64],
  shipHeight: 64,
  grid: [4, 2],
  poses: ['castle', 'town', 'shop', 'chest', 'monster', 'event', 'trap', 'none'],
  out: 'fixture-grid',
};

describe('cartoonize pose mode', () => {
  it('keys the flat background: alpha 0 at all four corners, >0 at each pose centre', async () => {
    const atlas = (await cartoonizeSheet(poseEntry, toolDir, out))!;
    expect(atlas.image).toBe('fixture-pose.webp');
    const sheet = await pixels(join(out, 'fixture-pose.webp'));
    for (const pose of ['idle', 'attack', 'hurt'] as const) {
      const frame = atlas.frames[pose]!;
      expect(alphaAt(sheet, frame.x, frame.y)).toBe(0);
      expect(alphaAt(sheet, frame.x + frame.w - 1, frame.y)).toBe(0);
      expect(alphaAt(sheet, frame.x, frame.y + frame.h - 1)).toBe(0);
      expect(alphaAt(sheet, frame.x + frame.w - 1, frame.y + frame.h - 1)).toBe(0);
      expect(
        alphaAt(sheet, frame.x + Math.floor(frame.w / 2), frame.y + Math.floor(frame.h / 2)),
      ).toBeGreaterThan(0);
    }
  });

  it('baseline-aligns every frame: opaque bottom row at anchorY, anchorX at centre', async () => {
    const atlas = (await cartoonizeSheet(poseEntry, toolDir, out))!;
    const sheet = await pixels(join(out, 'fixture-pose.webp'));
    for (const pose of ['idle', 'attack', 'hurt'] as const) {
      const frame = atlas.frames[pose]!;
      const bottomRow = frame.y + frame.h - 1;
      let hasOpaque = false;
      for (let x = 0; x < frame.w; x++) {
        if (alphaAt(sheet, frame.x + x, bottomRow) > 0) hasOpaque = true;
      }
      expect(hasOpaque, `pose ${pose} has opaque pixels on its bottom row`).toBe(true);
      expect(frame.anchorY).toBe(frame.h);
      expect(frame.anchorX).toBe(Math.floor(frame.w / 2));
    }
  });

  it('scales frames to at most shipHeight', async () => {
    const atlas = (await cartoonizeSheet(poseEntry, toolDir, out))!;
    for (const pose of ['idle', 'attack', 'hurt'] as const) {
      expect(atlas.frames[pose]!.h).toBeLessThanOrEqual(poseEntry.shipHeight);
    }
  });

  it('applies one scale per sheet: relative pose heights are preserved', async () => {
    // Ground truth: measure each pose's keyed alpha bounding box in the source,
    // then require the same ratios after the sheet's single scale factor.
    const { data } = await sharp(join(fixtures, 'poses-fixture.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const key = { r: 0xbd, g: 0xbd, b: 0xbd };
    const frameWidth = Math.floor(256 / 3);
    const sourceHeights = [0, 1, 2].map((pose) => {
      let top = 256;
      for (let y = 0; y < 256 && top === 256; y++) {
        for (let x = 0; x < frameWidth; x++) {
          const o = (y * 256 + pose * frameWidth + x) * 4;
          const distance = Math.max(
            Math.abs(data[o]! - key.r),
            Math.abs(data[o + 1]! - key.g),
            Math.abs(data[o + 2]! - key.b),
          );
          if (distance > 28) {
            top = y;
            break;
          }
        }
      }
      return 256 - top;
    });
    const atlas = (await cartoonizeSheet(poseEntry, toolDir, out))!;
    const heights = ['idle', 'attack', 'hurt'].map((p) => atlas.frames[p]!.h);
    // One scale per sheet: identical ratio for every pose pair (±1 px slack
    // for integer rounding), the tallest pose landing on shipHeight.
    const scale = heights[2]! / sourceHeights[2]!;
    for (let i = 0; i < 3; i++) {
      expect(
        Math.abs(heights[i]! / scale - sourceHeights[i]!),
        `pose ${i}: ${heights[i]!} / ${scale} vs source ${sourceHeights[i]!}`,
      ).toBeLessThanOrEqual(1);
    }
    expect(heights[2]).toBe(poseEntry.shipHeight);
  });

  it('feathers the key edge: some content-edge pixels have partial alpha', async () => {
    // shipHeight 64 ≥ the tallest pose (64 px) → no scaling, edge alpha untouched.
    const unscaledEntry: ManifestEntry = { ...poseEntry, shipHeight: 64 };
    const atlas = (await cartoonizeSheet(unscaledEntry, toolDir, out))!;
    const sheet = await pixels(join(out, 'fixture-pose.webp'));
    for (const pose of ['idle', 'attack', 'hurt'] as const) {
      const frame = atlas.frames[pose]!;
      const partial: number[] = [];
      for (let y = frame.y; y < frame.y + frame.h; y++) {
        for (let x = frame.x; x < frame.x + frame.w; x++) {
          const a = alphaAt(sheet, x, y);
          if (a > 0 && a < 255) partial.push(a);
        }
      }
      expect(
        partial.length,
        `pose ${pose} has ${partial.length} partial-alpha edge pixels`,
      ).toBeGreaterThan(0);
    }
  });

  it('keys only border-connected background: enclosed #bdbdbd and near-key pixels stay opaque', async () => {
    // Regression for the Task 4 incident: the key must flood from the sheet
    // border. A character with SMALL enclosed key-coloured areas (holes,
    // highlights) must keep them opaque: the 12x12 hole stays below
    // POCKET_MIN_AREA (area rule), and the silver rect exceeds
    // POCKET_MAX_CHROMA (chroma rule).
    const holeEntry: ManifestEntry = {
      name: 'fixture-hole',
      input: 'fixtures/hole-fixture.png',
      kind: 'pose',
      cell: [256, 256],
      shipHeight: 240,
      poses: ['idle'],
      out: 'fixture-hole',
    };
    const atlas = (await cartoonizeSheet(holeEntry, toolDir, out))!;
    const sheet = await pixels(join(out, 'fixture-hole.webp'));
    expect(atlas.image).toBe('fixture-hole.webp');
    // No scaling (shipHeight 240 = slab height). The border-connected strip is
    // keyed and trimmed away, so the frame is the 256x240 slab, bottom-aligned
    // in its 256x256 cell at y=16 — sheet row = source row (16-px offsets
    // cancel). If the strip survived keying instead, the trim box would be the
    // full 256x256 sheet with frame.y=0.
    const frame = atlas.frames['idle']!;
    expect([frame.x, frame.y]).toEqual([0, 16]);
    expect([frame.w, frame.h]).toEqual([256, 240]);
    // Padding above the frame (the keyed strip's former rows) is transparent...
    expect(alphaAt(sheet, 0, 0)).toBe(0);
    // ...the slab's top row is opaque...
    expect(alphaAt(sheet, 0, 16)).toBe(255);
    // ...the small enclosed hole keeps its key-coloured pixels (12x12 hole at
    // source (48,64)..(59,75), centre (53,69) → sheet (53,69); 144 px is below
    // POCKET_MIN_AREA, so the area rule keeps it opaque)...
    const centre = alphaAt(sheet, 53, 69);
    expect(centre, 'enclosed key-coloured hole centre stays opaque').toBeGreaterThan(0);
    // ...and the near-key silver rect inside the slab survives (source (35,235)
    // → sheet (35,235); its chroma exceeds POCKET_MAX_CHROMA, so the chroma
    // rule keeps it opaque).
    const silver = alphaAt(sheet, 35, 235);
    expect(silver, 'near-key silver rect survives inside the slab').toBeGreaterThan(200);
  });

  it('keys deep enclosed pockets: large neutral interiors become holes, rule-violating pockets stay opaque', async () => {
    // Regression for the t3fix2 incident: ring pockets / claw gaps / between-
    // arm areas are enclosed background showing through the figure — leaving
    // them opaque grey reads as a solid blob. An enclosed keyable component is
    // keyed like the border background only when ALL deep-pocket rules hold:
    // area >= POCKET_MIN_AREA, mean chroma <= POCKET_MAX_CHROMA and mean
    // distance <= POCKET_MAX_DISTANCE. The fixture places one pocket on each
    // side of every rule (see writePocketFixture).
    const pocketEntry: ManifestEntry = {
      name: 'fixture-pocket',
      input: 'fixtures/pocket-fixture.png',
      kind: 'pose',
      cell: [128, 128],
      shipHeight: 96,
      poses: ['idle'],
      out: 'fixture-pocket',
    };
    const atlas = (await cartoonizeSheet(pocketEntry, toolDir, out))!;
    const sheet = await pixels(join(out, 'fixture-pocket.webp'));
    expect(atlas.image).toBe('fixture-pocket.webp');
    // No scaling (shipHeight 96 = slab height): frame = slab, sheet row = 32.
    const frame = atlas.frames['idle']!;
    expect([frame.x, frame.y]).toEqual([0, 32]);
    expect([frame.w, frame.h]).toEqual([128, 96]);
    // The ring interior passes all three rules and becomes a real hole...
    expect(alphaAt(sheet, 32, 80), 'ring pocket centre keyed away').toBe(0);
    // ...opaque slab pixels between and around the pockets stay intact...
    expect(alphaAt(sheet, 32, 50), 'slab above the ring stays opaque').toBe(255);
    expect(alphaAt(sheet, 6, 80), 'slab left of the ring stays opaque').toBe(255);
    expect(alphaAt(sheet, 96, 80), 'slab below the dim rect stays opaque').toBe(255);
    // ...the dim pocket (mean distance 23 > POCKET_MAX_DISTANCE) stays
    // opaque...
    expect(alphaAt(sheet, 95, 64), 'dim neutral paint keeps its alpha').toBeGreaterThan(200);
    // ...and the small key-coloured speck (24 px < POCKET_MIN_AREA) survives.
    expect(alphaAt(sheet, 43, 41), 'small key-coloured speck survives').toBeGreaterThan(200);
  });

  it('is byte-identical across repeated runs of the same input', async () => {
    const outA = await mkdtemp(join(tmpdir(), 'dice-bandits-cartoonize-a-'));
    const outB = await mkdtemp(join(tmpdir(), 'dice-bandits-cartoonize-b-'));
    try {
      await cartoonizeSheet(poseEntry, toolDir, outA);
      await cartoonizeSheet(poseEntry, toolDir, outB);
      const a = await readFile(join(outA, 'fixture-pose.webp'));
      const b = await readFile(join(outB, 'fixture-pose.webp'));
      expect(a.equals(b)).toBe(true);
      expect(
        (await readFile(join(outA, 'fixture-pose.json'))).equals(
          await readFile(join(outB, 'fixture-pose.json')),
        ),
      ).toBe(true);
    } finally {
      await rm(outA, { recursive: true, force: true });
      await rm(outB, { recursive: true, force: true });
    }
  });
});

describe('cartoonize grid mode', () => {
  it('slices a 4x2 fixture into 8 named frames in row-major order', async () => {
    const atlas = (await cartoonizeSheet(gridEntry, toolDir, out))!;
    expect(Object.keys(atlas.frames)).toEqual(gridEntry.poses);
    const sheet = await pixels(join(out, 'fixture-grid.webp'));
    for (const [index, pose] of gridEntry.poses!.entries()) {
      const frame = atlas.frames[pose]!;
      expect(frame.x).toBe((index % 4) * 64 + 4);
      expect(frame.y).toBe(Math.floor(index / 4) * 64 + 8);
      expect(frame.w).toBe(56);
      expect(frame.h).toBe(56);
      expect(
        alphaAt(sheet, frame.x + Math.floor(frame.w / 2), frame.y + Math.floor(frame.h / 2)),
      ).toBeGreaterThan(0);
    }
  });
});

describe('cartoonize map mode', () => {
  it('cuts a 3200x1800 input into 640x600 tiles named r{row}c{col}.webp', async () => {
    const mapEntry: ManifestEntry = {
      name: 'fixture-map',
      input: 'fixtures/map-fixture.png',
      kind: 'map',
      cell: [640, 600],
      shipHeight: 600,
      out: 'map',
    };
    await cartoonizeSheet(mapEntry, toolDir, out);
    const files = await readdir(join(out, 'map'));
    expect(files.filter((f) => f.endsWith('.webp')).length).toBe(15);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        const name = `r${row}c${col}.webp`;
        expect(files).toContain(name);
        const meta = await sharp(join(out, 'map', name)).metadata();
        expect(meta.width).toBe(640);
        expect(meta.height).toBe(600);
      }
    }
  });

  it('keeps each tile row band: tile content matches its source band colour', async () => {
    const mapEntry: ManifestEntry = {
      name: 'fixture-map',
      input: 'fixtures/map-fixture.png',
      kind: 'map',
      cell: [640, 600],
      shipHeight: 600,
      out: 'map',
    };
    await cartoonizeSheet(mapEntry, toolDir, out);
    for (let row = 0; row < 3; row++) {
      const tile = await pixels(join(out, 'map', `r${row}c0.webp`));
      const expected = 60 + row * 60;
      const at = alphaAt(tile, 320, 300);
      expect(at).toBe(255);
      const offset = (300 * tile.width + 320) * 4;
      // WebP q82 is lossy: accept a ±2 channel drift around the band colour.
      expect(Math.abs(tile.data[offset]! - expected)).toBeLessThanOrEqual(2);
    }
  });
});

describe('cartoonizeAll', () => {
  it('processes every manifest entry and returns sorted names', async () => {
    // cartoonizeAll reads sheets.json from the base dir; the shipped manifest is
    // empty until the art task lands, so point it at a temp manifest instead.
    const tempBase = await mkdtemp(join(tmpdir(), 'dice-bandits-cartoonize-manifest-'));
    try {
      const fixtureSheets = {
        sheets: [
          { ...gridEntry, input: join(fixtures, 'grid-fixture.png') },
          { ...poseEntry, input: join(fixtures, 'poses-fixture.png') },
        ],
      };
      await writeFile(join(tempBase, 'sheets.json'), JSON.stringify(fixtureSheets));
      const processed = await cartoonizeAll(tempBase, out);
      expect(processed).toEqual(['fixture-grid', 'fixture-pose']);
      expect((await stat(join(out, 'fixture-pose.webp'))).size).toBeGreaterThan(0);
      expect((await stat(join(out, 'fixture-grid.webp'))).size).toBeGreaterThan(0);
    } finally {
      await rm(tempBase, { recursive: true, force: true });
    }
  });
});

describe('check-art-budget.mjs', () => {
  it('exits 1 when ART_BUDGET_BYTES is below the fixture total and 0 otherwise', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'dice-bandits-budget-'));
    try {
      await mkdir(join(sandbox, 'apps/client/public/art/map'), { recursive: true });
      await mkdir(join(sandbox, 'scripts'), { recursive: true });
      await writeFile(join(sandbox, 'apps/client/public/art/a.webp'), Buffer.alloc(300));
      await writeFile(join(sandbox, 'apps/client/public/art/map/b.png'), Buffer.alloc(200));
      await copyFile(
        join(root, 'scripts/check-art-budget.mjs'),
        join(sandbox, 'scripts/check-art-budget.mjs'),
      );
      const scriptPath = join(sandbox, 'scripts/check-art-budget.mjs');
      const runBudget = (budget: string) =>
        run('node', [scriptPath], { env: { ...process.env, ART_BUDGET_BYTES: budget } }).then(
          ({ stdout }) => ({ code: 0, stdout }),
          (error: NodeJS.ErrnoException) => ({ code: error.code ?? -1, stdout: '' }),
        );
      const below = await runBudget('100');
      expect(below.code).toBe(1);
      expect(await runBudget('6000000')).toMatchObject({ code: 0 });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
