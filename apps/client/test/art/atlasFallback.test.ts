import { expect, it, vi } from 'vitest';
import { registerAtlas } from '../../src/art/atlas';
import { drawTiles } from '../../src/scenes/board/tiles';
import type { Space } from '@dice-bandits/engine';

it('rejects malformed or out-of-bounds atlas JSON without touching the legacy texture', () => {
  const legacy = { key: 'hero-knight', getSourceImage: () => ({ width: 32, height: 32 }) };
  const atlasImage = {
    key: 'hero-knight-atlas-image',
    getSourceImage: () => ({ width: 32, height: 32 }),
  };
  const remove = vi.fn();
  const addImage = vi.fn();
  const scene = {
    textures: {
      exists: vi.fn(() => true),
      get: vi.fn((key: string) => (key === 'hero-knight' ? legacy : atlasImage)),
      remove,
      addImage,
    },
    anims: { create: vi.fn() },
  } as never;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  expect(
    registerAtlas(scene, 'hero-knight', { frames: [{ x: 29, y: 0, w: 32, h: 32 }] } as never),
  ).toBe(false);
  expect(remove).not.toHaveBeenCalled();
  expect(addImage).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith('[art] fallback', 'hero-knight');
  warn.mockRestore();
});

it('restores legacy image if Phaser throws while registering a valid atlas', () => {
  const legacyImage = { width: 32, height: 32 };
  const sourceImage = { width: 32, height: 32 };
  let current: { key: string; getSourceImage: () => typeof legacyImage } | undefined = {
    key: 'hero-knight',
    getSourceImage: () => legacyImage,
  };
  const scene = {
    textures: {
      exists: vi.fn((key: string) => key === 'hero-knight' && !!current),
      get: vi.fn((key: string) =>
        key === 'hero-knight'
          ? current
          : { key: 'hero-knight-atlas-image', getSourceImage: () => sourceImage },
      ),
      remove: vi.fn(() => {
        current = undefined;
      }),
      addImage: vi.fn((_key: string, image: typeof legacyImage) => {
        if (image === sourceImage) throw new Error('WebGL unavailable');
        current = { key: 'hero-knight', getSourceImage: () => image };
        return current;
      }),
    },
    anims: { create: vi.fn() },
  } as never;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const valid = {
    image: 'hero-knight.png',
    cell: { width: 32, height: 32 },
    frames: [{ x: 0, y: 0, w: 32, h: 32 }],
    anchor: { x: 16, y: 30 },
    animations: {},
  };
  expect(registerAtlas(scene, 'hero-knight', valid)).toBe(false);
  expect(current?.getSourceImage()).toBe(legacyImage);
  expect(warn).toHaveBeenCalledWith('[art] fallback', 'hero-knight');
  warn.mockRestore();
});

it('renders tile atlas at native integer scale instead of stretching to board spacing', () => {
  const image = { setDepth: vi.fn(), setDisplaySize: vi.fn() };
  image.setDepth.mockReturnValue(image);
  image.setDisplaySize.mockReturnValue(image);
  const scene = {
    textures: { exists: () => true, get: () => ({ has: () => true }) },
    add: { image: vi.fn(() => image) },
  } as never;
  drawTiles(
    scene,
    [{ id: 0, kind: 'castle', x: 0, y: 0 } as unknown as Space],
    () => ({ x: 100, y: 100 }),
    19,
    new Map(),
  );
  expect(image.setDisplaySize).not.toHaveBeenCalled();
});

it('falls back to the rounded marker when tiles is a single-frame legacy icon alias', () => {
  const image = vi.fn();
  const fillRoundedRect = vi.fn();
  const graphics = { setDepth: vi.fn(), fillStyle: vi.fn(), fillRoundedRect };
  graphics.setDepth.mockReturnValue(graphics);
  graphics.fillStyle.mockReturnValue(graphics);
  const scene = {
    textures: { exists: vi.fn(() => true), get: vi.fn(() => ({ has: () => false })) },
    add: { image, graphics: vi.fn(() => graphics) },
  } as never;
  const space = { id: 0, kind: 'castle', x: 0, y: 0 } as unknown as Space;
  drawTiles(scene, [space], () => ({ x: 100, y: 100 }), 19, new Map());
  expect(image).not.toHaveBeenCalled();
  expect(fillRoundedRect).toHaveBeenCalled();
});
