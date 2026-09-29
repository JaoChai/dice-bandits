import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

type Rect = { left: number; top: number; width: number; height: number };
type Sprite = {
  output: string;
  width: number;
  height: number;
  source?: { file: string; rect: Rect };
  icon?: string;
  region?: string;
};
type Config = { sprites: Sprite[]; icons?: string[] };
type BuildOptions = {
  configPath: string;
  outDir: string;
  writeContactSheet?: boolean;
};

const toolDir = dirname(new URL(import.meta.url).pathname);
const backgroundTolerance = 18;
const iconSize = 16;
const iconsPerRow = 4;
const contactCellWidth = 144;
const contactCellHeight = 132;

function absoluteFromConfig(configPath: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(dirname(configPath), filePath);
}

function colorDistance(a: number, b: number, c: number, color: number[]): number {
  return (a - color[0]) ** 2 + (b - color[1]) ** 2 + (c - color[2]) ** 2;
}

function nearestPaletteColor(
  red: number,
  green: number,
  blue: number,
  palette: number[][],
): number[] {
  let selected = palette[0];
  let distance = Number.POSITIVE_INFINITY;
  for (const color of palette) {
    const nextDistance = colorDistance(red, green, blue, color);
    if (nextDistance < distance) {
      selected = color;
      distance = nextDistance;
    }
  }
  return selected;
}

async function readPalette(palettePath: string): Promise<number[][]> {
  const values = JSON.parse(await readFile(palettePath, 'utf8')) as string[];
  if (values.length !== 32 || values.some((value) => !/^#[0-9a-f]{6}$/i.test(value))) {
    throw new Error(`Palette must contain exactly 32 six-digit hex colors: ${palettePath}`);
  }
  return values.map((value) =>
    [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)),
  );
}

async function removeFloodBackground(
  input: Buffer,
  width: number,
  height: number,
  backgroundColor?: [number, number, number],
  tolerance = backgroundTolerance,
): Promise<Buffer> {
  const data = Buffer.from(input);
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const background = backgroundColor ?? [data[0], data[1], data[2]];
  let read = 0;
  let write = 0;
  const enqueue = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = y * width + x;
    if (visited[pixel]) return;
    const offset = pixel * 4;
    if (
      Math.max(
        Math.abs(data[offset] - background[0]),
        Math.abs(data[offset + 1] - background[1]),
        Math.abs(data[offset + 2] - background[2]),
      ) > tolerance
    )
      return;
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
    const pixel = queue[read++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    data[pixel * 4 + 3] = 0;
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }
  return data;
}

function areaAverage(
  data: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Buffer {
  const output = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let targetY = 0; targetY < targetHeight; targetY++) {
    const sourceTop = (targetY * sourceHeight) / targetHeight;
    const sourceBottom = ((targetY + 1) * sourceHeight) / targetHeight;
    for (let targetX = 0; targetX < targetWidth; targetX++) {
      const sourceLeft = (targetX * sourceWidth) / targetWidth;
      const sourceRight = ((targetX + 1) * sourceWidth) / targetWidth;
      let totalAlpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sourceY = Math.floor(sourceTop); sourceY < Math.ceil(sourceBottom); sourceY++) {
        const weightY = Math.min(sourceY + 1, sourceBottom) - Math.max(sourceY, sourceTop);
        for (let sourceX = Math.floor(sourceLeft); sourceX < Math.ceil(sourceRight); sourceX++) {
          const weightX = Math.min(sourceX + 1, sourceRight) - Math.max(sourceX, sourceLeft);
          const weight = weightX * weightY;
          const offset = (sourceY * sourceWidth + sourceX) * 4;
          const alpha = data[offset + 3] / 255;
          totalAlpha += alpha * weight;
          red += data[offset] * alpha * weight;
          green += data[offset + 1] * alpha * weight;
          blue += data[offset + 2] * alpha * weight;
        }
      }
      const targetOffset = (targetY * targetWidth + targetX) * 4;
      const area = (sourceRight - sourceLeft) * (sourceBottom - sourceTop);
      output[targetOffset + 3] = Math.round((totalAlpha / area) * 255);
      if (totalAlpha > 0) {
        output[targetOffset] = Math.round(red / totalAlpha);
        output[targetOffset + 1] = Math.round(green / totalAlpha);
        output[targetOffset + 2] = Math.round(blue / totalAlpha);
      }
    }
  }
  return output;
}

async function processCrop(
  sprite: Sprite,
  configPath: string,
  palette: number[][],
): Promise<Buffer> {
  if (!sprite.source) throw new Error(`Missing source crop for ${sprite.output}`);
  const inputPath = absoluteFromConfig(configPath, sprite.source.file);
  const { data, info } = await sharp(inputPath)
    .extract(sprite.source.rect)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cutout = await removeFloodBackground(data, info.width, info.height);
  const shrinkScale = Math.min(
    1,
    (sprite.width * 2) / info.width,
    (sprite.height * 2) / info.height,
  );
  const preWidth = Math.max(1, Math.floor(info.width * shrinkScale));
  const preHeight = Math.max(1, Math.floor(info.height * shrinkScale));
  const preShrink = areaAverage(cutout, info.width, info.height, preWidth, preHeight);
  const target2x = await sharp(preShrink, {
    raw: { width: preWidth, height: preHeight, channels: 4 },
  })
    .png()
    .toBuffer();
  const scaled = await sharp(target2x)
    .resize(sprite.width, sprite.height, {
      fit: 'contain',
      kernel: 'nearest',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer();
  for (let index = 0; index < scaled.length; index += 4) {
    if (scaled[index + 3] < 128) {
      scaled[index] = 0;
      scaled[index + 1] = 0;
      scaled[index + 2] = 0;
      scaled[index + 3] = 0;
    } else {
      const nearest = nearestPaletteColor(
        scaled[index],
        scaled[index + 1],
        scaled[index + 2],
        palette,
      );
      scaled[index] = nearest[0];
      scaled[index + 1] = nearest[1];
      scaled[index + 2] = nearest[2];
      scaled[index + 3] = 255;
    }
  }
  return sharp(scaled, { raw: { width: sprite.width, height: sprite.height, channels: 4 } })
    .png()
    .toBuffer();
}

export type SheetEntry = {
  name: string;
  source: string;
  frames: number;
  cell: { width: number; height: number };
  palette?: 'main' | 'backdrop';
  select?: number[];
  split?: 'components';
  background?: { color: [number, number, number]; tolerance: number };
  ground?: boolean;
  animations: Record<string, { from: number; to: number; fps: number; loop: boolean }>;
  anchor?: 'feet' | 'center';
};

export type Atlas = {
  image: string;
  cell: { width: number; height: number };
  frames: { x: number; y: number; w: number; h: number }[];
  anchor: { x: number; y: number };
  animations: Record<string, { frames: number[]; fps: number; loop: boolean }>;
};

export async function assertPaletteOnly(
  pngPath: string,
  paletteName: 'main' | 'backdrop',
): Promise<void> {
  const palettePath = join(
    toolDir,
    paletteName === 'main' ? 'palette.json' : 'palette-backdrop.json',
  );
  const palette = new Set(
    (await readFile(palettePath, 'utf8')).toLowerCase().match(/#[0-9a-f]{6}/g),
  );
  if (palette.size !== 32) throw new Error(`Palette must contain 32 colors: ${palettePath}`);
  const { data, info } = await sharp(pngPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels;
      const alpha = data[offset + 3];
      if (alpha !== 0 && alpha !== 255) {
        throw new Error(`Invalid alpha ${alpha} at (${x}, ${y}) in ${pngPath}`);
      }
      if (alpha === 255) {
        const pixel = `#${[data[offset], data[offset + 1], data[offset + 2]]
          .map((channel) => channel.toString(16).padStart(2, '0'))
          .join('')}`;
        if (!palette.has(pixel))
          throw new Error(
            `Color ${pixel} outside ${paletteName} palette at (${x}, ${y}) in ${pngPath}`,
          );
      }
    }
  }
}

type Component = {
  pixels: Buffer;
  width: number;
  height: number;
  left: number;
  top: number;
  size: number;
};

function foregroundComponents(pixels: Buffer, width: number, height: number): Component[] {
  const seen = new Uint8Array(width * height);
  const components: Component[] = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || pixels[start * 4 + 3] === 0) continue;
    const queue = [start];
    seen[start] = 1;
    let minX = width,
      minY = height,
      maxX = -1,
      maxY = -1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const pixel = queue[cursor];
      if (pixel === undefined) continue;
      const x = pixel % width,
        y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (!seen[next] && pixels[next * 4 + 3] > 0) {
            seen[next] = 1;
            queue.push(next);
          }
        }
    }
    const w = maxX - minX + 1,
      h = maxY - minY + 1;
    const crop = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const from = ((minY + y) * width + minX + x) * 4;
        pixels.copy(crop, (y * w + x) * 4, from, from + 4);
      }
    }
    components.push({
      pixels: crop,
      width: w,
      height: h,
      left: minX,
      top: minY,
      size: queue.length,
    });
  }
  return components;
}

async function buildSpecialSheet(
  entry: SheetEntry,
  sourcePath: string,
  outDir: string,
): Promise<Atlas> {
  const { data: source, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const palette = await readPalette(
    join(toolDir, entry.palette === 'backdrop' ? 'palette-backdrop.json' : 'palette.json'),
  );
  const sourceFrames: Array<{ pixels: Buffer; width: number; height: number }> = [];
  if (entry.ground) {
    const side = Math.min(info.width, info.height);
    for (let frame = 0; frame < entry.frames; frame++) {
      const left = Math.floor((frame * (info.width - side)) / Math.max(entry.frames - 1, 1));
      const raw = await sharp(sourcePath)
        .extract({ left, top: Math.floor((info.height - side) / 2), width: side, height: side })
        .resize(entry.cell.width, entry.cell.height, { fit: 'fill', kernel: 'lanczos3' })
        .ensureAlpha()
        .raw()
        .toBuffer();
      sourceFrames.push({ pixels: raw, width: entry.cell.width, height: entry.cell.height });
    }
  } else {
    const cutout = await removeFloodBackground(
      source,
      info.width,
      info.height,
      entry.background?.color,
      entry.background?.tolerance ?? backgroundTolerance,
    );
    const all = foregroundComponents(cutout, info.width, info.height);
    const threshold = Math.ceil(info.width * info.height * 0.001);
    const substantial = all.filter((component) => component.size >= threshold);
    const specks = all.filter((component) => component.size < threshold);
    if (substantial.length < entry.frames)
      throw new Error(
        `Expected ${entry.frames} components in ${entry.name}, found ${substantial.length}`,
      );
    const selected = substantial.sort((a, b) => a.left - b.left).slice(0, entry.frames);
    const groups = selected.map((component) => [component]);
    for (const speck of specks) {
      let nearest = 0,
        distance = Number.POSITIVE_INFINITY;
      selected.forEach((component, index) => {
        const dx = speck.left + speck.width / 2 - (component.left + component.width / 2);
        const dy = speck.top + speck.height / 2 - (component.top + component.height / 2);
        const next = dx * dx + dy * dy;
        if (next < distance) {
          distance = next;
          nearest = index;
        }
      });
      groups[nearest]?.push(speck);
    }
    for (const group of groups) {
      const left = Math.min(...group.map((c) => c.left)),
        top = Math.min(...group.map((c) => c.top));
      const right = Math.max(...group.map((c) => c.left + c.width)),
        bottom = Math.max(...group.map((c) => c.top + c.height));
      const width = right - left,
        height = bottom - top,
        pixels = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++)
        cutout.copy(
          pixels,
          y * width * 4,
          ((top + y) * info.width + left) * 4,
          ((top + y) * info.width + right) * 4,
        );
      sourceFrames.push({ pixels, width, height });
    }
  }
  const processed: Buffer[] = [];
  for (const frame of sourceFrames) {
    const inset = entry.split === 'components' ? 1 : 0;
    const scaled = await sharp(frame.pixels, {
      raw: { width: frame.width, height: frame.height, channels: 4 },
    })
      .resize(entry.cell.width - inset * 2, entry.cell.height - inset * 2, {
        fit: 'contain',
        kernel: 'nearest',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    const resized = await sharp({
      create: {
        width: entry.cell.width,
        height: entry.cell.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: scaled, left: inset, top: inset }])
      .ensureAlpha()
      .raw()
      .toBuffer();
    for (let i = 0; i < resized.length; i += 4) {
      if (resized[i + 3] < 128) resized.fill(0, i, i + 4);
      else {
        const color = nearestPaletteColor(
          resized[i] ?? 0,
          resized[i + 1] ?? 0,
          resized[i + 2] ?? 0,
          palette,
        );
        resized[i] = color[0] ?? 0;
        resized[i + 1] = color[1] ?? 0;
        resized[i + 2] = color[2] ?? 0;
        resized[i + 3] = 255;
      }
    }
    if (entry.split === 'components') {
      let opaque = 0;
      for (let i = 3; i < resized.length; i += 4) if (resized[i] === 255) opaque++;
      for (
        let pass = 0;
        opaque / (entry.cell.width * entry.cell.height) < 0.15 && pass < 4;
        pass++
      ) {
        const previous = Buffer.from(resized);
        for (let y = 1; y < entry.cell.height - 1; y++)
          for (let x = 1; x < entry.cell.width - 1; x++) {
            const offset = (y * entry.cell.width + x) * 4;
            if (previous[offset + 3] === 255) continue;
            let found = -1;
            for (let dy = -1; dy <= 1 && found < 0; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const neighbor = ((y + dy) * entry.cell.width + x + dx) * 4;
                if (previous[neighbor + 3] === 255) {
                  found = neighbor;
                  break;
                }
              }
            if (found >= 0) {
              resized.copy(resized, offset, found, found + 4);
              opaque++;
            }
          }
      }
    }
    if (entry.ground) {
      for (let y = 0; y < entry.cell.height; y++) {
        const a = y * entry.cell.width * 4,
          b = (y * entry.cell.width + entry.cell.width - 1) * 4;
        const color = nearestPaletteColor(
          Math.round(((resized[a] ?? 0) + (resized[b] ?? 0)) / 2),
          Math.round(((resized[a + 1] ?? 0) + (resized[b + 1] ?? 0)) / 2),
          Math.round(((resized[a + 2] ?? 0) + (resized[b + 2] ?? 0)) / 2),
          palette,
        );
        for (const x of [a, b]) {
          resized[x] = color[0] ?? 0;
          resized[x + 1] = color[1] ?? 0;
          resized[x + 2] = color[2] ?? 0;
        }
      }
      for (let x = 0; x < entry.cell.width; x++) {
        const a = x * 4,
          b = ((entry.cell.height - 1) * entry.cell.width + x) * 4;
        const color = nearestPaletteColor(
          Math.round(((resized[a] ?? 0) + (resized[b] ?? 0)) / 2),
          Math.round(((resized[a + 1] ?? 0) + (resized[b + 1] ?? 0)) / 2),
          Math.round(((resized[a + 2] ?? 0) + (resized[b + 2] ?? 0)) / 2),
          palette,
        );
        for (const y of [a, b]) {
          resized[y] = color[0] ?? 0;
          resized[y + 1] = color[1] ?? 0;
          resized[y + 2] = color[2] ?? 0;
        }
      }
    }
    if ((entry.anchor ?? 'feet') === 'feet') {
      let lowest = -1;
      for (let y = entry.cell.height - 1; y >= 0 && lowest < 0; y--)
        for (let x = 0; x < entry.cell.width; x++)
          if (resized[(y * entry.cell.width + x) * 4 + 3] === 255) {
            lowest = y;
            break;
          }
      if (lowest >= 0 && lowest < entry.cell.height - 1) {
        const shift = (entry.cell.height - 1 - lowest) * entry.cell.width * 4;
        const aligned = Buffer.alloc(resized.length);
        resized.copy(aligned, shift, 0, resized.length - shift);
        processed.push(aligned);
        continue;
      }
    }
    processed.push(resized);
  }
  const atlasPixels = Buffer.alloc(processed.length * entry.cell.width * entry.cell.height * 4);
  processed.forEach((frame, index) => {
    for (let y = 0; y < entry.cell.height; y++)
      frame.copy(
        atlasPixels,
        (y * processed.length * entry.cell.width + index * entry.cell.width) * 4,
        y * entry.cell.width * 4,
        (y + 1) * entry.cell.width * 4,
      );
  });
  const animations: Atlas['animations'] = {};
  for (const [name, animation] of Object.entries(entry.animations))
    animations[name] = {
      frames: Array.from(
        { length: animation.to - animation.from + 1 },
        (_, i) => animation.from + i,
      ),
      fps: animation.fps,
      loop: animation.loop,
    };
  const atlas: Atlas = {
    image: `${entry.name}.png`,
    cell: entry.cell,
    frames: processed.map((_, index) => ({
      x: index * entry.cell.width,
      y: 0,
      w: entry.cell.width,
      h: entry.cell.height,
    })),
    anchor: {
      x: Math.floor(entry.cell.width / 2),
      y:
        (entry.anchor ?? 'feet') === 'feet' ? entry.cell.height : Math.floor(entry.cell.height / 2),
    },
    animations,
  };
  await mkdir(outDir, { recursive: true });
  await sharp(atlasPixels, {
    raw: { width: processed.length * entry.cell.width, height: entry.cell.height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toFile(join(outDir, atlas.image));
  await writeFile(join(outDir, `${entry.name}.json`), `${JSON.stringify(atlas, null, 2)}\n`);
  const manifestPath = join(outDir, 'atlases.json');
  let names: string[] = [];
  try {
    const existing = JSON.parse(await readFile(manifestPath, 'utf8')) as { atlases?: unknown };
    if (Array.isArray(existing.atlases))
      names = existing.atlases.filter((name): name is string => typeof name === 'string');
  } catch {
    /* first atlas */
  }
  await writeFile(
    manifestPath,
    `${JSON.stringify({ atlases: [...new Set([...names, entry.name])].sort() }, null, 2)}\n`,
  );
  return atlas;
}

export async function buildSheet(
  entry: SheetEntry,
  baseDir: string,
  outDir: string,
): Promise<Atlas> {
  if (!Number.isInteger(entry.frames) || entry.frames < 1)
    throw new Error('frames must be a positive integer');
  if (
    !Number.isInteger(entry.cell.width) ||
    entry.cell.width < 1 ||
    !Number.isInteger(entry.cell.height) ||
    entry.cell.height < 1
  ) {
    throw new Error('cell dimensions must be positive integers');
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(entry.name))
    throw new Error(`Invalid sheet name: ${entry.name}`);
  const sourcePath = isAbsolute(entry.source) ? entry.source : resolve(baseDir, entry.source);
  if (entry.ground || entry.split === 'components')
    return buildSpecialSheet(entry, sourcePath, outDir);
  const { data: source, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width < entry.frames)
    throw new Error(`Source width must provide ${entry.frames} frames: ${sourcePath}`);
  const selectedFrames = entry.select ?? Array.from({ length: entry.frames }, (_, i) => i);
  if (
    selectedFrames.length === 0 ||
    selectedFrames.some(
      (index, position) =>
        !Number.isInteger(index) ||
        index < 0 ||
        index >= entry.frames ||
        selectedFrames.indexOf(index) !== position,
    )
  ) {
    throw new Error(`select must contain unique source frame indices in range for ${entry.name}`);
  }
  const frames: Array<{ pixels: Buffer; width: number }> = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let frameIndex = 0; frameIndex < entry.frames; frameIndex++) {
    const left = Math.floor((frameIndex * info.width) / entry.frames);
    const right = Math.floor(((frameIndex + 1) * info.width) / entry.frames);
    const frameWidth = right - left;
    const framePixels = Buffer.alloc(frameWidth * info.height * 4);
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < frameWidth; x++) {
        const from = (y * info.width + left + x) * info.channels;
        const to = (y * frameWidth + x) * 4;
        source.copy(framePixels, to, from, from + 4);
      }
    }
    const cutout = await removeFloodBackground(
      framePixels,
      frameWidth,
      info.height,
      entry.background?.color,
      entry.background?.tolerance ?? backgroundTolerance,
    );
    frames.push({ pixels: cutout, width: frameWidth });
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < frameWidth; x++) {
        if (cutout[(y * frameWidth + x) * 4 + 3] > 0) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
  }
  const outputFrames = selectedFrames.length;
  if (maxX < minX || maxY < minY) throw new Error(`No foreground pixels found in ${sourcePath}`);
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const paletteFile = entry.palette === 'backdrop' ? 'palette-backdrop.json' : 'palette.json';
  const palette = await readPalette(join(toolDir, paletteFile));
  const processed: Buffer[] = [];
  for (const frameIndex of selectedFrames) {
    const frame = frames[frameIndex];
    const visibleWidth = Math.min(cropWidth, frame.width - minX);
    const crop = Buffer.alloc(cropWidth * cropHeight * 4);
    for (let y = 0; y < cropHeight; y++) {
      const from = ((minY + y) * frame.width + minX) * 4;
      frame.pixels.copy(crop, y * cropWidth * 4, from, from + Math.max(visibleWidth, 0) * 4);
    }
    const scale = Math.min(
      1,
      (entry.cell.width * 2) / cropWidth,
      (entry.cell.height * 2) / cropHeight,
    );
    const preWidth = Math.max(1, Math.floor(cropWidth * scale));
    const preHeight = Math.max(1, Math.floor(cropHeight * scale));
    const shrunk = areaAverage(crop, cropWidth, cropHeight, preWidth, preHeight);
    const resized = await sharp(shrunk, {
      raw: { width: preWidth, height: preHeight, channels: 4 },
    })
      .resize(entry.cell.width, entry.cell.height, {
        fit: 'contain',
        kernel: 'nearest',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .raw()
      .toBuffer();
    for (let index = 0; index < resized.length; index += 4) {
      if (resized[index + 3] < 128) {
        resized.fill(0, index, index + 4);
      } else {
        const nearest = nearestPaletteColor(
          resized[index],
          resized[index + 1],
          resized[index + 2],
          palette,
        );
        resized[index] = nearest[0];
        resized[index + 1] = nearest[1];
        resized[index + 2] = nearest[2];
        resized[index + 3] = 255;
      }
    }
    if ((entry.anchor ?? 'feet') === 'feet') {
      let lowest = -1;
      for (let y = entry.cell.height - 1; y >= 0 && lowest < 0; y--) {
        for (let x = 0; x < entry.cell.width; x++) {
          if (resized[(y * entry.cell.width + x) * 4 + 3] === 255) {
            lowest = y;
            break;
          }
        }
      }
      if (lowest >= 0 && lowest < entry.cell.height - 1) {
        const shift = (entry.cell.height - 1 - lowest) * entry.cell.width * 4;
        const aligned = Buffer.alloc(resized.length);
        resized.copy(aligned, shift, 0, resized.length - shift);
        processed.push(aligned);
        continue;
      }
    }
    processed.push(resized);
  }
  const atlasPixels = Buffer.alloc(outputFrames * entry.cell.width * entry.cell.height * 4);
  processed.forEach((frame, index) => {
    for (let y = 0; y < entry.cell.height; y++) {
      frame.copy(
        atlasPixels,
        (y * outputFrames * entry.cell.width + index * entry.cell.width) * 4,
        y * entry.cell.width * 4,
        (y + 1) * entry.cell.width * 4,
      );
    }
  });
  const animations: Atlas['animations'] = {};
  for (const [name, animation] of Object.entries(entry.animations)) {
    if (
      !Number.isInteger(animation.from) ||
      !Number.isInteger(animation.to) ||
      animation.from < 0 ||
      animation.to < animation.from ||
      animation.to >= outputFrames ||
      !Number.isFinite(animation.fps) ||
      animation.fps <= 0
    ) {
      throw new Error(`Invalid animation ${name} in sheet ${entry.name}`);
    }
    animations[name] = {
      frames: Array.from(
        { length: animation.to - animation.from + 1 },
        (_, i) => animation.from + i,
      ),
      fps: animation.fps,
      loop: animation.loop,
    };
  }
  const atlas: Atlas = {
    image: `${entry.name}.png`,
    cell: { width: entry.cell.width, height: entry.cell.height },
    frames: Array.from({ length: outputFrames }, (_, index) => ({
      x: index * entry.cell.width,
      y: 0,
      w: entry.cell.width,
      h: entry.cell.height,
    })),
    anchor: {
      x: Math.floor(entry.cell.width / 2),
      y:
        (entry.anchor ?? 'feet') === 'feet' ? entry.cell.height : Math.floor(entry.cell.height / 2),
    },
    animations,
  };
  await mkdir(outDir, { recursive: true });
  await sharp(atlasPixels, {
    raw: { width: outputFrames * entry.cell.width, height: entry.cell.height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toFile(join(outDir, atlas.image));
  await writeFile(join(outDir, `${entry.name}.json`), `${JSON.stringify(atlas, null, 2)}\n`);
  const manifestPath = join(outDir, 'atlases.json');
  let existing: unknown;
  try {
    existing = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    existing = undefined;
  }
  const names =
    existing &&
    typeof existing === 'object' &&
    'atlases' in existing &&
    Array.isArray(existing.atlases)
      ? existing.atlases.filter((name): name is string => typeof name === 'string')
      : [];
  await writeFile(
    manifestPath,
    `${JSON.stringify({ atlases: [...new Set([...names, entry.name])].sort() }, null, 2)}\n`,
  );
  return atlas;
}

async function makeVolcanoTile(
  width: number,
  height: number,
  palette: number[][],
): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 4);
  const basalt = palette[3];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const ridge = (x * 7 + y * 11) % 29 === 0 || (x * 13 + y * 5) % 41 === 0;
      const color = ridge ? palette[17] : basalt;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
  const paintLine = (points: Array<[number, number]>, color: number[], radius: number): void => {
    for (let index = 1; index < points.length; index++) {
      const [x0, y0] = points[index - 1];
      const [x1, y1] = points[index];
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let step = 0; step <= steps; step++) {
        const x = Math.round(x0 + ((x1 - x0) * step) / Math.max(steps, 1));
        const y = Math.round(y0 + ((y1 - y0) * step) / Math.max(steps, 1));
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy > radius * radius + 1) continue;
            if (x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height) continue;
            const offset = ((y + dy) * width + x + dx) * 4;
            pixels[offset] = color[0];
            pixels[offset + 1] = color[1];
            pixels[offset + 2] = color[2];
            pixels[offset + 3] = 255;
          }
        }
      }
    }
  };
  const mainFlow: Array<[number, number]> = [
    [17, 1],
    [16, 6],
    [18, 10],
    [17, 15],
    [19, 20],
    [18, 26],
    [20, 31],
  ];
  const branchLeft: Array<[number, number]> = [
    [16, 10],
    [11, 13],
    [10, 18],
    [7, 22],
  ];
  const branchRight: Array<[number, number]> = [
    [18, 16],
    [23, 19],
    [24, 24],
    [28, 27],
  ];
  for (const flow of [mainFlow, branchLeft, branchRight]) paintLine(flow, palette[9], 4);
  for (const flow of [mainFlow, branchLeft, branchRight]) paintLine(flow, palette[26], 3);
  for (const flow of [mainFlow, branchLeft, branchRight]) paintLine(flow, palette[27], 2);
  for (const flow of [mainFlow, branchLeft, branchRight]) paintLine(flow, palette[30], 1);
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

async function processIcon(icon: string, palette: number[][]): Promise<Buffer> {
  const matrixPath = join(toolDir, 'icons', `${icon}.txt`);
  const rows = (await readFile(matrixPath, 'utf8')).trimEnd().split(/\r?\n/);
  if (
    rows.length !== iconSize ||
    rows.some((row) => row.length !== iconSize || /[^0-9a-v]/i.test(row))
  ) {
    throw new Error(
      `Icon ${icon} must be a 16x16 matrix of base-32 palette indices: ${matrixPath}`,
    );
  }
  const pixels = Buffer.alloc(iconSize * iconSize * 4);
  rows.forEach((row, y) => {
    [...row].forEach((digit, x) => {
      const paletteIndex = Number.parseInt(digit, 32);
      const offset = (y * iconSize + x) * 4;
      if (digit !== '0') {
        const color = palette[paletteIndex];
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
        pixels[offset + 3] = 255;
      }
    });
  });
  return sharp(pixels, { raw: { width: iconSize, height: iconSize, channels: 4 } })
    .png()
    .toBuffer();
}

async function makeIconAtlas(config: Config, outDir: string, palette: number[][]): Promise<void> {
  const icons = config.icons ?? [];
  const columns = Math.min(iconsPerRow, icons.length);
  const rows = Math.ceil(icons.length / iconsPerRow);
  const frames: Record<string, { x: number; y: number; width: number; height: number }> = {};
  const composites = await Promise.all(
    icons.map(async (icon, index) => {
      const x = (index % iconsPerRow) * iconSize;
      const y = Math.floor(index / iconsPerRow) * iconSize;
      frames[icon] = { x, y, width: iconSize, height: iconSize };
      return { input: await processIcon(icon, palette), left: x, top: y };
    }),
  );
  await sharp({
    create: {
      width: columns * iconSize,
      height: rows * iconSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toFile(join(outDir, 'icons.png'));
  await writeFile(join(outDir, 'icons.json'), `${JSON.stringify(frames, null, 2)}\n`);
}

async function makeContactSheet(
  sprites: Sprite[],
  outDir: string,
  sheetPath: string,
): Promise<void> {
  const entries = await Promise.all(
    sprites.map(async (sprite) => {
      const scale = Math.min(2.5, 88 / sprite.width, 88 / sprite.height);
      const scaledWidth = Math.round(sprite.width * scale);
      const scaledHeight = Math.round(sprite.height * scale);
      return {
        sprite,
        width: scaledWidth,
        height: scaledHeight,
        input: await sharp(join(outDir, sprite.output))
          .resize(scaledWidth, scaledHeight, { kernel: 'nearest' })
          .png()
          .toBuffer(),
      };
    }),
  );
  const columns = 4;
  const rows = Math.ceil(entries.length / columns);
  const composite = await Promise.all(
    entries.map(async ({ sprite, width, height, input }, index) => {
      const x = (index % columns) * contactCellWidth;
      const y = Math.floor(index / columns) * contactCellHeight;
      const image = await sharp({
        create: {
          width: contactCellWidth,
          height: contactCellHeight,
          channels: 4,
          background: { r: 132, g: 128, b: 137, alpha: 255 },
        },
      })
        .composite([
          {
            input,
            left: Math.floor((contactCellWidth - width) / 2),
            top: Math.floor((96 - height) / 2),
          },
          {
            input: Buffer.from(
              `<svg width="${contactCellWidth}" height="24"><text x="4" y="17" fill="#171416" font-size="8" font-family="sans-serif">${sprite.output}</text></svg>`,
            ),
            left: 0,
            top: 104,
          },
        ])
        .png()
        .toBuffer();
      return { input: image, left: x, top: y };
    }),
  );
  await mkdir(dirname(sheetPath), { recursive: true });
  await sharp({
    create: {
      width: columns * contactCellWidth,
      height: rows * contactCellHeight,
      channels: 4,
      background: { r: 132, g: 128, b: 137, alpha: 255 },
    },
  })
    .composite(composite)
    .png()
    .toFile(sheetPath);
}

export async function buildSprites({
  configPath,
  outDir,
  writeContactSheet = true,
}: BuildOptions): Promise<void> {
  const parsed = JSON.parse(await readFile(configPath, 'utf8')) as Config & { palette: string };
  const palette = await readPalette(absoluteFromConfig(configPath, parsed.palette));
  await mkdir(outDir, { recursive: true });
  const sprites = parsed.sprites;
  for (const sprite of sprites) {
    const bytes =
      sprite.region === 'volcano'
        ? await makeVolcanoTile(sprite.width, sprite.height, palette)
        : sprite.icon
          ? await processIcon(sprite.icon, palette)
          : await processCrop(sprite, configPath, palette);
    await writeFile(join(outDir, sprite.output), bytes);
  }
  await makeIconAtlas(parsed, outDir, palette);
  if (writeContactSheet) {
    await makeContactSheet(
      [
        ...sprites,
        {
          output: 'icons.png',
          width: Math.min(iconsPerRow, (parsed.icons ?? []).length) * iconSize,
          height: Math.ceil((parsed.icons ?? []).length / iconsPerRow) * iconSize,
        },
      ],
      outDir,
      join(toolDir, 'contact-sheet.png'),
    );
  }
}

function hex(color: number[]): string {
  return `#${color.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export async function extractPalette(imagePath: string, outputPath: string): Promise<void> {
  const { data, info } = await sharp(imagePath)
    .resize(128, 128, { fit: 'inside', kernel: 'nearest' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const samples: number[][] = [];
  for (let index = 0; index < data.length; index += info.channels) {
    samples.push([data[index], data[index + 1], data[index + 2]]);
  }
  const colors: number[][] = [];
  for (let index = 0; index < 32; index++) {
    const sample = samples[Math.floor(((index + 0.5) * samples.length) / 32)];
    colors.push([...sample]);
  }
  for (let iteration = 0; iteration < 24; iteration++) {
    const totals = Array.from({ length: 32 }, () => [0, 0, 0, 0]);
    for (const sample of samples) {
      let best = 0;
      let distance = Number.POSITIVE_INFINITY;
      colors.forEach((color, index) => {
        const next = colorDistance(sample[0], sample[1], sample[2], color);
        if (next < distance) {
          best = index;
          distance = next;
        }
      });
      const total = totals[best];
      total[0] += sample[0];
      total[1] += sample[1];
      total[2] += sample[2];
      total[3]++;
    }
    colors.forEach((color, index) => {
      const total = totals[index];
      if (total[3] > 0)
        colors[index] = total.slice(0, 3).map((value) => Math.round(value / total[3]));
    });
  }
  const palette = [...new Set(colors.map(hex))].sort();
  while (palette.length < 32) palette.push(hex(colors[palette.length % colors.length]));
  await writeFile(outputPath, `${JSON.stringify(palette.slice(0, 32), null, 2)}\n`);
}

async function main(args: string[]): Promise<void> {
  if (args[0] === '--extract-palette') {
    const imagePath = resolve(args[1] ?? 'docs/concepts/style_16bit.png');
    const outputPath = resolve(args[2] ?? 'tools/pixelize/palette.json');
    await extractPalette(imagePath, outputPath);
    return;
  }
  const sheetsIndex = args.indexOf('--sheets');
  if (sheetsIndex >= 0) {
    const outIndex = args.indexOf('--out');
    const onlyIndex = args.indexOf('--only');
    if (!args[sheetsIndex + 1] || outIndex < 0 || !args[outIndex + 1]) {
      throw new Error(
        'Usage: tsx pixelize.ts --sheets <sheets.json> --out <directory> [--only <name>]',
      );
    }
    const configPath = resolve(args[sheetsIndex + 1]);
    const outDir = resolve(args[outIndex + 1]);
    const config = JSON.parse(await readFile(configPath, 'utf8')) as { sheets: SheetEntry[] };
    if (!Array.isArray(config.sheets)) throw new Error(`Invalid sheets manifest: ${configPath}`);
    const selected =
      onlyIndex >= 0
        ? config.sheets.filter((sheet) => sheet.name === args[onlyIndex + 1])
        : config.sheets;
    if (onlyIndex >= 0 && selected.length === 0)
      throw new Error(`Unknown sheet: ${args[onlyIndex + 1]}`);
    for (const entry of selected) await buildSheet(entry, dirname(configPath), outDir);
    return;
  }
  const configIndex = args.indexOf('--config');
  const outIndex = args.indexOf('--out');
  const configPath = resolve(
    configIndex >= 0 ? args[configIndex + 1] : 'tools/pixelize/crops.json',
  );
  const outDir = resolve(outIndex >= 0 ? args[outIndex + 1] : 'apps/client/public/sprites');
  if (!configPath || !outDir)
    throw new Error('Usage: tsx pixelize.ts --config <crops.json> --out <sprite-directory>');
  await buildSprites({ configPath, outDir });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
