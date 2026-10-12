import { describe, expect, it, vi } from 'vitest';
import { createHeroToken, tokenLayout, tokenOffsets } from '../../src/scenes/board/tokens';

describe('board hero tokens', () => {
  it('centres a single token on its space', () => {
    expect(tokenOffsets(1)).toEqual([{ x: 0, y: 0 }]);
  });

  // Compact two-row placement makes crowded heroes indistinguishable.
  // The approved row keeps all feet on one baseline and >=60px apart.
  it.each([2, 3, 4])('keeps %i shared cartoon tokens distinguishable near their tile', (count) => {
    const offsets = tokenOffsets(count);
    expect(offsets).toHaveLength(count);
    const approved = count === 2 ? [-36, 36] : count === 3 ? [-66, 0, 66] : [-99, -33, 33, 99];
    expect(offsets).toEqual(approved.map((x) => ({ x, y: 0 })));
    for (const offset of offsets) expect(Math.hypot(offset.x, offset.y)).toBeLessThanOrEqual(99);
    for (let left = 0; left < offsets.length; left++) {
      for (let right = left + 1; right < offsets.length; right++) {
        const dx = Math.abs(offsets[left]!.x - offsets[right]!.x);
        const dy = Math.abs(offsets[left]!.y - offsets[right]!.y);
        expect(Math.hypot(dx, dy), `pair ${left}/${right} separation`).toBeGreaterThanOrEqual(60);
        const overlap = (Math.max(0, 72 - dx) * Math.max(0, 72 - dy)) / (72 * 72);
        expect(overlap, `pair ${left}/${right}`).toBeLessThanOrEqual(0.35);
      }
    }
  });

  it('lays out every token sharing a space with the offsets for the full count', () => {
    const offsets = tokenLayout([7, 7, 7, 7]);
    expect(offsets).toEqual(tokenOffsets(4));
    for (let left = 0; left < offsets.length; left++) {
      for (let right = left + 1; right < offsets.length; right++) {
        const dx = offsets[left]!.x - offsets[right]!.x;
        const dy = offsets[left]!.y - offsets[right]!.y;
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it('centres tokens that are alone on their space', () => {
    const layout = tokenLayout([1, 7, 1, 3]);
    expect(layout[1]).toEqual({ x: 0, y: 0 });
    expect(layout[3]).toEqual({ x: 0, y: 0 });
    expect(layout[0]!.x).toBeLessThan(0);
    expect(layout[2]!.x).toBeGreaterThan(0);
    expect(layout[0]!.y).toBe(0);
    expect(layout[2]!.y).toBe(0);
  });

  it('creates a cartoon image token from the art atlas idle frame', () => {
    const made: { x: number; y: number; key: string; frame?: string }[] = [];
    const image = {
      setOrigin: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
      setDisplaySize: vi.fn().mockReturnThis(),
    };
    const scene = {
      add: {
        image: vi.fn((x: number, y: number, key: string, frame?: string) => {
          made.push({ x, y, key, frame });
          return image;
        }),
        sprite: vi.fn(),
      },
      textures: {
        exists: vi.fn((key: string) => key === 'art:hero-mage'),
        get: vi.fn((key: string) => ({
          key,
          has: (frame: string) => key === 'art:hero-mage' && frame === 'idle',
          get: () => ({ width: 206, height: 280 }),
        })),
      },
    };

    const token = createHeroToken(scene as never, 'mage', 24, 36);

    expect(made[0]).toEqual({ x: 24, y: 36, key: 'art:hero-mage', frame: 'idle' });
    expect(scene.add.sprite).not.toHaveBeenCalled();
    expect(image.setOrigin).toHaveBeenCalledWith(0.5, 1);
    // 72 map px tall, width keeps the idle frame's aspect ratio (206x280).
    expect(image.setDisplaySize).toHaveBeenCalledWith(53, 72);
    expect(token).toBe(image);
  });

  it('falls back to the flat white shape with a warn when the art token is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const image = {
      setOrigin: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
      setDisplaySize: vi.fn().mockReturnThis(),
      setTint: vi.fn().mockReturnThis(),
    };
    const scene = {
      add: {
        image: vi.fn((_x: number, _y: number, key: string, frame?: string) => {
          made.push({ x: _x, y: _y, key, frame });
          return image;
        }),
        sprite: vi.fn(),
      },
      textures: {
        exists: vi.fn().mockReturnValue(false),
        get: vi.fn(() => ({ key: '__MISSING', has: () => false })),
      },
    };
    const made: { x: number; y: number; key: string; frame?: string }[] = [];

    const token = createHeroToken(scene as never, 'knight', 24, 36);

    expect(made[0]).toEqual({ x: 24, y: 36, key: '__WHITE', frame: undefined });
    expect(warn).toHaveBeenCalledWith('[art] fallback', 'art:hero-knight');
    expect(image.setDisplaySize).toHaveBeenCalledWith(28, 28);
    expect(image.setTint).toHaveBeenCalledWith(0x8e8e93);
    expect(token).toBe(image);
    warn.mockRestore();
  });
});
