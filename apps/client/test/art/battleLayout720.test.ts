import { describe, expect, it } from 'vitest';
import { BATTLE_EXCHANGE_Y, battleLayout, type BattleRect } from '../../src/scenes/battle/layout';

const intersects = (a: BattleRect, b: BattleRect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/**
 * Task 8 RED: the cartoon battle layout at the 1280×720 logical canvas.
 * Fighters are 280 px tall puppets, command cards reserve 180×240 each, and
 * the HP / dice / cards bands stay disjoint inside the frame.
 */
describe('cartoon battleLayout at 1280×720 (Task 8)', () => {
  const layout = battleLayout();

  it('keeps HP, dice and card bands disjoint within the 1280×720 frame', () => {
    const rects = [layout.hpLeft, layout.hpRight, layout.dice, layout.cards];
    for (const rect of rects) {
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(1280);
      expect(rect.y + rect.height).toBeLessThanOrEqual(720);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++)
        expect(intersects(rects[i]!, rects[j]!)).toBe(false);
  });

  it('reserves 180×240 command cards inside the frame', () => {
    expect(layout.cards.width).toBe(180);
    expect(layout.cards.height).toBe(240);
    expect(layout.cards.y + layout.cards.height).toBeLessThanOrEqual(720);
  });

  it('stands 280 px fighters clear of the dice band and the HP strip', () => {
    expect(layout.left.y).toBe(660);
    expect(layout.right.y).toBe(660);
    expect(layout.left.y - 280).toBeGreaterThan(layout.hpLeft.y + layout.hpLeft.height);
    expect(layout.left.y - 280).toBeGreaterThan(layout.hpRight.y + layout.hpRight.height);
    expect(layout.dice.y).toBeGreaterThanOrEqual(660 - 120);
  });

  it('separates the fighters across the centre line', () => {
    expect(layout.left.x + 280).toBeLessThan(layout.right.x - 280);
    expect(layout.left.x).toBeGreaterThan(0);
    expect(layout.right.x).toBeLessThan(1280);
  });

  it('keeps the exchange label clear of the HP strip at 1280×720', () => {
    expect(BATTLE_EXCHANGE_Y).toBeGreaterThan(layout.hpLeft.y + layout.hpLeft.height);
    expect(BATTLE_EXCHANGE_Y).toBeLessThan(layout.dice.y);
  });
});
