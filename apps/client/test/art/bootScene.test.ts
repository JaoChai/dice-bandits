import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ART_ATLASES } from '../../src/art/manifest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

const { default: BootScene } = await import('../../src/scenes/BootScene');

function bootFixture() {
  const urls: string[] = [];
  const queue = vi.fn((_key: string, url: string) => urls.push(url));
  const registry = new Map<string, unknown>();
  const frames = new Map<string, string[]>();
  const start = vi.fn();
  const boot = Object.assign(new BootScene(), {
    load: { image: queue, json: queue, text: queue, on: vi.fn() },
    cache: {
      json: {
        get: (key: string) =>
          JSON.parse(
            readFileSync(
              resolve(
                import.meta.dirname,
                '../../public/art',
                `${key.slice('art-json-'.length)}.json`,
              ),
              'utf8',
            ),
          ),
      },
    },
    textures: {
      exists: () => false,
      get: () => ({ getSourceImage: () => ({ width: 2048, height: 2048 }) }),
      addImage: (key: string) => {
        const registered: string[] = [];
        frames.set(key, registered);
        return {
          add: (pose: string) => {
            registered.push(pose);
            return { name: pose };
          },
        };
      },
    },
    game: { registry: { set: (key: string, value: unknown) => registry.set(key, value) } },
    scene: { start },
  });
  return { boot, urls, registry, frames, start };
}

describe('BootScene cartoon-only loading', () => {
  it('queues no legacy sprite URL', () => {
    const { boot, urls } = bootFixture();
    boot.preload();
    expect(urls.filter((url) => url.includes('/sprites/'))).toEqual([]);
  });

  it('queues the JSON and WebP for every cartoon atlas and all 15 map tiles', () => {
    const { boot, urls } = bootFixture();
    boot.preload();
    for (const atlas of ART_ATLASES) {
      expect(urls, `${atlas} JSON`).toContain(`/art/${atlas}.json`);
      expect(urls, `${atlas} image`).toContain(`/art/${atlas}.webp`);
    }
    for (let row = 0; row < 3; row += 1)
      for (let col = 0; col < 5; col += 1) expect(urls).toContain(`/art/map/r${row}c${col}.webp`);
  });

  it('registers the loaded frames, publishes artReady and starts BoardScene', () => {
    const { boot, registry, frames, start } = bootFixture();
    boot.preload();
    boot.create();
    expect(registry.get('artReady')).toEqual(new Set(ART_ATLASES.map((atlas) => `art:${atlas}`)));
    expect(frames.get('art:hero-knight')).toEqual([
      'idle',
      'attack',
      'hurt',
      'happy',
      'sad',
      'portrait',
    ]);
    expect(frames.get('art:tiles')).toEqual([
      'castle',
      'town',
      'shop',
      'chest',
      'monster',
      'event',
      'trap',
      'plain',
    ]);
    expect(start).toHaveBeenCalledExactlyOnceWith('BoardScene');
  });
});
