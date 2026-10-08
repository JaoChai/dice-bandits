import { describe, expect, it } from 'vitest';
import { battleLayout, type BattleRect } from '../../src/scenes/battle/layout';

const intersects = (a: BattleRect, b: BattleRect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Legacy 640×360 metrics were replaced by the 1280×720 cartoon layout (Task 8). */
describe('battleLayout', () => {
  // Fixed 280px fighters / 660px feet fail these viewport-owned lane checks.
  it.each([
    { width: 1280, height: 720, cssHeight: 720, target: 330 },
    { width: (915 * 720) / 412, height: 720, cssHeight: 412, target: 180 },
    { width: (932 * 720) / 388, height: 720, cssHeight: 388, target: 180 },
  ])(
    'reserves readable fighters above commands at $width × $height',
    ({ width, height, cssHeight, target }) => {
      const layout = battleLayout(width, height);
      const cssScale = cssHeight / height;
      expect(layout.fighterHeight * cssScale).toBeGreaterThanOrEqual(target - 12);
      expect(layout.fighterHeight * cssScale).toBeLessThanOrEqual(target + 12);
      expect(layout.left.y).toBe(layout.groundY);
      expect(layout.right.y).toBe(layout.groundY);
      expect(layout.groundY * cssScale).toBeLessThanOrEqual(cssHeight - 100);
      expect(layout.groundY - layout.fighterHeight).toBeGreaterThan(layout.exchangeY + 20);
      expect(layout.exchangeY).toBeGreaterThan(layout.hpLeft.y + layout.hpLeft.height);
      expect(layout.exchangeY).toBeLessThan(layout.groundY - layout.fighterHeight);
      expect(layout.cards.y + layout.cards.height).toBeLessThanOrEqual(height);
      expect(layout.dice.y).toBeGreaterThan(layout.groundY);
    },
  );
  it('keeps every band inside the 1280×720 frame', () => {
    const layout = battleLayout();
    const rects = [layout.hpLeft, layout.hpRight, layout.dice, layout.cards];
    for (const rect of rects) {
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(1280);
      expect(rect.y + rect.height).toBeLessThanOrEqual(720);
    }
  });

  it('reserves disjoint HP, dice and card rectangles', () => {
    const layout = battleLayout();
    const rects = [layout.hpLeft, layout.hpRight, layout.dice, layout.cards];
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++)
        expect(intersects(rects[i]!, rects[j]!)).toBe(false);
  });

  it('scales positions and rectangles to a smaller frame proportionally', () => {
    const layout = battleLayout(640, 360);
    const base = battleLayout();
    expect(layout.left.x).toBe(base.left.x / 2);
    expect(layout.dice.width).toBe(base.dice.width / 2);
    expect(layout.cards.y + layout.cards.height).toBeLessThanOrEqual(360);
  });
});
