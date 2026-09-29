import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
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
