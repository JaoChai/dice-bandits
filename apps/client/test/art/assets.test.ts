import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

type Atlas = {
  image: string;
  cell: { width: number; height: number };
  frames: unknown[];
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
