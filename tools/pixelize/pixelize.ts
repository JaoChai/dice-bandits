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
): Promise<Buffer> {
  const data = Buffer.from(input);
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const background = [data[0], data[1], data[2]];
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
      ) > backgroundTolerance
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
    const bytes = sprite.icon
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
