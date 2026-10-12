import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crowdLayout as layout, crowdTagLayout } from '../../src/scenes/board/tokens';

type Placement = { x: number; y: number; scale: number; depth: number };
const widths = ['knight', 'thief', 'mage', 'cleric'].map((hero) => {
  const { w, h } = JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../../public/art/hero-${hero}.json`), 'utf8'),
  ).frames.idle;
  return Math.round((w / h) * 72);
});

// Fixed offsets or pair-only visibility miss the middle hero's TWO occluders.
// This independent interval union measures the whole foreground face mask.
function clearFraction(index: number, row: Placement[], sizes: number[]) {
  const left = row[index]!.x - sizes[index]! / 2;
  const right = row[index]!.x + sizes[index]! / 2;
  const intervals = row
    .flatMap((p, i) =>
      p.depth > row[index]!.depth
        ? [[Math.max(left, p.x - sizes[i]! / 2), Math.min(right, p.x + sizes[i]! / 2)]]
        : [],
    )
    .filter(([a, b]) => b! > a!)
    .sort((a, b) => a[0]! - b[0]!);
  let end = left,
    covered = 0;
  for (const [a, b] of intervals) {
    covered += Math.max(0, b! - Math.max(end, a!));
    end = Math.max(end, b!);
  }
  return 1 - covered / sizes[index]!;
}

describe('measured crowd packing', () => {
  it('leaves one hero centred at normal scale and token depth', () => {
    expect(layout([53], -1)).toEqual([{ x: 0, y: 0, scale: 1, depth: 30 }]);
  });
  it.each([2, 3, 4])('keeps every %i-seat class combination and active seat readable', (count) => {
    let cases = 0,
      maxWidth = 0,
      minClear = 1;
    for (let code = 0; code < 4 ** count; code++) {
      const measured = Array.from(
        { length: count },
        (_, i) => widths[Math.floor(code / 4 ** i) % 4]!,
      );
      for (let active = -1; active < count; active++) {
        const row = layout(measured, active);
        const sizes = measured.map((w, i) => w * row[i]!.scale);
        expect(new Set(row.map((p) => p.scale)).size).toBe(1);
        expect(row.every((p) => p.scale >= 0.8 && p.scale <= 0.85 && p.y === 0)).toBe(true);
        const left = row[0]!.x - sizes[0]! / 2,
          right = row.at(-1)!.x + sizes.at(-1)! / 2;
        maxWidth = Math.max(maxWidth, right - left);
        expect(right - left).toBeLessThanOrEqual(155);
        expect(left + right).toBeCloseTo(0);
        if (active >= 0)
          expect(row[active]!.depth).toBeGreaterThan(
            Math.max(...row.filter((_, i) => i !== active).map((p) => p.depth)),
          );
        for (let i = 0; i < count; i++) {
          const clear = clearFraction(i, row, sizes);
          minClear = Math.min(minClear, clear);
          expect(clear, `${code}/${active}/${i}`).toBeGreaterThanOrEqual(0.7);
          for (let j = i + 1; j < count; j++) {
            expect(row[i]!.x).toBeLessThan(row[j]!.x);
            const overlap = Math.max(
              0,
              Math.min(row[i]!.x + sizes[i]! / 2, row[j]!.x + sizes[j]! / 2) -
                Math.max(row[i]!.x - sizes[i]! / 2, row[j]!.x - sizes[j]! / 2),
            );
            expect(overlap / Math.min(sizes[i]!, sizes[j]!)).toBeLessThanOrEqual(0.35);
          }
        }
        cases++;
      }
    }
    console.log(
      `crowd sweep count=${count} cases=${cases} max-width=${maxWidth} min-face-clear=${minClear}`,
    );
  });
});

type Tag = { x: number; y: number };
function tags(widths: number[], centre: number, top: number): Tag[] {
  return crowdTagLayout(widths, 20, centre, top, 3200);
}

describe('measured flat tag rows', () => {
  it.each([20, 1600, 3180])(
    'clamps a single row at map centre %i with full widths and eight-pixel gaps',
    (centre) => {
      const widths = [80, 100, 120, 90];
      const row = tags(widths, centre, 200);
      expect(row.map((p) => p.y)).toEqual([190, 190, 190, 190]);
      for (let i = 0; i < row.length; i++) {
        expect(row[i]!.x - widths[i]! / 2).toBeGreaterThanOrEqual(0);
        expect(row[i]!.x + widths[i]! / 2).toBeLessThanOrEqual(3200);
        if (i)
          expect(row[i]!.x - widths[i]! / 2 - row[i - 1]!.x - widths[i - 1]! / 2).toBeCloseTo(8);
      }
      if (centre === 1600) expect((row[0]!.x - 40 + row[3]!.x + 45) / 2).toBe(1600);
    },
  );
  it('wraps an oversized row into two flat bounded rows ten pixels above the hats', () => {
    const row = tags([900, 900, 900, 900], 3180, 100);
    expect(row.map((p) => p.y)).toEqual([62, 62, 90, 90]);
    expect(row.map((p) => p.x)).toEqual([1842, 2750, 1842, 2750]);
  });
});
