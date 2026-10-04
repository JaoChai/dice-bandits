import { describe, expect, it } from 'vitest';
import { seatColors } from '../../src/art/colors';

describe('seatColors', () => {
  it('gives unique hero signature colours for the default all-distinct crew', () => {
    expect(seatColors(['knight', 'thief', 'mage', 'cleric'])).toEqual([
      '#2E7FE0',
      '#3BA84A',
      '#6C2EBE',
      '#D42B3A',
    ]);
  });

  it('falls back through unused colours when a class repeats', () => {
    const colors = seatColors(['knight', 'knight', 'thief']);
    expect(new Set(colors).size).toBe(3);
    expect(colors[0]).toBe('#2E7FE0');
    // The duplicate seat takes the first unused colour, not the thief green.
    expect(colors[1]).toBe('#F07818');
    expect(colors[2]).toBe('#3BA84A');
  });

  it('keeps every seat distinct when all four pick the same class', () => {
    const colors = seatColors(['mage', 'mage', 'mage', 'mage']);
    expect(new Set(colors).size).toBe(4);
    expect(colors[0]).toBe('#6C2EBE');
  });

  it('covers duplicate-heavy crews from the shared fallback pool', () => {
    const colors = seatColors(['thief', 'thief', 'thief', 'thief', 'knight']);
    expect(new Set(colors).size).toBe(5);
    expect(colors[0]).toBe('#3BA84A');
    expect(colors[4]).toBe('#2E7FE0');
  });

  it('returns hex strings usable as CSS custom-property values', () => {
    for (const color of seatColors(['knight', 'knight'])) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
