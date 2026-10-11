import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SFX_IDS } from '../../src/audio/events';

const audioDir = resolve(process.cwd(), 'public/audio');

// Lead-approved encodes: detect stale tracks, swapped slots or corrupted deploy assets.
const approvedMusic = [
  ['board.ogg', 'f0bde16d6a7ba2e876e4560ad83dbb0a3aaef4799a6421ee69ce2e812897e416'],
  ['board.mp3', '5ef3cec88b16f934e07b741c737aa15279e0de928bcf60531cfe891f63011a99'],
  ['battle.ogg', 'da0a074d53f026f712a3537ae85d62ef3bea63b01fc906acb3af19165f66e745'],
  ['battle.mp3', '96bff9bbc17641d29cf4b309800595932621d5313eb3b6ed16dd5ca9735b64e9'],
] as const;

describe('approved R1-E music', () => {
  it.each(approvedMusic)('%s ships the approved encode without corruption', async (file, hash) => {
    const bytes = await readFile(join(audioDir, 'music', file));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
  });

  it('keeps every music file, SFX and all shipped audio inside the byte budgets', async () => {
    let total = 0;
    let sfx = 0;
    for (const entry of await readdir(audioDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      const { size } = await stat(path);
      total += size;
      if (entry.parentPath === join(audioDir, 'music')) {
        expect(size, entry.name).toBeLessThanOrEqual(1_500_000);
      }
      if (entry.parentPath === join(audioDir, 'sfx') && entry.name.endsWith('.wav')) sfx += size;
    }
    expect(sfx).toBeLessThanOrEqual(300_000);
    expect(total).toBeLessThanOrEqual(4_000_000);
  });

  it.each([
    ['board', 'Town Theme RPG', 'https://opengameart.org/content/town-theme-rpg'],
    ['battle', 'Battle Theme A', 'https://opengameart.org/content/battle-theme-a'],
  ])('credits the approved %s track and its CC0 grant', async (track, title, url) => {
    const credits = await readFile(join(audioDir, 'CREDITS.md'), 'utf8');
    const section = credits.split(/\n### /).find((chunk) => chunk.startsWith(`${track} —`));
    expect(section).toBeTruthy();
    expect(section).toContain(title);
    expect(section).toContain('cynicmusic');
    expect(section).toContain('CC0 1.0');
    expect(section).toContain(url);
  });
});

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
