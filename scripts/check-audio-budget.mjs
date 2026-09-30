/* global URL, process, console */
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, resolve, sep } from 'node:path';

const root = resolve(fileURLToPath(new URL('../apps/client/public/audio/', import.meta.url)));
const sfxLimit = 300_000;
const musicLimit = 1_500_000;
const totalLimit = 4_000_000;
let sfxBytes = 0;
let musicBytes = 0;
let allBytes = 0;
let exceeded = false;

async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await check(path);
    } else if (entry.isFile()) {
      const bytes = (await stat(path)).size;
      const relativePath = relative(root, path);
      allBytes += bytes;
      if (relativePath.startsWith(`sfx${sep}`) && relativePath.toLowerCase().endsWith('.wav')) {
        sfxBytes += bytes;
      }
      if (relativePath.startsWith(`music${sep}`)) {
        musicBytes += bytes;
        if (bytes > musicLimit) {
          console.error(
            `Audio music file ${relativePath}: ${bytes} / ${musicLimit} bytes (exceeded)`,
          );
          exceeded = true;
        }
      }
    }
  }
}

// A missing music/ directory is valid until the parallel music task lands.
await check(root);
console.log(`Audio SFX WAV budget: ${sfxBytes} / ${sfxLimit} bytes`);
console.log(`Audio music total: ${musicBytes} bytes (per-file limit ${musicLimit})`);
console.log(`Audio total budget: ${allBytes} / ${totalLimit} bytes`);
if (sfxBytes > sfxLimit || allBytes > totalLimit) {
  console.error('Audio budget exceeded');
  exceeded = true;
}
if (exceeded) process.exitCode = 1;
