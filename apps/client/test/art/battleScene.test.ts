import { createGame } from '@dice-bandits/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { ART } from '../../src/art/manifest';
import { drawBackdrop } from '../../src/scenes/battle/backdrop';

/**
 * Task 8 RED: the battle scene renders the cartoon `art:` set. These tests
 * pin the cartoon behaviour before the switch; all fail on the current
 * pixel-art implementation.
 */

const state = createGame({
  seed: 'battle-cartoon',
  rounds: 12,
  seats: [
    { name: 'Hero', classId: 'knight', control: 'human', personality: null },
    { name: 'Other', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
});

type FakeGO = {
  setDepth: ReturnType<typeof vi.fn>;
  setDisplaySize: ReturnType<typeof vi.fn>;
  setOrigin: ReturnType<typeof vi.fn>;
  setScale: ReturnType<typeof vi.fn>;
  setFlipX: ReturnType<typeof vi.fn>;
  setAlpha: ReturnType<typeof vi.fn>;
  setTint: ReturnType<typeof vi.fn>;
  texture: { key: string };
  frame: { name: string | number };
};

function fakeGameObject(textureKey: string, frame: string | number): FakeGO {
  const go: FakeGO = {
    setDepth: vi.fn(),
    setDisplaySize: vi.fn(),
    setOrigin: vi.fn(),
    setScale: vi.fn(),
    setFlipX: vi.fn(),
    setAlpha: vi.fn(),
    setTint: vi.fn(),
    texture: { key: textureKey },
    frame: { name: frame },
  };
  for (const method of [
    'setDepth',
    'setDisplaySize',
    'setOrigin',
    'setScale',
    'setFlipX',
    'setAlpha',
    'setTint',
  ] as const)
    go[method].mockReturnValue(go);
  return go;
}

describe('cartoon battle backdrop (Task 8)', () => {
  let added: FakeGO[];

  function sceneWith(textures: Record<string, string[]>) {
    added = [];
    return {
      textures: {
        exists: (key: string) => key in textures,
        get: (key: string) => ({ has: (frame: string) => textures[key]?.includes(frame) ?? false }),
      },
      add: {
        image: vi.fn((_x: number, _y: number, key: string, frame: string | number) => {
          const go = fakeGameObject(key, frame);
          added.push(go);
          return go;
        }),
        tileSprite: vi.fn((_x: number, _y: number, w: number, h: number, key: string) => {
          const go = fakeGameObject(key, 0);
          added.push(go);
          return go;
        }),
        rectangle: vi.fn(() => {
          const go = fakeGameObject('__rect', 0);
          added.push(go);
          return go;
        }),
        sprite: vi.fn((_x: number, _y: number, key: string, frame?: string | number) => {
          const go = fakeGameObject(key, frame ?? 0);
          added.push(go);
          return go;
        }),
        text: vi.fn(() => fakeGameObject('__text', 0)),
      },
    };
  }

  beforeEach(() => {
    delete (window as { __db?: unknown }).__db;
  });

  it('renders the region backdrop atlas frame at 1280×720', () => {
    const scene = sceneWith({ [ART.backdrops.desert]: ['bg'] });
    drawBackdrop(scene as unknown as Phaser.Scene, state, 9);
    const image = added.find((go) => go.texture.key === ART.backdrops.desert);
    expect(image, 'backdrop atlas image drawn').toBeDefined();
    expect(image!.frame.name).toBe('bg');
    expect(image!.setDepth).toHaveBeenCalledWith(-10);
  });

  it('falls back to a flat rectangle when the atlas is missing, with a console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const scene = sceneWith({});
    drawBackdrop(scene as unknown as Phaser.Scene, state, 9);
    const flat = added.filter((go) => go.texture.key === '__rect');
    expect(flat.length, 'flat-shape fallback drawn instead of a crash').toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('ART manifest keys consumed by the battle scene', () => {
  it('exposes cartoon backdrop keys per region', () => {
    expect(ART.backdrops.meadow).toBe('art:backdrop-meadow');
    expect(ART.backdrops.desert).toBe('art:backdrop-desert');
  });
});
