import { describe, it, expect } from 'vitest';
import { CLASSES, MONSTERS, ITEMS, WORLD_RULES, BALANCE } from '../src/data/index';
import type { Region } from '../src/types';

const REGIONS: Region[] = ['meadow', 'desert', 'snow', 'volcano'];

describe('data tables', () => {
  it('has 4 classes, each with a secret', () => {
    const defs = Object.values(CLASSES);
    expect(defs).toHaveLength(4);
    for (const def of defs) expect(def.secret).toBeTruthy();
  });

  it('has exactly 30 unique item ids', () => {
    expect(ITEMS).toHaveLength(30);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(30);
  });

  it('has valid item kinds and equipment slots', () => {
    const kinds = new Set(['field', 'battle', 'equipment']);
    for (const item of ITEMS) {
      expect(kinds.has(item.kind)).toBe(true);
      if (item.kind === 'equipment') {
        expect(item.slot === 'weapon' || item.slot === 'armor').toBe(true);
      } else {
        expect(item.slot).toBeNull();
      }
    }
  });

  it('has at least 2 monsters for every region', () => {
    const monsters = Object.values(MONSTERS);
    expect(monsters.length).toBeGreaterThanOrEqual(6);
    for (const region of REGIONS) {
      const count = monsters.filter((m) => m.regions.includes(region)).length;
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });

  it('has xpToLevel matching the level cap and strictly increasing', () => {
    expect(BALANCE.xpToLevel).toHaveLength(BALANCE.levelCap);
    for (let i = 1; i < BALANCE.xpToLevel.length; i++) {
      const prev = BALANCE.xpToLevel[i - 1] as number;
      const cur = BALANCE.xpToLevel[i] as number;
      expect(cur).toBeGreaterThan(prev);
    }
  });

  it('has 6 world rules', () => {
    expect(Object.keys(WORLD_RULES)).toHaveLength(6);
  });

  it('has positive slot weights for every board bag kind', () => {
    const kinds = ['town', 'monster', 'chest', 'event', 'trap'] as const;
    expect(Object.keys(BALANCE.slotWeights).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) expect(BALANCE.slotWeights[kind]).toBeGreaterThan(0);
  });
});
