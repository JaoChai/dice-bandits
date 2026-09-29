import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

type Atlas = {
  image: string;
  cell: { width: number; height: number };
  frames: { x: number; y: number; w: number; h: number }[];
  animations: Record<string, { frames: number[]; fps: number; loop: boolean }>;
};

const spritesDir = resolve(process.cwd(), 'public/sprites');
const classes = ['knight', 'thief', 'mage', 'cleric'] as const;
const expectedAnimations = {
  idle: { frames: [0, 1], fps: 3, loop: true },
  hop: { frames: [2, 3], fps: 8, loop: true },
  attack: { frames: [4, 5, 6], fps: 10, loop: false },
  hurt: { frames: [7], fps: 1, loop: false },
};

async function readAtlas(name: string): Promise<Atlas> {
  return JSON.parse(await readFile(join(spritesDir, `${name}.json`), 'utf8')) as Atlas;
}

describe('hero sprite assets', () => {
  it('ships eight-frame hero and token atlases with the required cells and animations', async () => {
    for (const classId of classes) {
      for (const [kind, cellSize] of [
        ['hero', 64],
        ['token', 32],
      ] as const) {
        const name = `${kind}-${classId}`;
        const atlas = await readAtlas(name);
        expect(atlas.cell).toEqual({ width: cellSize, height: cellSize });
        expect(atlas.frames).toHaveLength(8);
        expect(atlas.animations).toEqual(expectedAnimations);
        const image = await sharp(join(spritesDir, atlas.image)).metadata();
        expect(image.width).toBe(cellSize * 8);
        expect(image.height).toBe(cellSize);
      }
    }
  });

  it('ships one 32x32 portrait frame per class', async () => {
    for (const classId of classes) {
      const atlas = await readAtlas(`portrait-${classId}`);
      expect(atlas.cell).toEqual({ width: 32, height: 32 });
      expect(atlas.frames).toHaveLength(1);
      expect(atlas.animations).toEqual({});
      const image = await sharp(join(spritesDir, atlas.image)).metadata();
      expect(image.width).toBe(32);
      expect(image.height).toBe(32);
      const { data, info } = await sharp(join(spritesDir, atlas.image))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const opaqueRows = Array.from({ length: 32 }, (_, y) => {
        let rowOpaque = false;
        for (let x = 0; x < 32; x++) {
          if ((data[(y * info.width + x) * info.channels + 3] ?? 0) > 0) rowOpaque = true;
        }
        return rowOpaque;
      });
      let opaque = 0;
      for (let index = 3; index < data.length; index += info.channels) {
        if ((data[index] ?? 0) > 0) opaque++;
      }
      expect(opaque / (32 * 32), classId).toBeGreaterThanOrEqual(0.3);
      const first = opaqueRows.indexOf(true);
      const last = opaqueRows.lastIndexOf(true);
      expect(first, classId).toBeGreaterThanOrEqual(0);
      expect(opaqueRows.slice(first, last + 1).every(Boolean), classId).toBe(true);
    }
  });

  it('registers every hero, token, and portrait atlas and keeps every sprite palette-locked', async () => {
    const expected = classes.flatMap((classId) => [
      `hero-${classId}`,
      `token-${classId}`,
      `portrait-${classId}`,
    ]);
    const manifest = JSON.parse(await readFile(join(spritesDir, 'atlases.json'), 'utf8')) as {
      atlases: string[];
    };
    expect(manifest.atlases).toEqual(expect.arrayContaining(expected));
    const toolUrl = pathToFileURL(resolve(process.cwd(), '../../tools/pixelize/pixelize.ts')).href;
    const paths = expected.map((name) => join(spritesDir, `${name}.png`));
    const script = `import { assertPaletteOnly } from ${JSON.stringify(toolUrl)}; await Promise.all(${JSON.stringify(paths)}.map((path) => assertPaletteOnly(path, 'main')));`;
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script]);
  });

  it('keeps total sprite PNG size within the 1.5 MB budget', async () => {
    const files = await readdir(spritesDir);
    const pngs = files.filter((file) => file.endsWith('.png'));
    const bytes = await Promise.all(
      pngs.map(async (file) => (await stat(join(spritesDir, file))).size),
    );
    const total = bytes.reduce((sum, size) => sum + size, 0);
    console.info(`Sprite PNG total: ${total} bytes`);
    expect(total).toBeLessThanOrEqual(1_500_000);
  });
});

describe('board art atlases', () => {
  const regions = ['meadow', 'desert', 'snow', 'volcano'] as const;
  const expected = [
    ...regions.flatMap((region) => [`ground-${region}`, `props-${region}`, `ambient-${region}`]),
    'tiles',
  ];

  it('ships every board atlas with the required frame counts, cell sizes, and animations', async () => {
    const manifest = JSON.parse(await readFile(join(spritesDir, 'atlases.json'), 'utf8')) as {
      atlases: string[];
    };
    expect(manifest.atlases).toEqual(expect.arrayContaining(expected));
    for (const region of regions) {
      const ground = await readAtlas(`ground-${region}`);
      expect(ground.cell).toEqual({ width: 32, height: 32 });
      expect(ground.frames.length).toBeGreaterThanOrEqual(2);
      const props = await readAtlas(`props-${region}`);
      expect(props.cell).toEqual({ width: 32, height: 32 });
      expect(props.frames).toHaveLength(8);
      const ambient = await readAtlas(`ambient-${region}`);
      expect(ambient.cell).toEqual({ width: 32, height: 32 });
      expect(ambient.frames).toHaveLength(4);
      expect(ambient.animations.loop).toEqual({ frames: [0, 1, 2, 3], fps: 6, loop: true });
    }
    const tiles = await readAtlas('tiles');
    expect(tiles.cell).toEqual({ width: 24, height: 24 });
    expect(tiles.frames).toHaveLength(7);
  });

  it('keeps every board atlas palette-locked with no magenta remnants', async () => {
    const toolUrl = pathToFileURL(resolve(process.cwd(), '../../tools/pixelize/pixelize.ts')).href;
    for (const name of expected) {
      const pngPath = join(spritesDir, `${name}.png`);
      const script = `import { assertPaletteOnly } from ${JSON.stringify(toolUrl)}; await assertPaletteOnly(${JSON.stringify(pngPath)}, 'main');`;
      execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script]);
      const { data, info } = await sharp(pngPath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i + 3] === 0) continue;
        expect((data[i] ?? 0) > 200 && (data[i + 1] ?? 0) < 80 && (data[i + 2] ?? 0) > 200).toBe(
          false,
        );
      }
    }
  });

  it('keeps props substantial and inset, and ground tiles seamless on opposite edges', async () => {
    for (const region of regions) {
      const name = `props-${region}`;
      const atlas = await readAtlas(name);
      const { data, info } = await sharp(join(spritesDir, atlas.image))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (const frame of atlas.frames) {
        let opaque = 0;
        let touchesLeft = false,
          touchesRight = false,
          touchesTop = false,
          touchesBottom = false;
        for (let y = 0; y < frame.h; y++)
          for (let x = 0; x < frame.w; x++) {
            if (data[((frame.y + y) * info.width + frame.x + x) * info.channels + 3] === 0)
              continue;
            opaque++;
            if (x === 0) touchesLeft = true;
            if (x === frame.w - 1) touchesRight = true;
            if (y === 0) touchesTop = true;
            if (y === frame.h - 1) touchesBottom = true;
          }
        expect(opaque / (frame.w * frame.h), name).toBeGreaterThanOrEqual(0.15);
        expect([touchesLeft, touchesRight, touchesTop, touchesBottom].every(Boolean), name).toBe(
          false,
        );
      }
      const ground = await readAtlas(`ground-${region}`);
      const tile = await sharp(join(spritesDir, ground.image))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (const frame of ground.frames) {
        for (let y = 0; y < frame.h; y++) {
          const left = ((frame.y + y) * tile.info.width + frame.x) * tile.info.channels;
          const right =
            ((frame.y + y) * tile.info.width + frame.x + frame.w - 1) * tile.info.channels;
          const edgeDifference =
            Math.abs((tile.data[left] ?? 0) - (tile.data[right] ?? 0)) +
            Math.abs((tile.data[left + 1] ?? 0) - (tile.data[right + 1] ?? 0)) +
            Math.abs((tile.data[left + 2] ?? 0) - (tile.data[right + 2] ?? 0));
          expect(edgeDifference).toBeLessThanOrEqual(60);
        }
        for (let x = 0; x < frame.w; x++) {
          const top = (frame.y * tile.info.width + frame.x + x) * tile.info.channels;
          const bottom =
            ((frame.y + frame.h - 1) * tile.info.width + frame.x + x) * tile.info.channels;
          const edgeDifference =
            Math.abs((tile.data[top] ?? 0) - (tile.data[bottom] ?? 0)) +
            Math.abs((tile.data[top + 1] ?? 0) - (tile.data[bottom + 1] ?? 0)) +
            Math.abs((tile.data[top + 2] ?? 0) - (tile.data[bottom + 2] ?? 0));
          expect(edgeDifference).toBeLessThanOrEqual(60);
        }
      }
    }
  });
});
