import { expect, it, vi } from 'vitest';
import { drawTiles } from '../../src/scenes/board/tiles';
import type { Space } from '@dice-bandits/engine';

// M5a Task 6: tiles render at the fixed 96 map-px size (the follow camera
// scales the whole map), so "native integer scale vs board spacing" no longer
// applies; these tests pin the new map-pixel contract instead.
// Review 2: `art:tiles` frames are named by kind (castle, town, …), so
// drawTiles must pass the kind itself — not a numeric index — as frame name.
const REAL_TILE_FRAMES = ['castle', 'town', 'shop', 'chest', 'monster', 'event', 'trap', 'plain'];

function tileScene() {
  const requested: string[] = [];
  const image = { setDepth: vi.fn(() => image), setDisplaySize: vi.fn(() => image) };
  const scene = {
    textures: {
      exists: vi.fn(() => true),
      get: vi.fn(() => ({ has: (frame: string) => REAL_TILE_FRAMES.includes(frame) })),
    },
    add: {
      image: vi.fn((_x: number, _y: number, _key: string, frame: string) => {
        requested.push(frame);
        return image;
      }),
    },
  };
  return { scene, image, requested };
}

it('renders the cartoon tile at the fixed 96 map-px display size', () => {
  const { scene, image } = tileScene();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  drawTiles(
    scene as never,
    [{ id: 0, kind: 'castle', x: 470, y: 1150 } as unknown as Space],
    new Map(),
  );
  expect(image.setDisplaySize).toHaveBeenCalledWith(96, 96);
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

it('requests the real art:tiles frame names for every space kind', () => {
  const { scene, requested } = tileScene();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const spaces = ['castle', 'town', 'shop', 'chest', 'monster', 'event', 'trap'].map(
    (kind, index) => ({ id: index, kind, x: index * 100, y: 0 }) as unknown as Space,
  );
  drawTiles(scene as never, spaces, new Map());
  expect(requested).toEqual(['castle', 'town', 'shop', 'chest', 'monster', 'event', 'trap']);
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

it('falls back to the rounded marker and warns when the tiles frame is missing', () => {
  const image = vi.fn();
  const fillRoundedRect = vi.fn();
  const graphics = { setDepth: vi.fn(), fillStyle: vi.fn(), fillRoundedRect };
  graphics.setDepth.mockReturnValue(graphics);
  graphics.fillStyle.mockReturnValue(graphics);
  const scene = {
    textures: { exists: vi.fn(() => true), get: vi.fn(() => ({ has: () => false })) },
    add: { image, graphics: vi.fn(() => graphics) },
  } as never;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const space = { id: 0, kind: 'castle', x: 470, y: 1150 } as unknown as Space;
  drawTiles(scene, [space], new Map());
  expect(image).not.toHaveBeenCalled();
  expect(fillRoundedRect).toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith('[art] fallback', 'art:tiles');
  warn.mockRestore();
});
