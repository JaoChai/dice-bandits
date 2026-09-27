import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { buildSprites } from './pixelize.js';

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
