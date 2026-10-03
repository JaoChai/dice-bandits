import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ART_ATLASES } from '../../src/art/manifest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
const { default: BootScene } = await import('../../src/scenes/BootScene');

afterEach(() => vi.restoreAllMocks());

/** Loader events must fan out: BootScene installs two loaderror listeners. */
function bootFixture() {
  const events = new EventEmitter();
  const images = new Map<string, { key: string }>();
  const json = new Map<string, unknown>();
  const registry = new Map<string, unknown>();
  const frames = new Map<string, ReturnType<typeof vi.fn>>();
  const addImage = vi.fn((key: string, source: { key: string }) => {
    images.set(key, source);
    const add = vi.fn().mockReturnValue({});
    frames.set(key, add);
    return { add };
  });
  const boot = Object.assign(new BootScene(), {
    load: {
      image: vi.fn((key: string) => images.set(key, { key })),
      json: vi.fn((key: string) => {
        json.set(key, { frames: { idle: { x: 1, y: 2, w: 30, h: 40 } } });
      }),
      text: vi.fn(),
      on: events.on.bind(events),
    },
    textures: {
      exists: (key: string) => images.has(key),
      // Phaser returns its placeholder, not undefined, for an absent texture.
      get: (key: string) => ({
        key: images.has(key) ? key : '__MISSING',
        getSourceImage: () => images.get(key) ?? { key: '__MISSING' },
      }),
      remove: (key: string) => images.delete(key),
      addImage,
    },
    cache: { json: { get: (key: string) => json.get(key) } },
    game: { registry },
    scene: { start: vi.fn(), launch: vi.fn() },
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  boot.preload();
  return { boot, events, images, json, registry, frames, addImage, warn };
}

describe('BootScene cartoon loader contract', () => {
  it('publishes every successfully registered named atlas before starting scenes', () => {
    const { boot, registry, frames } = bootFixture();
    registry.set('state', { phase: { kind: 'battle' } });
    boot.scene.start.mockImplementation(() => {
      expect(registry.get('artReady')).toEqual(new Set(ART_ATLASES.map((key) => `art:${key}`)));
    });
    boot.create();
    for (const atlas of ART_ATLASES) {
      expect(frames.get(`art:${atlas}`)).toHaveBeenCalledWith('idle', 0, 1, 2, 30, 40);
    }
    expect(boot.scene.start).toHaveBeenCalledWith('BoardScene');
    expect(boot.scene.launch).toHaveBeenCalledWith('BattleScene');
  });

  it('warns at image loaderror and never publishes or registers the placeholder as ready art', () => {
    const { boot, events, images, registry, addImage, warn } = bootFixture();
    images.delete('art-image-hero-knight');
    events.emit('loaderror', { key: 'art-image-hero-knight' });
    expect(warn).toHaveBeenCalledWith('[art] fallback', 'art:hero-knight');
    boot.create();
    expect(registry.get('artReady')).toEqual(
      new Set(ART_ATLASES.filter((key) => key !== 'hero-knight').map((key) => `art:${key}`)),
    );
    expect(addImage.mock.calls.map(([key]) => key)).not.toContain('art:hero-knight');
    expect(boot.scene.start).toHaveBeenCalledWith('BoardScene');
    expect(warn.mock.calls.filter(([, key]) => key === 'art:hero-knight')).toHaveLength(1);
  });

  it('leaves missing JSON unavailable but starts the board without crashing', () => {
    const { boot, events, json, registry, warn } = bootFixture();
    json.delete('art-json-hero-knight');
    events.emit('loaderror', { key: 'art-json-hero-knight' });
    expect(() => boot.create()).not.toThrow();
    expect(registry.get('artReady')).not.toContain('art:hero-knight');
    expect(warn).toHaveBeenCalledWith('[art] fallback', 'art:hero-knight');
    expect(boot.scene.start).toHaveBeenCalledWith('BoardScene');
  });
});
