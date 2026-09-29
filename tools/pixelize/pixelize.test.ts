import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp, { type OverlayOptions } from 'sharp';
import { assertPaletteOnly, buildSheet, buildSprites, type SheetEntry } from './pixelize.js';

const root = new URL('../../', import.meta.url).pathname;
const configPath = join(root, 'tools/pixelize/crops.json');
const palettePath = join(root, 'tools/pixelize/palette.json');
const config = JSON.parse(await readFile(configPath, 'utf8')) as {
  sprites: Array<{ output: string; width: number; height: number }>;
  icons: string[];
};
const palette = JSON.parse(await readFile(palettePath, 'utf8')) as string[];
const atlas = {
  output: 'icons.png',
  width: Math.min(4, config.icons.length) * 16,
  height: Math.ceil(config.icons.length / 4) * 16,
};
const outputs = [...config.sprites, atlas];
const expectedDimensions: Record<string, [number, number]> = {
  'hero-knight.png': [32, 32],
  'hero-thief.png': [32, 32],
  'hero-mage.png': [32, 32],
  'hero-cleric.png': [32, 32],
  'hero-knight-portrait.png': [48, 48],
  'hero-thief-portrait.png': [48, 48],
  'hero-mage-portrait.png': [48, 48],
  'hero-cleric-portrait.png': [48, 48],
  'monster-goldSlime.png': [32, 32],
  'monster-mushroomBandit.png': [32, 32],
  'monster-lanternGhost.png': [32, 32],
  'monster-mimic.png': [48, 48],
  'monster-rockGolem.png': [48, 48],
  'monster-shadowImp.png': [32, 32],
  'tiles-meadow.png': [32, 32],
  'tiles-desert.png': [32, 32],
  'tiles-snow.png': [32, 32],
  'tiles-volcano.png': [32, 32],
  'icons.png': [64, 48],
};
let firstOut: string;
let secondOut: string;

beforeAll(async () => {
  firstOut = await mkdtemp(join(tmpdir(), 'dice-bandits-pixelize-a-'));
  secondOut = await mkdtemp(join(tmpdir(), 'dice-bandits-pixelize-b-'));
  await buildSprites({ configPath, outDir: firstOut, writeContactSheet: false });
  await buildSprites({ configPath, outDir: secondOut, writeContactSheet: false });
});

afterAll(async () => {
  await rm(firstOut, { recursive: true, force: true });
  await rm(secondOut, { recursive: true, force: true });
});

describe('pixelize outputs', () => {
  it('packs selected frames with contiguous rows and preserves the unselected frame pixels', async () => {
    const source = join(root, 'docs/concepts/m4/heroes/portraits.png');
    const selectedOut = await mkdtemp(join(tmpdir(), 'dice-bandits-selected-'));
    const fullOut = await mkdtemp(join(tmpdir(), 'dice-bandits-full-'));
    const common = {
      name: 'portrait-fixture',
      source,
      frames: 4,
      cell: { width: 32, height: 32 },
      animations: {},
    } satisfies SheetEntry;
    try {
      await buildSheet({ ...common, select: [2] }, root, selectedOut);
      await buildSheet(common, root, fullOut);
      const selected = await sharp(join(selectedOut, 'portrait-fixture.png'))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const full = await sharp(join(fullOut, 'portrait-fixture.png'))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const selectedCell = Buffer.alloc(32 * 32 * 4);
      const fullCell = Buffer.alloc(32 * 32 * 4);
      for (let y = 0; y < 32; y++) {
        selected.data.copy(
          selectedCell,
          y * 32 * 4,
          y * selected.info.width * 4,
          (y * selected.info.width + 32) * 4,
        );
        full.data.copy(
          fullCell,
          y * 32 * 4,
          (y * full.info.width + 2 * 32) * 4,
          (y * full.info.width + 3 * 32) * 4,
        );
      }
      expect(selectedCell).toEqual(fullCell);
      const { data, info } = selected;
      const opaqueRows = Array.from({ length: info.height }, (_, y) =>
        data.some(
          (_, index) =>
            index % 4 === 3 && Math.floor(index / (info.width * 4)) === y && data[index] > 0,
        ),
      );
      const first = opaqueRows.indexOf(true);
      const last = opaqueRows.lastIndexOf(true);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(opaqueRows.slice(first, last + 1).every(Boolean)).toBe(true);
    } finally {
      await rm(selectedOut, { recursive: true, force: true });
      await rm(fullOut, { recursive: true, force: true });
    }
  });
  it('writes every configured sprite and icon atlas at exact target dimensions', async () => {
    expect(
      Object.fromEntries(outputs.map(({ output, width, height }) => [output, [width, height]])),
    ).toEqual(expectedDimensions);
    const files = await readdir(firstOut);
    for (const sprite of outputs) {
      expect(files).toContain(sprite.output);
      const metadata = await sharp(join(firstOut, sprite.output)).metadata();
      expect(metadata.width).toBe(sprite.width);
      expect(metadata.height).toBe(sprite.height);
    }
    const frames = JSON.parse(await readFile(join(firstOut, 'icons.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(frames).sort()).toEqual([...config.icons].sort());
  });

  it('uses only opaque palette colors and fully transparent pixels', async () => {
    const allowed = new Set(palette.map((hex) => hex.slice(1).toLowerCase()));
    for (const sprite of outputs) {
      const { data, info } = await sharp(join(firstOut, sprite.output))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let index = 0; index < data.length; index += info.channels) {
        const alpha = data[index + 3];
        expect([0, 255]).toContain(alpha);
        if (alpha === 255) {
          const color = [data[index], data[index + 1], data[index + 2]]
            .map((channel) => channel.toString(16).padStart(2, '0'))
            .join('');
          expect(allowed).toContain(color);
        }
      }
    }
  });

  it('keeps terrain tiles within their expected color families', async () => {
    for (const [name, matches] of [
      ['tiles-volcano.png', (r: number, g: number, b: number) => !(b > r + 30 && b > g + 30)],
      ['tiles-meadow.png', (r: number, g: number, b: number) => g > r && g > b],
      ['tiles-desert.png', (r: number, _g: number, b: number) => r > b],
    ] as const) {
      const { data, info } = await sharp(join(firstOut, name))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let opaque = 0;
      let matching = 0;
      for (let index = 0; index < data.length; index += info.channels) {
        if (data[index + 3] === 0) continue;
        opaque++;
        if (matches(data[index], data[index + 1], data[index + 2])) matching++;
      }
      expect(opaque).toBeGreaterThan(0);
      expect(matching / opaque).toBeGreaterThan(name === 'tiles-volcano.png' ? 0.999 : 0.5);
    }
  });

  it('renders at least ten percent of volcano pixels as hot lava', async () => {
    const { data, info } = await sharp(join(firstOut, 'tiles-volcano.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let opaque = 0;
    let hot = 0;
    for (let index = 0; index < data.length; index += info.channels) {
      if (data[index + 3] === 0) continue;
      opaque++;
      const [r, g, b] = [data[index], data[index + 1], data[index + 2]];
      if (r > 180 && r > g + 60 && b < 80) hot++;
    }
    expect(hot / opaque).toBeGreaterThanOrEqual(0.1);
  });

  it('renders the skull with two separate dark eye sockets in its upper half', async () => {
    const { data, info } = await sharp(join(firstOut, 'icons.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const originX = (5 % 4) * 16;
    const originY = 1 * 16;
    const dark = new Uint8Array(16 * 8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 16; x++) {
        const offset = ((originY + y) * info.width + originX + x) * info.channels;
        if (data[offset + 3] === 0) continue;
        if (data[offset] < 80 && data[offset + 1] < 80 && data[offset + 2] < 80) {
          dark[y * 16 + x] = 1;
        }
      }
    }
    for (const y of [5, 6]) {
      for (const x of [5, 6, 9, 10]) expect(dark[y * 16 + x]).toBe(1);
      for (const x of [7, 8]) expect(dark[y * 16 + x]).toBe(0);
    }
    const componentSizes: number[] = [];
    const visited = new Uint8Array(dark.length);
    for (let start = 0; start < dark.length; start++) {
      if (!dark[start] || visited[start]) continue;
      let size = 0;
      const queue = [start];
      visited[start] = 1;
      while (queue.length > 0) {
        const pixel = queue.pop()!;
        size++;
        const x = pixel % 16;
        const y = Math.floor(pixel / 16);
        for (const next of [
          ...(x > 0 ? [pixel - 1] : []),
          ...(x < 15 ? [pixel + 1] : []),
          ...(y > 0 ? [pixel - 16] : []),
          ...(y < 7 ? [pixel + 16] : []),
        ]) {
          if (!dark[next] || visited[next]) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }
      componentSizes.push(size);
    }
    expect(componentSizes.filter((size) => size >= 4).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps every icon inset from its cell edges with at least 30 opaque pixels', async () => {
    const { data } = await sharp(join(firstOut, 'icons.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let icon = 0; icon < config.icons.length; icon++) {
      const originX = (icon % 4) * 16;
      const originY = Math.floor(icon / 4) * 16;
      let opaque = 0;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const offset = ((originY + y) * 64 + originX + x) * 4;
          if (data[offset + 3] === 0) continue;
          opaque++;
          expect(x).toBeGreaterThan(0);
          expect(x).toBeLessThan(15);
          expect(y).toBeGreaterThan(0);
          expect(y).toBeLessThan(15);
        }
      }
      expect(opaque, config.icons[icon]).toBeGreaterThanOrEqual(30);
    }
  });

  it('renders the heart with a majority of red-dominant non-outline pixels', async () => {
    const { data } = await sharp(join(firstOut, 'icons.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let colored = 0;
    let red = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const offset = (y * 64 + 4 * 16 + x) * 4;
        if (data[offset + 3] === 0) continue;
        const [r, g, b] = [data[offset], data[offset + 1], data[offset + 2]];
        if (r < 60 && g < 60 && b < 60) continue;
        colored++;
        if (r > g && r > b) red++;
      }
    }
    expect(colored).toBeGreaterThan(0);
    expect(red / colored).toBeGreaterThan(0.5);
  });

  it('produces byte-identical outputs across repeated pipeline runs', async () => {
    for (const sprite of outputs) {
      const first = await readFile(join(firstOut, sprite.output));
      const second = await readFile(join(secondOut, sprite.output));
      expect(second.equals(first)).toBe(true);
    }
    expect(await readFile(join(firstOut, 'icons.json'))).toEqual(
      await readFile(join(secondOut, 'icons.json')),
    );
  });
});

const sheetEntry: SheetEntry = {
  name: 't3',
  source: 'sheet-3.png',
  frames: 3,
  cell: { width: 16, height: 16 },
  animations: { idle: { from: 0, to: 2, fps: 6, loop: true } },
};
let sheetBase: string;
let sheetOut: string;
let sheetOut2: string;

beforeEach(async () => {
  sheetBase = await mkdtemp(join(tmpdir(), 'dice-bandits-sheet-source-'));
  sheetOut = await mkdtemp(join(tmpdir(), 'dice-bandits-sheet-a-'));
  sheetOut2 = await mkdtemp(join(tmpdir(), 'dice-bandits-sheet-b-'));
  const blobs = [
    {
      input: { create: { width: 12, height: 20, channels: 4 as const, background: '#ff0000' } },
      left: 3,
      top: 8,
    },
    {
      input: { create: { width: 12, height: 14, channels: 4 as const, background: '#00ff00' } },
      left: 39,
      top: 14,
    },
    {
      input: { create: { width: 12, height: 26, channels: 4 as const, background: '#0000ff' } },
      left: 69,
      top: 2,
    },
  ];
  await sharp({ create: { width: 90, height: 30, channels: 4, background: '#808080' } })
    .composite(blobs)
    .png()
    .toFile(join(sheetBase, 'sheet-3.png'));
});

afterEach(async () => {
  await Promise.all(
    [sheetBase, sheetOut, sheetOut2].map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('spritesheet mode', () => {
  it('splits irregularly spaced connected props into ordered frames and drops stray specks', async () => {
    const source = join(sheetBase, 'components.png');
    const props = [
      { left: 8, top: 4, width: 8, height: 18 },
      { left: 28, top: 8, width: 13, height: 14 },
      { left: 52, top: 5, width: 9, height: 17 },
      { left: 76, top: 10, width: 11, height: 12 },
      { left: 101, top: 3, width: 7, height: 19 },
      { left: 124, top: 9, width: 14, height: 13 },
      { left: 155, top: 5, width: 10, height: 17 },
      { left: 180, top: 7, width: 12, height: 15 },
    ];
    const overlays: OverlayOptions[] = props.map((rect, index) => ({
      input: {
        create: {
          width: rect.width,
          height: rect.height,
          channels: 4,
          background: ['#202020', '#40a040', '#a04040'][index % 3],
        },
      },
      left: rect.left,
      top: rect.top,
    }));
    overlays.push({
      input: { create: { width: 1, height: 1, channels: 4, background: '#101010' } },
      left: 3,
      top: 27,
    });
    await sharp({ create: { width: 204, height: 28, channels: 4, background: '#ff00ff' } })
      .composite(overlays)
      .png()
      .toFile(source);
    const output = await buildSheet(
      {
        name: 'component-props',
        source: 'components.png',
        frames: 8,
        cell: { width: 32, height: 32 },
        split: 'components',
        animations: {},
      },
      sheetBase,
      sheetOut,
    );
    expect(output.frames).toHaveLength(8);
    const { data, info } = await sharp(join(sheetOut, 'component-props.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (const frame of output.frames) {
      let opaque = 0;
      for (let y = 0; y < frame.h; y++)
        for (let x = 0; x < frame.w; x++) {
          if (data[((frame.y + y) * info.width + frame.x + x) * info.channels + 3] > 0) opaque++;
        }
      expect(opaque).toBeGreaterThan(0);
    }
  });

  it('writes a sorted deterministic atlas manifest when emitting sheets', async () => {
    await buildSheet({ ...sheetEntry, name: 'z-sheet' }, sheetBase, sheetOut);
    await buildSheet({ ...sheetEntry, name: 'a-sheet' }, sheetBase, sheetOut);
    expect(JSON.parse(await readFile(join(sheetOut, 'atlases.json'), 'utf8'))).toEqual({
      atlases: ['a-sheet', 'z-sheet'],
    });
    await buildSheet({ ...sheetEntry, name: 'z-sheet' }, sheetBase, sheetOut);
    expect(await readFile(join(sheetOut, 'atlases.json'), 'utf8')).toBe(
      '{\n  "atlases": [\n    "a-sheet",\n    "z-sheet"\n  ]\n}\n',
    );
  });

  it('slices a row sheet into equal cells with feet anchor and animation frames', async () => {
    const atlas = await buildSheet(sheetEntry, sheetBase, sheetOut);
    expect(atlas.frames).toHaveLength(3);
    expect(atlas.frames.every((frame) => frame.w === 16 && frame.h === 16)).toBe(true);
    expect(atlas.anchor).toEqual({ x: 8, y: 16 });
    expect(atlas.animations.idle).toEqual({ frames: [0, 1, 2], fps: 6, loop: true });
    expect(JSON.parse(await readFile(join(sheetOut, 't3.json'), 'utf8'))).toEqual(atlas);
  });

  it('keeps default frame selection and can emit a chosen source frame as a one-frame atlas', async () => {
    const all = await buildSheet(sheetEntry, sheetBase, sheetOut);
    const selected = await buildSheet(
      { ...sheetEntry, name: 'selected', select: [1], animations: {} },
      sheetBase,
      sheetOut,
    );
    expect(selected.frames).toHaveLength(1);
    expect(selected.frames[0]).toEqual({ x: 0, y: 0, w: 16, h: 16 });
    const selectedPixels = await sharp(join(sheetOut, 'selected.png')).raw().toBuffer();
    const firstPixels = await sharp(join(sheetOut, 't3.png'))
      .extract({ left: 0, top: 0, width: 16, height: 16 })
      .raw()
      .toBuffer();
    expect(selectedPixels).not.toEqual(firstPixels);
    expect(all.frames).toHaveLength(3);
  });

  it('uses only main-palette colors or full transparency', async () => {
    await buildSheet(sheetEntry, sheetBase, sheetOut);
    await assertPaletteOnly(join(sheetOut, 't3.png'), 'main');
  });

  it('is deterministic across repeated builds', async () => {
    await buildSheet(sheetEntry, sheetBase, sheetOut);
    await buildSheet(sheetEntry, sheetBase, sheetOut2);
    expect(await readFile(join(sheetOut, 't3.png'))).toEqual(
      await readFile(join(sheetOut2, 't3.png')),
    );
    expect(await readFile(join(sheetOut, 't3.json'), 'utf8')).toBe(
      await readFile(join(sheetOut2, 't3.json'), 'utf8'),
    );
  });

  it('baseline-aligns every frame at the cell bottom', async () => {
    const atlas = await buildSheet(sheetEntry, sheetBase, sheetOut);
    const { data, info } = await sharp(join(sheetOut, 't3.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const lowest = atlas.frames.map((frame) => {
      for (let y = frame.y + frame.h - 1; y >= frame.y; y--) {
        for (let x = frame.x; x < frame.x + frame.w; x++) {
          if (data[(y * info.width + x) * info.channels + 3] === 255) return y - frame.y;
        }
      }
      return -1;
    });
    expect(new Set(lowest).size).toBe(1);
    expect(lowest[0]).toBe(atlas.cell.height - 1);
  });

  it('reports the first out-of-palette pixel with its coordinates', async () => {
    const badPng = join(sheetOut, 'bad.png');
    await sharp({ create: { width: 2, height: 1, channels: 4, background: '#ff00ff' } })
      .png()
      .toFile(badPng);
    await expect(assertPaletteOnly(badPng, 'main')).rejects.toThrow(/\(0, 0\)/);
  });
});

describe('components mode', () => {
  it('de-fringes anti-aliased magenta halos so edges never quantise to key-red', async () => {
    const source = join(sheetBase, 'fringe.png');
    const width = 24;
    const height = 24;
    const fringe = await sharp({
      create: { width, height, channels: 4 as const, background: '#ff00ff' },
    })
      .ensureAlpha()
      .raw()
      .toBuffer();
    for (let y = 1; y < 22; y++)
      for (let x = 1; x < 22; x++) {
        const offset = (y * width + x) * 4;
        const blend = x === 1 || y === 1 || x === 21 || y === 21 ? 0.45 : 0;
        fringe[offset] = Math.round(152 + (255 - 152) * blend);
        fringe[offset + 1] = Math.round(95 * (1 - blend));
        fringe[offset + 2] = Math.round(59 + (255 - 59) * blend);
      }
    await sharp(fringe, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(source);
    await buildSheet(
      {
        name: 'fringe-prop',
        source: 'fringe.png',
        frames: 1,
        cell: { width: 16, height: 16 },
        split: 'components',
        background: { color: [255, 0, 255], tolerance: 18 },
        animations: {},
      },
      sheetBase,
      sheetOut,
    );
    const { data } = await sharp(join(sheetOut, 'fringe-prop.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let red = 0;
    let magenta = 0;
    let opaque = 0;
    for (let index = 0; index < data.length; index += 4) {
      if ((data[index + 3] ?? 0) === 0) continue;
      opaque++;
      if (
        (data[index] ?? 0) === 0xe8 &&
        (data[index + 1] ?? 0) === 0x41 &&
        (data[index + 2] ?? 0) === 0x42
      )
        red++;
      if ((data[index] ?? 0) > 200 && (data[index + 2] ?? 0) > 200 && (data[index + 1] ?? 0) < 100)
        magenta++;
    }
    expect(opaque).toBeGreaterThan(100);
    expect(red, 'key-red fringe pixels').toBe(0);
    expect(magenta, 'magenta pixels').toBe(0);
  });

  it('frames each component whole: no neighbour bleed and no corner-speck bbox stretch', async () => {
    const source = join(sheetBase, 'separated.png');
    const overlays: OverlayOptions[] = [
      {
        input: { create: { width: 60, height: 70, channels: 4 as const, background: '#40a040' } },
        left: 16,
        top: 20,
      },
      {
        input: { create: { width: 4, height: 18, channels: 4 as const, background: '#203040' } },
        left: 108,
        top: 30,
      },
      {
        input: { create: { width: 80, height: 76, channels: 4 as const, background: '#5e5469' } },
        left: 124,
        top: 24,
      },
      {
        input: { create: { width: 70, height: 90, channels: 4 as const, background: '#fac42f' } },
        left: 240,
        top: 12,
      },
      {
        input: { create: { width: 76, height: 72, channels: 4 as const, background: '#4f62b8' } },
        left: 340,
        top: 30,
      },
      {
        input: { create: { width: 2, height: 2, channels: 4 as const, background: '#101010' } },
        left: 478,
        top: 0,
      },
    ];
    await sharp({ create: { width: 480, height: 160, channels: 4, background: '#ff00ff' } })
      .composite(overlays)
      .png()
      .toFile(source);
    const output = await buildSheet(
      {
        name: 'separated-props',
        source: 'separated.png',
        frames: 4,
        cell: { width: 32, height: 32 },
        split: 'components',
        background: { color: [255, 0, 255], tolerance: 18 },
        animations: {},
      },
      sheetBase,
      sheetOut,
    );
    expect(output.frames).toHaveLength(4);
    const { data, info } = await sharp(join(sheetOut, 'separated-props.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const expected = [
      [60, 70],
      [80, 76],
      [70, 90],
      [76, 72],
    ];
    output.frames.forEach((frame, index) => {
      const [wantW, wantH] = expected[index] ?? [32, 32];
      const seen = new Uint8Array(frame.w * frame.h);
      const sizes: number[] = [];
      let minX = frame.w;
      let maxX = -1;
      let minY = frame.h;
      let maxY = -1;
      for (let start = 0; start < frame.w * frame.h; start++) {
        if ((seen[start] ?? 0) || (data[start * info.channels + 3] ?? 0) !== 255) continue;
        seen[start] = 1;
        const queue = [start];
        let size = 0;
        for (let cursor = 0; cursor < queue.length; cursor++) {
          const pixel = queue[cursor] ?? 0;
          size++;
          const x = pixel % frame.w;
          const y = Math.floor(pixel / frame.w);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= frame.w || ny >= frame.h) continue;
              const next = ny * frame.w + nx;
              if (
                (seen[next] ?? 0) ||
                (data[((frame.y + ny) * info.width + frame.x + nx) * info.channels + 3] ?? 0) !==
                  255
              )
                continue;
              seen[next] = 1;
              queue.push(next);
            }
        }
        sizes.push(size);
      }
      const label = `frame ${index}`;
      const significant = sizes.filter((size) => size > 2);
      expect(significant, `${label} components ${sizes}`).toHaveLength(1);
      const scale = Math.min(30 / wantW, 30 / wantH, 1);
      expect(maxX - minX + 1, `${label} width`).toBeGreaterThanOrEqual(
        Math.round(wantW * scale * 0.75),
      );
      expect(maxY - minY + 1, `${label} height`).toBeGreaterThanOrEqual(
        Math.round(wantH * scale * 0.75),
      );
      expect(minX, `${label} inset left`).toBeGreaterThanOrEqual(1);
      expect(minY, `${label} inset top`).toBeGreaterThanOrEqual(1);
      expect(maxX, `${label} inset right`).toBeLessThanOrEqual(31);
      expect(maxY, `${label} inset bottom`).toBeLessThanOrEqual(31);
    });
  });
});
