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

  it('keeps every props frame one whole object with no hard rectangles and no red on the fence', async () => {
    const violations: string[] = [];
    for (const region of regions) {
      const name = `props-${region}`;
      const atlas = await readAtlas(name);
      const { data, info } = await sharp(join(spritesDir, atlas.image))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      atlas.frames.forEach((frame, frameIndex) => {
        const label = `${name}#${frameIndex}`;
        const opaque = (x: number, y: number): boolean =>
          (data[((frame.y + y) * info.width + frame.x + x) * info.channels + 3] ?? 0) === 255;
        const labels = new Int32Array(frame.w * frame.h).fill(-1);
        const sizes: number[] = [];
        for (let start = 0; start < frame.w * frame.h; start++) {
          const startLabel = labels[start] ?? -1;
          if (startLabel >= 0 || !opaque(start % frame.w, Math.floor(start / frame.w))) continue;
          const id = sizes.length;
          labels[start] = id;
          const queue = [start];
          let size = 0;
          for (let cursor = 0; cursor < queue.length; cursor++) {
            const pixel = queue[cursor] ?? 0;
            size++;
            const x = pixel % frame.w;
            const y = Math.floor(pixel / frame.w);
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= frame.w || ny >= frame.h) continue;
                const next = ny * frame.w + nx;
                const nextLabel = labels[next] ?? -1;
                if (nextLabel < 0 && opaque(nx, ny)) {
                  labels[next] = id;
                  queue.push(next);
                }
              }
          }
          sizes.push(size);
        }
        const significant = sizes.filter((size) => size > 2);
        if (significant.length > 1) {
          // Debris criterion: an extra opaque island only violates when it sits far from
          // the main body (thin genuine features can sample as near-adjacent islands).
          const mainLabel = labels.reduce(
            (best, value) => {
              const size = sizes[value] ?? 0;
              return size > best.size ? { size, label: value } : best;
            },
            { size: 0, label: 0 },
          ).label;
          const mainCells: number[] = [];
          const otherCells: number[] = [];
          for (let index = 0; index < labels.length; index++) {
            const value = labels[index] ?? -1;
            if (value === mainLabel) mainCells.push(index);
            else if (value >= 0 && (sizes[value] ?? 0) > 2) otherCells.push(index);
          }
          const distance = (cell: number): number => {
            const x = cell % frame.w;
            const y = Math.floor(cell / frame.w);
            let best = Number.POSITIVE_INFINITY;
            for (const other of mainCells) {
              const d = Math.max(
                Math.abs((other % frame.w) - x),
                Math.abs(Math.floor(other / frame.w) - y),
              );
              best = Math.min(best, d);
            }
            return best;
          };
          for (const cell of otherCells)
            if (distance(cell) > 4) {
              violations.push(
                `${label}: island of ${significant.length - 1} extra component(s) far from the main body`,
              );
              break;
            }
        }
        let minY = frame.h;
        let maxY = -1;
        let minX = frame.w;
        let maxX = -1;
        for (let y = 0; y < frame.h; y++)
          for (let x = 0; x < frame.w; x++)
            if (opaque(x, y)) {
              minY = Math.min(minY, y);
              maxY = Math.max(maxY, y);
              minX = Math.min(minX, x);
              maxX = Math.max(maxX, x);
            }
        const rowFull = (y: number): boolean => {
          for (let x = minX; x <= maxX; x++) if (!opaque(x, y)) return false;
          return true;
        };
        const colFull = (x: number): boolean => {
          for (let y = minY; y <= maxY; y++) if (!opaque(x, y)) return false;
          return true;
        };
        if (maxY < 0) {
          violations.push(`${label}: no opaque pixels`);
          return;
        }
        if ([rowFull(minY), rowFull(maxY), colFull(minX), colFull(maxX)].every(Boolean))
          violations.push(`${label}: silhouette is a hard rectangle`);
        if (region === 'meadow' && frameIndex === 4) {
          let red = 0;
          for (let y = 0; y < frame.h; y++)
            for (let x = 0; x < frame.w; x++) {
              const offset = ((frame.y + y) * info.width + frame.x + x) * info.channels;
              if (
                (data[offset + 3] ?? 0) !== 0 &&
                (data[offset] ?? 0) === 0xe8 &&
                (data[offset + 1] ?? 0) === 0x41 &&
                (data[offset + 2] ?? 0) === 0x42
              )
                red++;
            }
          if (red > 0) violations.push(`${label}: ${red} key-red fringe pixels`);
        }
      });
    }
    expect(violations, violations.join('; ')).toEqual([]);
  });

  it('renders each props frame at the size and aspect of its whole source object', async () => {
    const tolerance = 18;
    const violations: string[] = [];
    for (const region of regions) {
      const name = `props-${region}`;
      const sourcePath = join(
        resolve(process.cwd(), '../..'),
        `docs/concepts/m4/board/props-${region}.png`,
      );
      const { data: source, info: sourceInfo } = await sharp(sourcePath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const cutout = Buffer.from(source);
      const background = [255, 0, 255] as const;
      const visited = new Uint8Array(sourceInfo.width * sourceInfo.height);
      const queue = new Int32Array(sourceInfo.width * sourceInfo.height);
      let read = 0;
      let write = 0;
      const enqueue = (x: number, y: number): void => {
        if (x < 0 || y < 0 || x >= sourceInfo.width || y >= sourceInfo.height) return;
        const pixel = y * sourceInfo.width + x;
        if (visited[pixel]) return;
        const offset = pixel * 4;
        if (
          Math.max(
            Math.abs((cutout[offset] ?? 0) - background[0]),
            Math.abs((cutout[offset + 1] ?? 0) - background[1]),
            Math.abs((cutout[offset + 2] ?? 0) - background[2]),
          ) > tolerance
        )
          return;
        visited[pixel] = 1;
        queue[write++] = pixel;
      };
      for (let x = 0; x < sourceInfo.width; x++) {
        enqueue(x, 0);
        enqueue(x, sourceInfo.height - 1);
      }
      for (let y = 0; y < sourceInfo.height; y++) {
        enqueue(0, y);
        enqueue(sourceInfo.width - 1, y);
      }
      while (read < write) {
        const pixel = queue[read++] ?? 0;
        const x = pixel % sourceInfo.width;
        const y = Math.floor(pixel / sourceInfo.width);
        cutout[pixel * 4 + 3] = 0;
        enqueue(x - 1, y);
        enqueue(x + 1, y);
        enqueue(x, y - 1);
        enqueue(x, y + 1);
      }
      const seen = new Uint8Array(sourceInfo.width * sourceInfo.height);
      const components: Array<{
        left: number;
        top: number;
        width: number;
        height: number;
        size: number;
      }> = [];
      for (let start = 0; start < seen.length; start++) {
        if ((seen[start] ?? 0) || (cutout[start * 4 + 3] ?? 0) === 0) continue;
        seen[start] = 1;
        const cells = [start];
        let minX = sourceInfo.width;
        let minY = sourceInfo.height;
        let maxX = -1;
        let maxY = -1;
        for (let cursor = 0; cursor < cells.length; cursor++) {
          const pixel = cells[cursor] ?? 0;
          const x = pixel % sourceInfo.width;
          const y = Math.floor(pixel / sourceInfo.width);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= sourceInfo.width || ny >= sourceInfo.height) continue;
              const next = ny * sourceInfo.width + nx;
              if ((seen[next] ?? 0) || (cutout[next * 4 + 3] ?? 0) === 0) continue;
              seen[next] = 1;
              cells.push(next);
            }
        }
        components.push({
          left: minX,
          top: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
          size: cells.length,
        });
      }
      const threshold = Math.ceil(sourceInfo.width * sourceInfo.height * 0.001);
      const selected = components
        .filter((component) => component.size >= threshold)
        .sort((a, b) => a.left - b.left)
        .slice(0, 8);
      expect(selected, `${name} source components`).toHaveLength(8);
      const atlas = await readAtlas(name);
      const { data, info } = await sharp(join(spritesDir, atlas.image))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      atlas.frames.forEach((frame, frameIndex) => {
        const component = selected[frameIndex];
        if (!component) return;
        let minX = frame.w;
        let maxX = -1;
        let minY = frame.h;
        let maxY = -1;
        for (let y = 0; y < frame.h; y++)
          for (let x = 0; x < frame.w; x++) {
            const offset = ((frame.y + y) * info.width + frame.x + x) * info.channels + 3;
            if ((data[offset] ?? 0) !== 255) continue;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        const outW = maxX - minX + 1;
        const outH = maxY - minY + 1;
        const scale = Math.min(30 / component.width, 30 / component.height, 1);
        const expectW = Math.max(1, Math.round(component.width * scale));
        const expectH = Math.max(1, Math.round(component.height * scale));
        const label = `${name}#${frameIndex}`;
        if (outW < expectW * 0.75 || outH < expectH * 0.75)
          violations.push(
            `${label}: frame is ${outW}x${outH} but the whole source object fits at ${expectW}x${expectH}`,
          );
        if (Math.abs(outW / outH - component.width / component.height) > 0.35)
          violations.push(
            `${label}: aspect ${outW}x${outH} diverges from source ${component.width}x${component.height}`,
          );
      });
    }
    expect(violations, violations.join('; ')).toEqual([]);
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
