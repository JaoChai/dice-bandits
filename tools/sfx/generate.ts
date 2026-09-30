/// <reference types="node" />
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeWav } from './wav';
import { synth } from './synth';
import { SFX_TABLE } from './table';

const output = fileURLToPath(new URL('../../apps/client/public/audio/sfx/', import.meta.url));
await mkdir(output, { recursive: true });
for (const [id, spec] of Object.entries(SFX_TABLE)) {
  const wav = encodeWav(synth(spec), 22050);
  await writeFile(resolve(output, `${id}.wav`), wav);
  console.log(`${id}: ${wav.byteLength} bytes`);
}
