import { describe, expect, it } from 'vitest';
import { BATTLE_EXCHANGE_Y, battleLayout, type BattleRect } from '../../src/scenes/battle/layout';

const intersects = (a: BattleRect, b: BattleRect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

describe('battleLayout', () => {
  it('reserves disjoint HP, dice and card rectangles within the 640×360 frame', () => {
    const layout = battleLayout();
    const rects = [layout.hpLeft, layout.hpRight, layout.dice, layout.cards];
    for (const rect of rects) {
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(640);
      expect(rect.y + rect.height).toBeLessThanOrEqual(360);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++)
        expect(intersects(rects[i]!, rects[j]!)).toBe(false);
  });

  it('places two non-overlapping 80px fighters above the dice, with cards below', () => {
    const { left, right, hpLeft, hpRight, dice, cards } = battleLayout();
    expect(left.x + 80).toBeLessThan(right.x - 80);
    expect(left.y).toBeGreaterThan(hpLeft.y + hpLeft.height);
    expect(right.y).toBeGreaterThan(hpRight.y + hpRight.height);
    expect(dice.y).toBeGreaterThan(left.y);
    expect(dice.y).toBeGreaterThan(right.y);
    expect(dice.y + dice.height).toBeLessThanOrEqual(cards.y);
  });

  it('places the exchange label below the mobile header without crossing the HP strip', () => {
    // At a 915×412 viewport, the 640×360 canvas fits at 412/360, while the header ends at y=94px.
    const scale = 412 / 360;
    expect((BATTLE_EXCHANGE_Y - 12) * scale).toBeGreaterThan(94);
    expect(BATTLE_EXCHANGE_Y).toBeLessThan(battleLayout().dice.y);
  });

  it('scales positions and rectangles to a different frame without overlaps', () => {
    const layout = battleLayout(1280, 720);
    expect(layout.left.x).toBe(battleLayout().left.x * 2);
    expect(layout.dice.width).toBe(battleLayout().dice.width * 2);
    expect(layout.cards.y + layout.cards.height).toBeLessThanOrEqual(720);
  });
});
