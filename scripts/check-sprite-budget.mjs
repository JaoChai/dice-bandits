/* global URL, process, console */
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('../apps/client/public/sprites/', import.meta.url)));
const limit = Number(process.env.SPRITE_BUDGET_BYTES ?? 1_500_000);
if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid SPRITE_BUDGET_BYTES');

async function pngBytes(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) bytes += await pngBytes(path);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
      bytes += (await stat(path)).size;
    }
  }
  return bytes;
}

const bytes = await pngBytes(root);
console.log(`Sprite PNG budget: ${bytes} / ${limit} bytes`);
if (bytes > limit) {
  console.error(`Sprite PNG budget exceeded by ${bytes - limit} bytes`);
  process.exitCode = 1;
}
