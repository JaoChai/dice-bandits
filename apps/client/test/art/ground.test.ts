import type { Region } from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import { groundRegions } from '../../src/scenes/board/ground';

const identity = (x: number, y: number) => ({ x, y });
// Two spaces: meadow on the left half, desert on the right half of 640x360.
const spaces: { x: number; y: number; region: Region }[] = [
  { x: 160, y: 180, region: 'meadow' },
  { x: 480, y: 180, region: 'desert' },
];

describe('groundRegions', () => {
  const cells = groundRegions(spaces, identity, 640, 360);

  it('covers the whole 640x360 canvas with 32 px cells', () => {
    expect(cells).toHaveLength(20 * 12);
    for (const cell of cells) {
      expect(cell.gx - 16).toBeGreaterThanOrEqual(0);
      expect(cell.gy - 16).toBeGreaterThanOrEqual(0);
    }
    expect(Math.max(...cells.map((cell) => cell.gx + 16))).toBeGreaterThanOrEqual(640);
    expect(Math.max(...cells.map((cell) => cell.gy + 16))).toBeGreaterThanOrEqual(360);
  });

  it('gives each cell the region of its nearest space', () => {
    expect(cells.find((cell) => cell.gx === 16 && cell.gy === 16)!.region).toBe('meadow');
    expect(cells.find((cell) => cell.gx === 624 && cell.gy === 16)!.region).toBe('desert');
  });

  it('dithers exactly the one-cell border between two regions', () => {
    for (const cell of cells) {
      const neighbours = cells.filter(
        (other) =>
          Math.abs(other.gx - cell.gx) + Math.abs(other.gy - cell.gy) === 32 &&
          other.region !== cell.region,
      );
      if (neighbours.length === 0) {
        expect(cell.dither).toBeUndefined();
      } else {
        expect(neighbours.map((other) => other.region)).toContain(cell.dither);
      }
    }
    // The meadow/desert seam exists and is dithered on both sides.
    const dithered = cells.filter((cell) => cell.dither !== undefined);
    expect(dithered.some((cell) => cell.region === 'meadow')).toBe(true);
    expect(dithered.some((cell) => cell.region === 'desert')).toBe(true);
  });
});
