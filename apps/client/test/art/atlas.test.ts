import { describe, expect, it, vi } from 'vitest';
import { hasAnim, registerAtlas, sheetKey, type Atlas } from '../../src/art/atlas';
vi.mock('phaser', () => ({ default: { Scene: class Scene {} } }));
import BootScene from '../../src/scenes/BootScene';

const atlas: Atlas = {
  image: 'hero-knight.png',
  cell: { width: 32, height: 32 },
  frames: [
    { x: 0, y: 0, w: 32, h: 32 },
    { x: 32, y: 0, w: 32, h: 32 },
  ],
  anchor: { x: 16, y: 30 },
  animations: { idle: { frames: [0, 1], fps: 6, loop: true } },
};

describe('atlas runtime', () => {
  it('builds stable sheet keys', () => {
    expect(sheetKey('hero', 'knight')).toBe('hero-knight');
    expect(sheetKey('token', 'mage')).toBe('token-mage');
  });

  it('registers frames and namespaced animations under the atlas key', () => {
    const texture = { add: vi.fn() };
    const image = { width: 64, height: 32 };
    const sourceTexture = { key: 'hero-knight-atlas-image', getSourceImage: () => image };
    const addImage = vi.fn().mockReturnValue(texture);
    const addSpriteSheet = vi.fn();
    const create = vi.fn();
    const scene = {
      textures: {
        addImage,
        addSpriteSheet,
        exists: vi.fn().mockReturnValue(false),
        get: vi.fn().mockReturnValue(sourceTexture),
      },
      anims: { create, exists: vi.fn((key: string) => key.endsWith(':idle')) },
    } as never;

    registerAtlas(scene, 'hero-knight', atlas);

    // A Texture passed to addSpriteSheet makes Phaser reuse source.key, so the
    // atlas key never exists; register the raw image under the atlas key instead.
    expect(addSpriteSheet).not.toHaveBeenCalled();
    expect(addImage).toHaveBeenCalledWith('hero-knight', image);
    expect(texture.add).toHaveBeenNthCalledWith(1, 0, 0, 0, 0, 32, 32);
    expect(texture.add).toHaveBeenNthCalledWith(2, 1, 0, 32, 0, 32, 32);
    expect(create).toHaveBeenCalledWith({
      key: 'hero-knight:idle',
      frames: [
        { key: 'hero-knight', frame: 0 },
        { key: 'hero-knight', frame: 1 },
      ],
      frameRate: 6,
      repeat: -1,
    });
    expect(hasAnim(scene, 'hero-knight', 'idle')).toBe(true);
    expect(hasAnim(scene, 'hero-knight', 'hop')).toBe(false);
  });

  it('loads no atlas assets when the manifest is empty and silently aliases M1 fallbacks', () => {
    const events = new Map<string, (key: string, type: string, data: string) => void>();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const image = vi.fn();
    const json = vi.fn();
    const text = vi.fn();
    const boot = Object.assign(Object.create(BootScene.prototype), {
      failedAtlases: new Set<string>(),
      warnedAtlases: new Set<string>(),
      activeAtlases: new Set<string>(),
      load: {
        image,
        json,
        text,
        on: vi.fn((event: string, callback: (key: string, type: string, data: string) => void) =>
          events.set(event, callback),
        ),
      },
      textures: {
        get: vi.fn(() => ({ getSourceImage: () => 'legacy' })),
        exists: vi.fn(() => false),
        addImage: vi.fn(),
      },
      cache: { json: { get: vi.fn() } },
      scene: { start: vi.fn() },
    }) as BootScene;

    boot.preload();
    expect(text).toHaveBeenCalledWith('atlas-manifest', '/sprites/atlases.json');
    events.get('filecomplete-text-atlas-manifest')?.('atlas-manifest', 'text', '{"atlases":[]}');
    expect(json).not.toHaveBeenCalled();
    expect(image.mock.calls.map(([key]) => key)).not.toContain('hero-knight-atlas-image');
    boot.create();

    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(37);
    expect(warn).toHaveBeenCalledWith('[art] fallback', 'hero-knight');
    expect(error).not.toHaveBeenCalled();
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  it('loads only manifest-listed atlas files', () => {
    const events = new Map<string, (key: string, type: string, data: string) => void>();
    const image = vi.fn();
    const json = vi.fn();
    const boot = Object.assign(Object.create(BootScene.prototype), {
      failedAtlases: new Set<string>(),
      warnedAtlases: new Set<string>(),
      activeAtlases: new Set<string>(),
      load: {
        image,
        json,
        text: vi.fn(),
        on: vi.fn((event: string, callback: (key: string, type: string, data: string) => void) =>
          events.set(event, callback),
        ),
      },
    }) as BootScene;
    boot.preload();
    events.get('filecomplete-text-atlas-manifest')?.(
      'atlas-manifest',
      'text',
      '{"atlases":["hero-knight"]}',
    );
    expect(json).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith('hero-knight', '/sprites/hero-knight.json');
    expect(image).toHaveBeenCalledWith('hero-knight-atlas-image', '/sprites/hero-knight.png');
    expect(json.mock.calls.map(([key]) => key)).toEqual(['hero-knight']);
  });

  it('treats invalid manifest JSON as empty without logging errors', () => {
    const events = new Map<string, (key: string, type: string, data: string) => void>();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const json = vi.fn();
    const boot = Object.assign(Object.create(BootScene.prototype), {
      failedAtlases: new Set<string>(),
      warnedAtlases: new Set<string>(),
      activeAtlases: new Set<string>(),
      load: {
        image: vi.fn(),
        text: vi.fn(),
        json,
        on: vi.fn((event: string, callback: (key: string, type: string, data: string) => void) =>
          events.set(event, callback),
        ),
      },
    }) as BootScene;
    boot.preload();
    events.get('filecomplete-text-atlas-manifest')?.('atlas-manifest', 'text', '<!doctype html>');
    expect(json).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
  });

  it('warns and aliases a missing listed atlas to its legacy M1 region image without fatal UI', () => {
    const loaderror: { callback?: (file: { key: string }) => void } = {};
    const legacyTexture = { getSourceImage: () => 'legacy-image' };
    const addImage = vi.fn();
    const root = document.createElement('div');
    root.id = 'game-root';
    document.body.append(root);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const boot = Object.assign(Object.create(BootScene.prototype), {
      failedAtlases: new Set<string>(),
      warnedAtlases: new Set<string>(),
      activeAtlases: new Set(['backdrop-meadow']),
      load: {
        image: vi.fn(),
        text: vi.fn(),
        json: vi.fn(),
        on: vi.fn((event: string, callback: (file: { key: string }) => void) => {
          if (event === 'loaderror') loaderror.callback = callback;
        }),
      },
      textures: {
        get: vi.fn().mockReturnValue(legacyTexture),
        exists: vi.fn().mockReturnValue(false),
        addImage,
      },
      cache: { json: { get: vi.fn().mockReturnValue(undefined) } },
      scene: { start: vi.fn() },
    }) as BootScene;

    boot.preload();
    loaderror.callback?.({ key: 'backdrop-meadow' });
    boot.create();

    expect(warn).toHaveBeenCalledWith('[art] fallback', 'backdrop-meadow');
    expect(addImage).toHaveBeenCalledWith('backdrop-meadow', 'legacy-image');
    expect(root.querySelector('[data-testid="asset-error"]')).toBeNull();
    expect(boot.scene.start).toHaveBeenCalledWith('BoardScene');
    root.remove();
    warn.mockRestore();
  });

  it('leaves missing board-layer atlases unregistered so draw code falls back per layer', () => {
    const loaderror: { callback?: (file: { key: string }) => void } = {};
    const addImage = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const boot = Object.assign(Object.create(BootScene.prototype), {
      failedAtlases: new Set<string>(),
      warnedAtlases: new Set<string>(),
      activeAtlases: new Set<string>(),
      load: {
        image: vi.fn(),
        text: vi.fn(),
        json: vi.fn(),
        on: vi.fn((event: string, callback: (file: { key: string }) => void) => {
          if (event === 'loaderror') loaderror.callback = callback;
        }),
      },
      textures: {
        get: vi.fn(() => ({ key: '__MISSING', getSourceImage: () => 'missing-image' })),
        exists: vi.fn().mockReturnValue(false),
        addImage,
      },
      cache: { json: { get: vi.fn().mockReturnValue(undefined) } },
      scene: { start: vi.fn() },
    }) as BootScene;

    boot.preload();
    loaderror.callback?.({ key: 'props-meadow-atlas-image' });
    boot.create();

    const aliased = addImage.mock.calls.map(([key]) => key);
    for (const region of ['meadow', 'desert', 'snow', 'volcano']) {
      expect(aliased).not.toContain(`ground-${region}`);
      expect(aliased).not.toContain(`props-${region}`);
      expect(aliased).not.toContain(`ambient-${region}`);
    }
    expect(boot.scene.start).toHaveBeenCalledWith('BoardScene');
    warn.mockRestore();
  });
});
