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

describe('grid mode (battle sheets)', () => {
  it('extracts grid-grouped poses whole: cross-boundary poses, multi-island unions, and dropped specks', async () => {
    const source = join(sheetBase, 'battle-grid.png');
    const overlays: OverlayOptions[] = [
      // pose 0: single body inside column 0 (column width = 300)
      {
        input: { create: { width: 90, height: 60, channels: 4 as const, background: '#206040' } },
        left: 30,
        top: 20,
      },
      // pose 1: one wide body crossing the column 1 / column 2 boundary at x = 600,
      // centre still inside column 1 (mirrors the approved sheets: poses cross
      // boundaries but never drift past half a column)
      {
        input: { create: { width: 190, height: 70, channels: 4 as const, background: '#204080' } },
        left: 430,
        top: 15,
      },
      // pose 2: two separate islands (body + companion) that belong to one pose
      {
        input: { create: { width: 60, height: 40, channels: 4 as const, background: '#a0a020' } },
        left: 760,
        top: 20,
      },
      {
        input: { create: { width: 40, height: 30, channels: 4 as const, background: '#804080' } },
        left: 840,
        top: 40,
      },
      // poses 3-5: plain single bodies
      {
        input: { create: { width: 100, height: 60, channels: 4 as const, background: '#207040' } },
        left: 1000,
        top: 20,
      },
      {
        input: { create: { width: 90, height: 70, channels: 4 as const, background: '#406020' } },
        left: 1350,
        top: 15,
      },
      {
        input: { create: { width: 80, height: 50, channels: 4 as const, background: '#604020' } },
        left: 1600,
        top: 30,
      },
      // noise speck near pose 0 that must be dropped by the pixel-count floor
      {
        input: { create: { width: 3, height: 3, channels: 4 as const, background: '#101010' } },
        left: 200,
        top: 90,
      },
    ];
    await sharp({ create: { width: 1800, height: 100, channels: 4, background: '#969696' } })
      .composite(overlays)
      .png()
      .toFile(source);
    const output = await buildSheet(
      {
        name: 'battle-grid',
        source: 'battle-grid.png',
        frames: 6,
        cell: { width: 24, height: 24 },
        split: 'grid',
        noiseFloor: 10,
        background: { color: [150, 150, 150], tolerance: 18 },
        animations: {},
      },
      sheetBase,
      sheetOut,
    );
    expect(output.frames).toHaveLength(6);
    const { data, info } = await sharp(join(sheetOut, 'battle-grid.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const boxes = output.frames.map((frame) => {
      let minX = frame.w,
        minY = frame.h,
        maxX = -1,
        maxY = -1,
        opaque = 0;
      for (let y = 0; y < frame.h; y++)
        for (let x = 0; x < frame.w; x++) {
          if (data[((frame.y + y) * info.width + frame.x + x) * info.channels + 3] === 0) continue;
          opaque++;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      return { minX, minY, maxX, maxY, opaque, w: maxX - minX + 1, h: maxY - minY + 1 };
    });
    for (const [index, box] of boxes.entries()) {
      expect(box.opaque, `frame ${index} empty`).toBeGreaterThan(0);
      // whole-object inset: nothing touches the left/right/top cell borders (that
      // would mean cropping). The bottom row is the feet baseline and may be touched
      // by design for feet-anchored sheets.
      expect(box.minX, `frame ${index} inset left`).toBeGreaterThanOrEqual(1);
      expect(box.minY, `frame ${index} inset top`).toBeGreaterThanOrEqual(1);
      expect(box.maxX, `frame ${index} inset right`).toBeLessThanOrEqual(22);
      expect(box.maxY, `frame ${index} inset bottom`).toBeLessThanOrEqual(23);
    }
    // pose 0: the 3x3 speck at (160, 90) must not stretch the bounding box
    expect(boxes[0]!.w / boxes[0]!.h).toBeGreaterThan(1.25);
    expect(boxes[0]!.w / boxes[0]!.h).toBeLessThan(1.7);
    // pose 1: the whole cross-boundary body survives with its wide 190x70 aspect
    expect(boxes[1]!.w / boxes[1]!.h).toBeGreaterThan(2.2);
    expect(boxes[1]!.w / boxes[1]!.h).toBeLessThan(3.1);
    // pose 2: both islands are present (a per-component splitter would keep only one)
    const frame2 = output.frames[2]!;
    const seen = new Uint8Array(frame2.w * frame2.h);
    const sizes: number[] = [];
    for (let start = 0; start < frame2.w * frame2.h; start++) {
      if (seen[start]) continue;
      if (
        data[
          ((frame2.y + Math.floor(start / frame2.w)) * info.width + frame2.x + (start % frame2.w)) *
            info.channels +
            3
        ] === 0
      ) {
        seen[start] = 1;
        continue;
      }
      const queue = [start];
      seen[start] = 1;
      let size = 0;
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const pixel = queue[cursor]!;
        size++;
        const x = pixel % frame2.w;
        const y = Math.floor(pixel / frame2.w);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= frame2.w || ny >= frame2.h) continue;
            const next = ny * frame2.w + nx;
            if (seen[next]) continue;
            if (data[((frame2.y + ny) * info.width + frame2.x + nx) * info.channels + 3] === 0) {
              seen[next] = 1;
              continue;
            }
            seen[next] = 1;
            queue.push(next);
          }
      }
      sizes.push(size);
    }
    expect(sizes.filter((size) => size > 2).length).toBeGreaterThanOrEqual(2);
    await assertPaletteOnly(join(sheetOut, 'battle-grid.png'), 'main');
  });

  it('floods near-background blend pixels away so grey keys never survive at edges', async () => {
    const source = join(sheetBase, 'grey-fringe.png');
    const width = 60;
    const height = 60;
    const pixels = await sharp({
      create: { width, height, channels: 4 as const, background: '#b0b0ae' },
    })
      .ensureAlpha()
      .raw()
      .toBuffer();
    // dark core with a 2px ring blended *part way* toward the grey background:
    // distance 30 from bg — outside the flood tolerance (18), inside the boundary
    // blend limit (34), so only blend elimination can remove the ring
    for (let y = 12; y < 48; y++)
      for (let x = 16; x < 44; x++) {
        const offset = (y * width + x) * 4;
        const ring = y <= 13 || y >= 46 || x <= 17 || x >= 42;
        pixels[offset] = ring ? 206 : 30;
        pixels[offset + 1] = ring ? 204 : 50;
        pixels[offset + 2] = ring ? 196 : 70;
      }
    await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(source);
    await buildSheet(
      {
        name: 'grey-fringe',
        source: 'grey-fringe.png',
        frames: 1,
        cell: { width: 24, height: 24 },
        split: 'grid',
        noiseFloor: 10,
        background: { color: [176, 176, 174], tolerance: 18 },
        animations: {},
      },
      sheetBase,
      sheetOut,
    );
    const { data } = await sharp(join(sheetOut, 'grey-fringe.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let opaque = 0;
    let halo = 0;
    for (let index = 0; index < data.length; index += 4) {
      if ((data[index + 3] ?? 0) === 0) continue;
      opaque++;
      const [r, g, b] = [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0];
      // neutral-light pixels: the bg grey blend quantises to palette #a89b9b / #d1c1bb,
      // so a surviving blend ring shows up as a washed-out red channel (r >= 140
      // while the green/blue channels stay dark)
      if (r >= 140 && Math.max(r, g, b) - Math.min(r, g, b) <= 40) halo++;
    }
    expect(opaque).toBeGreaterThan(80);
    expect(halo, 'neutral-light halo pixels surviving at edges').toBe(0);
  });
});

describe('battle frame consistency regressions', () => {
  const boxes = async (name: string, frames: number, cell: number) => {
    const { data, info } = await sharp(join(sheetOut, `${name}.png`))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return Array.from({ length: frames }, (_, frame) => {
      let minY = cell;
      let maxY = -1;
      let red = 0;
      for (let y = 0; y < cell; y++)
        for (let x = 0; x < cell; x++) {
          const i = (y * info.width + frame * cell + x) * 4;
          if (data[i + 3] === 0) continue;
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          if (data[i] === 0xe8 && data[i + 1] === 0x41 && data[i + 2] === 0x42) red++;
        }
      return { height: maxY - minY + 1, red };
    });
  };

  it('preserves the relative height of same-height poses across a wide strike', async () => {
    const source = join(sheetBase, 'wide-strike.png');
    await sharp({ create: { width: 450, height: 100, channels: 4, background: '#b0b0ae' } })
      .composite(
        [20, 150, 320].map((left, index) => ({
          input: {
            create: {
              width: index === 1 ? 120 : 60,
              height: 50,
              channels: 4 as const,
              background: '#206040',
            },
          },
          left,
          top: 20,
        })),
      )
      .png()
      .toFile(source);
    await buildSheet(
      {
        name: 'wide-strike',
        source,
        frames: 3,
        cell: { width: 32, height: 32 },
        split: 'grid',
        noiseFloor: 10,
        background: { color: [176, 176, 174], tolerance: 18 },
        animations: { attack: { from: 0, to: 2, fps: 10, loop: false } },
      },
      sheetBase,
      sheetOut,
    );
    const heights = (await boxes('wide-strike', 3, 32)).map((box) => box.height);
    expect(
      Math.max(...heights) - Math.min(...heights),
      `pose heights ${heights}`,
    ).toBeLessThanOrEqual(2);
  });

  it('uses measured frame ranges to keep a detached accent with its irregularly spaced pose', async () => {
    const source = join(sheetBase, 'irregular-fx.png');
    await sharp({ create: { width: 160, height: 60, channels: 4, background: '#f10ef1' } })
      .composite([
        ...[5, 45, 111, 145].map((left) => ({
          input: { create: { width: 11, height: 25, channels: 4 as const, background: '#206040' } },
          left,
          top: 15,
        })),
        {
          input: { create: { width: 7, height: 7, channels: 4 as const, background: '#e84142' } },
          left: 81,
          top: 20,
        },
      ])
      .png()
      .toFile(source);
    await buildSheet(
      {
        name: 'irregular-fx',
        source,
        frames: 4,
        cell: { width: 32, height: 32 },
        split: 'grid',
        sourceRanges: [
          [0, 36],
          [37, 90],
          [91, 133],
          [134, 159],
        ],
        noiseFloor: 10,
        background: { color: [241, 14, 241], tolerance: 18 },
        anchor: 'center',
        animations: {},
      },
      sheetBase,
      sheetOut,
    );
    const result = await boxes('irregular-fx', 4, 32);
    expect(
      result.map((box) => box.red),
      'accent belongs to pose 1 only',
    ).toEqual([0, expect.any(Number), 0, 0]);
    expect(result[1]!.red).toBeGreaterThan(0);
  });

  it('despills near-magenta keyed edges before they quantise to palette red', async () => {
    const source = join(sheetBase, 'near-magenta.png');
    const width = 40,
      height = 40;
    const pixels = await sharp({ create: { width, height, channels: 4, background: '#f10ef1' } })
      .ensureAlpha()
      .raw()
      .toBuffer();
    for (let y = 5; y < 35; y++)
      for (let x = 5; x < 35; x++) {
        const i = (y * width + x) * 4;
        const blend = x === 5 || x === 34 || y === 5 || y === 34 ? 0.5 : 0;
        pixels[i] = Math.round(152 * (1 - blend) + 241 * blend);
        pixels[i + 1] = Math.round(95 * (1 - blend) + 14 * blend);
        pixels[i + 2] = Math.round(59 * (1 - blend) + 241 * blend);
      }
    await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(source);
    await buildSheet(
      {
        name: 'near-magenta',
        source,
        frames: 1,
        cell: { width: 32, height: 32 },
        split: 'grid',
        noiseFloor: 10,
        background: { color: [241, 14, 241], tolerance: 18 },
        animations: {},
      },
      sheetBase,
      sheetOut,
    );
    expect((await boxes('near-magenta', 1, 32))[0]!.red, 'key-red edge pixels').toBe(0);
  });
});

describe('full-frame mode (backdrops)', () => {
  it('downscales the entire image without keying or trimming', async () => {
    const source = join(sheetBase, 'scene.png');
    const width = 40;
    const height = 20;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        pixels[offset] = Math.round((x / width) * 200);
        pixels[offset + 1] = 60;
        pixels[offset + 2] = Math.round((y / height) * 160);
        pixels[offset + 3] = 255;
      }
    await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(source);
    const atlas = await buildSheet(
      {
        name: 'scene',
        source: 'scene.png',
        frames: 1,
        cell: { width: 8, height: 4 },
        fullFrame: true,
        palette: 'backdrop',
        anchor: 'center',
        animations: {},
      },
      sheetBase,
      sheetOut,
    );
    expect(atlas.frames).toHaveLength(1);
    expect(atlas.frames[0]).toEqual({ x: 0, y: 0, w: 8, h: 4 });
    const { data } = await sharp(join(sheetOut, 'scene.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let opaque = 0;
    const colours = new Set<string>();
    for (let index = 0; index < data.length; index += 4) {
      expect(data[index + 3]).toBe(255);
      opaque++;
      colours.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
    }
    expect(opaque).toBe(8 * 4);
    expect(colours.size).toBeGreaterThan(4);
    await assertPaletteOnly(join(sheetOut, 'scene.png'), 'backdrop');
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
