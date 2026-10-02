/* global URL, process, console */
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('../apps/client/public/art/', import.meta.url)));
const limit = Number(process.env.ART_BUDGET_BYTES ?? 6_000_000);
if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid ART_BUDGET_BYTES');

async function artBytes(directory) {
  let bytes = 0;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    // A missing art/ directory is valid until the art task lands.
    return 0;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) bytes += await artBytes(path);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.webp')) {
      bytes += (await stat(path)).size;
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
      bytes += (await stat(path)).size;
    }
  }
  return bytes;
}

const bytes = await artBytes(root);
console.log(`Art budget: ${bytes} / ${limit} bytes`);
if (bytes > limit) {
  console.error(`Art budget exceeded by ${bytes - limit} bytes`);
  process.exitCode = 1;
}
