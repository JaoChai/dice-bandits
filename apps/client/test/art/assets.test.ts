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
    expect(tiles.cell).toEqual({ width: 16, height: 16 });
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

describe('battle art atlases', () => {
  // M5a Task 2 kept the shipped pixel atlases (old ids); the eight cartoon
  // `monster-<newId>` atlases arrive with Task 4 (controller art pass).
  const monsters = [
    'goldSlime',
    'mushroomBandit',
    'lanternGhost',
    'mimic',
    'rockGolem',
    'shadowImp',
  ] as const;
  const backdropRegions = ['meadow', 'desert', 'snow', 'volcano'] as const;
  const expectedMonsterAnimations = {
    idle: { frames: [0, 1], fps: 3, loop: true },
    attack: { frames: [2, 3, 4], fps: 10, loop: false },
    hurt: { frames: [5], fps: 1, loop: false },
  };
  // Pose order shared by every approved monster sheet (documented in
  // tools/pixelize/README.md): idle, idle, attack wind-up, attack strike,
  // recovery, hurt.
  const expectedFxAnimations = {
    slash: { frames: [0, 1, 2], fps: 12, loop: false },
    spark: { frames: [3, 4, 5], fps: 12, loop: false },
    coin: { frames: [6, 7, 8, 9], fps: 10, loop: true },
    dust: { frames: [10, 11, 12], fps: 12, loop: false },
    sparkle: { frames: [13, 14, 15], fps: 12, loop: false },
  };

  function frameBox(
    data: Buffer,
    info: { width: number; channels: number },
    frame: { x: number; y: number; w: number; h: number },
  ): {
    opaque: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    let opaque = 0;
    let minX = frame.w;
    let minY = frame.h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < frame.h; y++)
      for (let x = 0; x < frame.w; x++) {
        if (data[((frame.y + y) * info.width + frame.x + x) * info.channels + 3] === 0) continue;
        opaque++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    return { opaque, minX, minY, maxX, maxY };
  }

  type SourceComponent = { left: number; top: number; width: number; height: number; size: number };

  // Replicates the pixelize grid-grouped extraction on the approved raw sheet so the
  // test can compare each output frame against the whole source pose it came from.
  async function sourcePoseBoxes(file: string, frames: number): Promise<SourceComponent[]> {
    const sourcePath = resolve(process.cwd(), `../../docs/concepts/m4/battle/${file}`);
    const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    });
    const width = info.width;
    const height = info.height;
    const background = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0] as [number, number, number];
    const work = Buffer.from(data);
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let read = 0;
    let write = 0;
    const keyable = (pixel: number): boolean => {
      const offset = pixel * 4;
      return (
        Math.abs((work[offset] ?? 0) - background[0]) <= 18 &&
        Math.abs((work[offset + 1] ?? 0) - background[1]) <= 18 &&
        Math.abs((work[offset + 2] ?? 0) - background[2]) <= 18
      );
    };
    const enqueue = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const pixel = y * width + x;
      if (visited[pixel] || !keyable(pixel)) return;
      visited[pixel] = 1;
      queue[write++] = pixel;
    };
    for (let x = 0; x < width; x++) {
      enqueue(x, 0);
      enqueue(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      enqueue(0, y);
      enqueue(width - 1, y);
    }
    while (read < write) {
      const pixel = queue[read++]!;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      work[pixel * 4 + 3] = 0;
      enqueue(x - 1, y);
      enqueue(x + 1, y);
      enqueue(x, y - 1);
      enqueue(x, y + 1);
    }
    const seen = new Uint8Array(width * height);
    const components: SourceComponent[] = [];
    for (let start = 0; start < width * height; start++) {
      if (seen[start] || work[start * 4 + 3] === 0) continue;
      const cells = [start];
      seen[start] = 1;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let cursor = 0; cursor < cells.length; cursor++) {
        const pixel = cells[cursor]!;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const next = ny * width + nx;
            if (!seen[next] && (work[next * 4 + 3] ?? 0) > 0) {
              seen[next] = 1;
              cells.push(next);
            }
          }
      }
      if (cells.length >= 4)
        components.push({
          left: minX,
          top: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
          size: cells.length,
        });
    }
    const columns: SourceComponent[][] = Array.from({ length: frames }, () => []);
    for (const component of components) {
      const centre = component.left + component.width / 2;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let frame = 0; frame < frames; frame++) {
        const distance = Math.abs(centre - ((frame + 0.5) * width) / frames);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = frame;
        }
      }
      columns[best]!.push(component);
    }
    return columns.map((members) => {
      const left = Math.min(...members.map((component) => component.left));
      const top = Math.min(...members.map((component) => component.top));
      const right = Math.max(...members.map((component) => component.left + component.width - 1));
      const bottom = Math.max(...members.map((component) => component.top + component.height - 1));
      return {
        left,
        top,
        width: right - left + 1,
        height: bottom - top + 1,
        size: members.reduce((sum, component) => sum + component.size, 0),
      };
    });
  }

  it('ships the interim monster atlases with whole-pose frames at the spec cell sizes', async () => {
    for (const monster of monsters) {
      const cellSize = monster === 'rockGolem' || monster === 'mimic' ? 80 : 64;
      const name = `monster-${monster}`;
      const atlas = await readAtlas(name);
      expect(atlas.cell, name).toEqual({ width: cellSize, height: cellSize });
      expect(atlas.frames, name).toHaveLength(6);
      expect(atlas.animations, name).toEqual(expectedMonsterAnimations);
      const image = await sharp(join(spritesDir, atlas.image)).metadata();
      expect(image.width, name).toBe(cellSize * 6);
      expect(image.height, name).toBe(cellSize);
    }
  });

  it('keeps every monster frame substantial, uncropped, and shaped like its source pose', async () => {
    const violations: string[] = [];
    for (const monster of monsters) {
      const cellSize = monster === 'rockGolem' || monster === 'mimic' ? 80 : 64;
      const name = `monster-${monster}`;
      const atlas = await readAtlas(name);
      const { data, info } = await sharp(join(spritesDir, atlas.image))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const poses = await sourcePoseBoxes(`${name}.png`, 6);
      expect(poses, name).toHaveLength(6);
      const sheetScale = Math.min(
        ...poses.flatMap((pose) => [(cellSize - 2) / pose.width, (cellSize - 2) / pose.height]),
      );
      const boxes = atlas.frames.map((frame) => frameBox(data, info, frame));
      atlas.frames.forEach((frame, frameIndex) => {
        const box = boxes[frameIndex]!;
        const pose = poses[frameIndex]!;
        const label = `${name}#${frameIndex}`;
        if (box.opaque < cellSize * cellSize * 0.04)
          violations.push(`${label}: only ${box.opaque} opaque pixels`);
        // Every monster pose uses the scale constrained by the widest/tallest pose
        // across the sheet; this checks content without rewarding per-frame zoom.
        const expectedOpaque = pose.size * sheetScale * sheetScale;
        if (box.opaque < expectedOpaque * 0.6)
          violations.push(
            `${label}: ${box.opaque} opaque pixels, expected >= ${Math.round(expectedOpaque * 0.6)} from source pose area (lost pose content)`,
          );
        if (box.minX < 1 || box.minY < 1 || box.maxX > frame.w - 2)
          violations.push(`${label}: pose touches the left/top/right cell border (cropped)`);
        const expectW = Math.max(1, Math.round(pose.width * sheetScale));
        const expectH = Math.max(1, Math.round(pose.height * sheetScale));
        const outW = box.maxX - box.minX + 1;
        const outH = box.maxY - box.minY + 1;
        if (outW < expectW * 0.7 || outH < expectH * 0.7)
          violations.push(
            `${label}: frame is ${outW}x${outH} but the whole source pose fits at ${expectW}x${expectH}`,
          );
        if (outW > expectW * 1.2 + 2 || outH > expectH * 1.2 + 2)
          violations.push(
            `${label}: ${outW}x${outH} zooms beyond shared-scale ${expectW}x${expectH}`,
          );
        if (Math.abs(outW / outH - pose.width / pose.height) > 0.35)
          violations.push(
            `${label}: aspect ${outW}x${outH} diverges from source pose ${pose.width}x${pose.height}`,
          );
      });
    }
    expect(violations, violations.join('; ')).toEqual([]);
  });

  it('registers every battle atlas in the manifest and keeps them all palette-locked', async () => {
    const expected = [
      ...monsters.map((monster) => `monster-${monster}`),
      ...backdropRegions.map((region) => `backdrop-${region}`),
      'fx',
      'cards',
    ];
    const manifest = JSON.parse(await readFile(join(spritesDir, 'atlases.json'), 'utf8')) as {
      atlases: string[];
    };
    expect(manifest.atlases).toEqual(expect.arrayContaining(expected));
    const toolUrl = pathToFileURL(resolve(process.cwd(), '../../tools/pixelize/pixelize.ts')).href;
    for (const name of ['fx', 'cards', ...monsters.map((monster) => `monster-${monster}`)]) {
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
    for (const region of backdropRegions) {
      const pngPath = join(spritesDir, `backdrop-${region}.png`);
      const script = `import { assertPaletteOnly } from ${JSON.stringify(toolUrl)}; await assertPaletteOnly(${JSON.stringify(pngPath)}, 'backdrop');`;
      execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script]);
    }
  });

  it('leaves no grey background fringe on monster sprite edges', async () => {
    for (const monster of monsters) {
      const name = `monster-${monster}`;
      const atlas = await readAtlas(name);
      const { data, info } = await sharp(join(spritesDir, atlas.image))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      atlas.frames.forEach((frame, frameIndex) => {
        const opaque = (x: number, y: number): boolean =>
          (data[((frame.y + y) * info.width + frame.x + x) * info.channels + 3] ?? 0) === 255;
        for (let y = 0; y < frame.h; y++)
          for (let x = 0; x < frame.w; x++) {
            if (!opaque(x, y)) continue;
            const onBoundary =
              (x > 0 && !opaque(x - 1, y)) ||
              (x < frame.w - 1 && !opaque(x + 1, y)) ||
              (y > 0 && !opaque(x, y - 1)) ||
              (y < frame.h - 1 && !opaque(x, y + 1));
            if (!onBoundary) continue;
            const offset = ((frame.y + y) * info.width + frame.x + x) * info.channels;
            const [r, g, b] = [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0];
            const isBackgroundGrey =
              Math.abs(r - 178) <= 20 && Math.abs(g - 178) <= 20 && Math.abs(b - 176) <= 20;
            expect(isBackgroundGrey, `${name}#${frameIndex} grey fringe at ${x},${y}`).toBe(false);
          }
      });
    }
  });

  it('ships the 16-frame fx atlas with slash, spark, coin, dust, and sparkle animations', async () => {
    const atlas = await readAtlas('fx');
    expect(atlas.cell).toEqual({ width: 64, height: 64 });
    expect(atlas.frames).toHaveLength(16);
    expect(atlas.animations).toEqual(expectedFxAnimations);
    const image = await sharp(join(spritesDir, atlas.image)).metadata();
    expect(image.width).toBe(64 * 16);
    expect(image.height).toBe(64);
    const { data, info } = await sharp(join(spritesDir, atlas.image))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    atlas.frames.forEach((frame, frameIndex) => {
      // smallest approved fx frame (sparkle stage 1) still fills a visible cluster
      expect(frameBox(data, info, frame).opaque, `fx#${frameIndex}`).toBeGreaterThanOrEqual(8);
    });
  });

  it('keeps coin and dust FX free of key-red pixels on transparency boundaries', async () => {
    const atlas = await readAtlas('fx');
    const { data, info } = await sharp(join(spritesDir, atlas.image))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const violations: string[] = [];
    for (let frameIndex = 6; frameIndex <= 12; frameIndex++) {
      const frame = atlas.frames[frameIndex]!;
      for (let y = 0; y < frame.h; y++)
        for (let x = 0; x < frame.w; x++) {
          const offset = ((frame.y + y) * info.width + frame.x + x) * info.channels;
          if (
            data[offset + 3] !== 255 ||
            data[offset] !== 0xe8 ||
            data[offset + 1] !== 0x41 ||
            data[offset + 2] !== 0x42
          )
            continue;
          if (
            [
              [x - 1, y],
              [x + 1, y],
              [x, y - 1],
              [x, y + 1],
            ].some(
              ([nx, ny]) =>
                nx! < 0 ||
                ny! < 0 ||
                nx! >= frame.w ||
                ny! >= frame.h ||
                data[((frame.y + ny!) * info.width + frame.x + nx!) * info.channels + 3] === 0,
            )
          )
            violations.push(`fx#${frameIndex} key-red fringe at ${x},${y}`);
        }
    }
    expect(violations, violations.join('; ')).toEqual([]);
  });

  it('keeps coin spin frames at stable height with front, three-quarter, edge, three-quarter widths', async () => {
    const atlas = await readAtlas('fx');
    const { data, info } = await sharp(join(spritesDir, atlas.image))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const boxes = atlas.frames.slice(6, 10).map((frame) => frameBox(data, info, frame));
    const heights = boxes.map((box) => box.maxY - box.minY + 1);
    const widths = boxes.map((box) => box.maxX - box.minX + 1);
    expect(
      Math.max(...heights) - Math.min(...heights),
      `coin heights ${heights}`,
    ).toBeLessThanOrEqual(5);
    expect(widths[0], `coin widths ${widths}`).toBeGreaterThan(widths[1]!);
    expect(widths[1], `coin widths ${widths}`).toBeGreaterThan(widths[2]!);
    expect(Math.abs(widths[1]! - widths[3]!), `coin widths ${widths}`).toBeLessThanOrEqual(3);
  });

  it('ships the card atlas with the six faces in fixed order: attack, strike, secret, defend, counter, item', async () => {
    // Frame index order is the contract BootScene's battle UI will rely on:
    // 0 attack (sword), 1 strike (lightning), 2 secret (?), 3 defend (shield),
    // 4 counter (sword + parry arc), 5 item frame (blank).
    const cardNames = ['attack', 'strike', 'secret', 'defend', 'counter', 'item'] as const;
    const atlas = await readAtlas('cards');
    expect(atlas.cell).toEqual({ width: 32, height: 32 });
    expect(atlas.frames).toHaveLength(cardNames.length);
    expect(atlas.animations).toEqual({});
    const image = await sharp(join(spritesDir, atlas.image)).metadata();
    expect(image.width).toBe(32 * cardNames.length);
    expect(image.height).toBe(32);
    const { data, info } = await sharp(join(spritesDir, atlas.image))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    cardNames.forEach((cardName, frameIndex) => {
      const frame = atlas.frames[frameIndex]!;
      const box = frameBox(data, info, frame);
      // a full card face fills most of its cell
      expect(box.opaque / (frame.w * frame.h), cardName).toBeGreaterThanOrEqual(0.45);
      const outW = box.maxX - box.minX + 1;
      const outH = box.maxY - box.minY + 1;
      expect(outH / outW, cardName).toBeGreaterThan(1.1);
      expect(outH / outW, cardName).toBeLessThan(1.6);
    });
  });

  it('ships four 640x360 opaque backdrop atlases locked to the backdrop palette', async () => {
    for (const region of backdropRegions) {
      const name = `backdrop-${region}`;
      const atlas = await readAtlas(name);
      expect(atlas.cell, name).toEqual({ width: 640, height: 360 });
      expect(atlas.frames, name).toHaveLength(1);
      expect(atlas.animations, name).toEqual({});
      const { data, info } = await sharp(join(spritesDir, atlas.image))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(info.width, name).toBe(640);
      expect(info.height, name).toBe(360);
      const colours = new Set<string>();
      let nonOpaque = 0;
      let firstAt = -1;
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i + 3] !== 255) {
          nonOpaque++;
          if (firstAt === -1) firstAt = i / info.channels;
        }
        colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
      expect({ nonOpaque, firstAt }, name).toEqual({ nonOpaque: 0, firstAt: -1 });
      expect(colours.size, `${name}: degenerate backdrop`).toBeGreaterThanOrEqual(8);
    }
  });
});
