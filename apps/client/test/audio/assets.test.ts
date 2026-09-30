import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SFX_IDS } from '../../src/audio/events';

const audioDir = resolve(process.cwd(), 'public/audio');

describe('shipped audio assets', () => {
  it('ships a non-empty wav for every SFX id', async () => {
    for (const id of SFX_IDS) {
      const info = await stat(join(audioDir, 'sfx', `${id}.wav`));
      expect(info.isFile(), id).toBe(true);
      expect(info.size, id).toBeGreaterThan(0);
    }
  });

  it('ships board and battle music as both ogg and mp3', async () => {
    for (const track of ['board', 'battle'] as const) {
      for (const extension of ['.ogg', '.mp3'] as const) {
        const info = await stat(join(audioDir, 'music', `${track}${extension}`));
        expect(info.isFile(), `${track}${extension}`).toBe(true);
        expect(info.size, `${track}${extension}`).toBeGreaterThan(0);
      }
    }
  });

  it('credits both music tracks under CC0', async () => {
    const credits = await readFile(join(audioDir, 'CREDITS.md'), 'utf8');
    for (const track of ['board', 'battle'] as const) {
      const section = credits
        .split(/\n### /)
        .find((chunk) => chunk.toLowerCase().startsWith(track));
      expect(section, `CREDITS.md section for ${track}`).toBeTruthy();
      expect(section!, `CC0 licence for ${track}`).toContain('CC0');
    }
  });
});
