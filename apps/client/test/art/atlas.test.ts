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

  it('registers frames and namespaced animations', () => {
    const texture = { add: vi.fn() };
    const sourceTexture = { getSourceImage: () => 'image' };
    const addSpriteSheet = vi.fn().mockReturnValue(texture);
    const create = vi.fn();
    const scene = {
      textures: {
        addSpriteSheet,
        exists: vi.fn().mockReturnValue(false),
        get: vi.fn().mockReturnValue(sourceTexture),
      },
      anims: { create, exists: vi.fn((key: string) => key.endsWith(':idle')) },
    } as never;

    registerAtlas(scene, 'hero-knight', atlas);

    expect(addSpriteSheet).toHaveBeenCalledWith('hero-knight', sourceTexture, {
      frameWidth: 32,
      frameHeight: 32,
    });
    expect(texture.add).toHaveBeenCalledTimes(2);
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

  it('warns and aliases a missing atlas to its legacy M1 region image without fatal UI', () => {
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
      load: {
        image: vi.fn(),
        json: vi.fn(),
        on: vi.fn((_event: string, callback: (file: { key: string }) => void) => {
          loaderror.callback = callback;
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
    loaderror.callback?.({ key: 'board-meadow' });
    boot.create();

    expect(warn).toHaveBeenCalledWith('[art] fallback', 'board-meadow');
    expect(addImage).toHaveBeenCalledWith('board-meadow', 'legacy-image');
    expect(root.querySelector('[data-testid="asset-error"]')).toBeNull();
    expect(boot.scene.start).toHaveBeenCalledWith('BoardScene');
    root.remove();
    warn.mockRestore();
  });
});
