import { createGame } from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import { BATTLE_EXCHANGE_Y, battleLayout, type BattleRect } from '../../src/scenes/battle/layout';

const intersects = (a: BattleRect, b: BattleRect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Legacy 640×360 metrics were replaced by the 1280×720 cartoon layout (Task 8). */
describe('battleLayout', () => {
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
