import { describe, expect, it, vi } from 'vitest';
import { createHeroToken, tokenLayout, tokenOffsets } from '../../src/scenes/board/tokens';

describe('board hero tokens', () => {
  it('centres a single token on its space', () => {
    expect(tokenOffsets(1)).toEqual([{ x: 0, y: 0 }]);
  });

  it('separates two tokens by twelve pixels', () => {
    const offsets = tokenOffsets(2);
    expect(offsets).toEqual([
      { x: -6, y: 0 },
      { x: 6, y: 0 },
    ]);
    expect(Math.abs(offsets[1]!.x - offsets[0]!.x)).toBeGreaterThanOrEqual(12);
  });

  it.each([3, 4])('places %i tokens in a 2x2 grid without overlap', (count) => {
    const offsets = tokenOffsets(count);
    expect(offsets).toHaveLength(count);
    for (let left = 0; left < offsets.length; left++) {
      for (let right = left + 1; right < offsets.length; right++) {
        const dx = offsets[left]!.x - offsets[right]!.x;
        const dy = offsets[left]!.y - offsets[right]!.y;
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(12);
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
    expect(tokenLayout([1, 7, 1, 3])).toEqual([
      { x: -6, y: 0 },
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it('creates an animated token sprite when its idle animation exists', () => {
    const sprite = {
      setOrigin: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
      setScale: vi.fn().mockReturnThis(),
      play: vi.fn().mockReturnThis(),
    };
    const scene = {
      add: { sprite: vi.fn().mockReturnValue(sprite), image: vi.fn() },
      anims: { exists: vi.fn((key: string) => key === 'token-mage:idle') },
    };

    const token = createHeroToken(scene as never, 'mage', 24, 36);

    expect(scene.add.sprite).toHaveBeenCalledWith(24, 36, 'token-mage');
    expect(scene.add.image).not.toHaveBeenCalled();
    expect(sprite.setOrigin).toHaveBeenCalledWith(0.5, 1);
    expect(sprite.play).toHaveBeenCalledWith('token-mage:idle');
    expect(token).toBe(sprite);
  });

  it('uses the legacy hero image when the token idle animation is missing', () => {
    const image = {
      setDisplaySize: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
    };
    const scene = {
      add: { sprite: vi.fn(), image: vi.fn().mockReturnValue(image) },
      anims: { exists: vi.fn().mockReturnValue(false) },
    };

    const token = createHeroToken(scene as never, 'knight', 24, 36);

    expect(scene.add.sprite).not.toHaveBeenCalled();
    expect(scene.add.image).toHaveBeenCalledWith(24, 36, 'hero-knight');
    expect(image.setDisplaySize).toHaveBeenCalledWith(14, 14);
    expect(token).toBe(image);
  });
});
