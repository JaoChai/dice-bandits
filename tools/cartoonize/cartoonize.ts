import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import sharp, {
  type CreateRaw,
  type OutputInfo,
  type Sharp as SharpInstance,
  type WebpOptions,
} from 'sharp';

/** Manifest entry in `tools/cartoonize/sheets.json`. */
export interface ManifestEntry {
  name: string;
  /** Source image, relative to the tool directory. */
  input: string;
  kind: 'pose' | 'grid' | 'map';
  /** Output cell [w, h]; `map` mode uses it as the tile size. */
  cell: [number, number];
  /** In-space height the largest pose is scaled down to. */
  shipHeight: number;
  /** Frame names; `pose` order matches columns, `grid` order is row-major. */
  poses?: string[];
  /** Grid dimensions for `grid` mode. */
  grid?: [number, number];
  /** Output base name under `apps/client/public/art/`. */
  out: string;
}

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  anchorX: number;
  anchorY: number;
}

export interface Atlas {
  frames: Record<string, AtlasFrame>;
  image: string;
}

/** Flat-background key colour and per-channel tolerance (plan Step 3). */
const KEY = { r: 0xbd, g: 0xbd, b: 0xbd };
const TOLERANCE = 28;
/**
 * Inner radius of the key: distances ≤ this are fully transparent, distances in
 * `(this, TOLERANCE]` ramp linearly to fully opaque — a colour-space soft edge.
 */
const KEY_SOFT = 12;
/** WebP encode settings (plan Step 3): deterministic quality 82, effort 6. */
const WEBP_OPTIONS: WebpOptions = { quality: 82, effort: 6 };

export async function loadManifest(
  manifestPath = fileURLToPath(new URL('./sheets.json', import.meta.url)),
): Promise<Record<string, ManifestEntry>> {
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as { sheets: ManifestEntry[] };
  const byName: Record<string, ManifestEntry> = {};
  for (const entry of parsed.sheets) byName[entry.name] = entry;
  return byName;
}

/**
 * Replaces near-`KEY` pixels with transparency and softens the edge in colour
 * space: distance ≤ KEY_SOFT is fully transparent, > TOLERANCE fully opaque,
 * and the band between ramps linearly 0→255 so anti-aliased outlines keep a
 * partial-alpha fringe instead of an opaque grey one.
 */
async function chromaKey(input: SharpInstance): Promise<SharpInstance> {
  const { data, info } = await input.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.from(data);
  const ramp = TOLERANCE - KEY_SOFT;
  for (let i = 0; i < width * height; i++) {
    const offset = i * channels;
    const distance = Math.max(
      Math.abs(out[offset]! - KEY.r),
      Math.abs(out[offset + 1]! - KEY.g),
      Math.abs(out[offset + 2]! - KEY.b),
    );
    if (distance <= KEY_SOFT) {
      out[offset + 3] = 0;
    } else if (distance <= TOLERANCE) {
      out[offset + 3] = Math.round(((distance - KEY_SOFT) / ramp) * 255);
    }
  }
  return sharp(out, { raw: { width, height, channels } });
}

interface TrimmedFrame {
  /** Keyed, trimmed RGBA pixels at their current scale. */
  data: Buffer;
  width: number;
  height: number;
}

/** Key one cell of the source sheet and trim it to its alpha bounding box. */
async function keyAndTrim(
  raw: { data: Buffer; info: OutputInfo },
  rect: { left: number; top: number; width: number; height: number },
): Promise<TrimmedFrame> {
  const keyed = await chromaKey(
    sharp(raw.data, {
      raw: {
        width: raw.info.width,
        height: raw.info.height,
        channels: raw.info.channels,
      } as CreateRaw,
    }).extract(rect),
  );
  const { data, info } = await keyed
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Lanczos3 rescale by one sheet-wide factor (1 is a no-op; never upscales). */
async function scaleFrame(frame: TrimmedFrame, scale: number): Promise<TrimmedFrame> {
  if (scale === 1) return frame;
  const width = Math.max(1, Math.round(frame.width * scale));
  const height = Math.max(1, Math.round(frame.height * scale));
  const { data, info } = await sharp(frame.data, {
    raw: { width: frame.width, height: frame.height, channels: 4 },
  })
    .resize(width, height, { kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Frame placed bottom-centre inside its cell: content rect within the cell. */
interface Placement {
  left: number;
  top: number;
  width: number;
  height: number;
}

function fitToCell(frame: TrimmedFrame, cellW: number, cellH: number): Placement {
  if (frame.width > cellW || frame.height > cellH) {
    throw new Error(
      `Frame ${frame.width}x${frame.height} does not fit cell ${cellW}x${cellH}; enlarge cell or lower shipHeight`,
    );
  }
  const left = Math.floor((cellW - frame.width) / 2);
  const top = cellH - frame.height;
  return { left, top, width: frame.width, height: frame.height };
}

async function processPoseLike(
  entry: ManifestEntry,
  sourcePath: string,
  outDir: string,
): Promise<Atlas> {
  const [cellW, cellH] = entry.cell;
  const source = sharp(sourcePath);
  const meta = await source.metadata();
  if (!meta.width || !meta.height) throw new Error(`Cannot read source image ${sourcePath}`);
  const poses = entry.poses ?? [];
  if (poses.length === 0) throw new Error(`Sheet "${entry.name}" lists no poses`);
  const grid = entry.kind === 'grid' ? entry.grid! : ([poses.length, 1] as [number, number]);
  const [gridCols, gridRows] = grid;
  const columnWidth = Math.floor(meta.width / gridCols);
  const rowHeight = Math.floor(meta.height / gridRows);

  const raw = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cells = poses.map((pose, index) => {
    const col = index % gridCols;
    const row = Math.floor(index / gridCols);
    const left = col * columnWidth;
    const top = row * rowHeight;
    const width = col === gridCols - 1 ? meta.width - left : columnWidth;
    const height = row === gridRows - 1 ? meta.height - top : rowHeight;
    return { pose, rect: { left, top, width, height } };
  });

  // Pass 1 — key and trim every frame at source resolution.
  const trimmed: TrimmedFrame[] = [];
  for (const { pose, rect } of cells) {
    const frame = await keyAndTrim(raw, rect);
    if (frame.width === 0 || frame.height === 0) {
      throw new Error(`Pose "${pose}" is empty after keying; check the fixture/manifest`);
    }
    trimmed.push(frame);
  }

  // Pass 2 — ONE scale for the whole sheet (spec §art: a single source→ship
  // ratio, so the character keeps its size across poses): the largest frame
  // reaches shipHeight, the widest fits the cell, and small sheets pass through.
  const maxH = Math.max(...trimmed.map((f) => f.height));
  const maxW = Math.max(...trimmed.map((f) => f.width));
  const scale = Math.min(1, entry.shipHeight / maxH, cellW / maxW);
  const scaled: TrimmedFrame[] = [];
  for (const frame of trimmed) scaled.push(await scaleFrame(frame, scale));

  // Pack row-major: raw RGBA composites, encoded lossy WebP exactly once below.
  const placements = scaled.map((frame) => fitToCell(frame, cellW, cellH));
  const sheetCols = gridCols;
  const sheetRows = Math.ceil(poses.length / sheetCols);
  const sheetWidth = sheetCols * cellW;
  const sheetHeight = sheetRows * cellH;
  const webp = await sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(
      scaled.map(({ data, width, height }, index) => ({
        input: data,
        raw: { width, height, channels: 4 as const },
        left: (index % sheetCols) * cellW + placements[index]!.left,
        top: Math.floor(index / sheetCols) * cellH + placements[index]!.top,
      })),
    )
    .webp(WEBP_OPTIONS)
    .toBuffer();
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, `${entry.out}.webp`), webp);

  const frames: Record<string, AtlasFrame> = {};
  for (let index = 0; index < poses.length; index++) {
    const placement = placements[index]!;
    // Frames are the trimmed content rect inside the sheet (Phaser-ready);
    // anchor is bottom-centre of the content: baseline at the frame bottom.
    frames[poses[index]!] = {
      x: (index % sheetCols) * cellW + placement.left,
      y: Math.floor(index / sheetCols) * cellH + placement.top,
      w: placement.width,
      h: placement.height,
      anchorX: Math.floor(placement.width / 2),
      anchorY: placement.height,
    };
  }
  const atlas: Atlas = { frames, image: `${entry.out}.webp` };
  await writeFile(join(outDir, `${entry.out}.json`), `${JSON.stringify(atlas, null, 2)}\n`);
  return atlas;
}

async function processMap(entry: ManifestEntry, sourcePath: string, outDir: string): Promise<void> {
  const [tileW, tileH] = entry.cell;
  const source = sharp(sourcePath);
  const meta = await source.metadata();
  if (!meta.width || !meta.height) throw new Error(`Cannot read source image ${sourcePath}`);
  const cols = Math.ceil(meta.width / tileW);
  const rows = Math.ceil(meta.height / tileH);
  const tileDir = join(outDir, entry.out);
  await mkdir(tileDir, { recursive: true });
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const width = Math.min(tileW, meta.width - col * tileW);
      const height = Math.min(tileH, meta.height - row * tileH);
      await source
        .clone()
        .extract({ left: col * tileW, top: row * tileH, width, height })
        .webp(WEBP_OPTIONS)
        .toFile(join(tileDir, `r${row}c${col}.webp`));
    }
  }
}

export async function cartoonizeSheet(
  entry: ManifestEntry,
  baseDir: string,
  outDir: string,
): Promise<Atlas | null> {
  const sourcePath = resolve(baseDir, entry.input);
  if (entry.kind === 'map') {
    await processMap(entry, sourcePath, outDir);
    return null;
  }
  return processPoseLike(entry, sourcePath, outDir);
}

export async function cartoonizeAll(baseDir: string, outDir: string): Promise<string[]> {
  const manifest = await loadManifest(join(baseDir, 'sheets.json'));
  const processed: string[] = [];
  for (const entry of Object.values(manifest)) {
    await cartoonizeSheet(entry, baseDir, outDir);
    processed.push(entry.name);
  }
  return processed.sort();
}

/** CLI entry: `npm run cartoonize -w @dice-bandits/cartoonize -- <sheetName|--all>`. */
async function main(): Promise<void> {
  const toolDir = fileURLToPath(new URL('.', import.meta.url));
  const outDir = resolve(toolDir, '../../apps/client/public/art');
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npm run cartoonize -w @dice-bandits/cartoonize -- <sheetName|--all>');
    process.exitCode = 1;
    return;
  }
  const manifest = await loadManifest();
  const names = target === '--all' ? Object.keys(manifest).sort() : [target];
  for (const name of names) {
    const entry = manifest[name];
    if (!entry) {
      console.error(`Unknown sheet "${name}" in sheets.json`);
      process.exitCode = 1;
      return;
    }
    await cartoonizeSheet(entry, toolDir, outDir);
    console.log(`cartoonize: wrote ${entry.out} (${entry.kind})`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
