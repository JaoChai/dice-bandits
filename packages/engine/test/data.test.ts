import { describe, it, expect } from 'vitest';
import { CLASSES, MONSTERS, ITEMS, WORLD_RULES, BALANCE, CHUNKS } from '../src/data/index';
import type { Chunk } from '../src/data/index';
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

  it('has 8-12 spaces in every chunk', () => {
    expect(CHUNKS.length).toBeGreaterThan(0);
    for (const chunk of CHUNKS) {
      expect(chunk.spaces.length).toBeGreaterThanOrEqual(8);
      expect(chunk.spaces.length).toBeLessThanOrEqual(12);
    }
  });

  it('has exactly 2 chunks per region, each region with exactly one fork of two 3-space lanes', () => {
    const chunksByRegion = new Map<Region, Chunk[]>();
    for (const chunk of CHUNKS) {
      const list = chunksByRegion.get(chunk.region) ?? [];
      list.push(chunk);
      chunksByRegion.set(chunk.region, list);
    }
    expect([...chunksByRegion.keys()].sort()).toEqual(['desert', 'meadow', 'snow', 'volcano']);
    for (const chunks of chunksByRegion.values()) {
      expect(chunks).toHaveLength(2);
      const forks = chunks.filter((c) => c.fork);
      expect(forks).toHaveLength(1);
      const laneSizes = new Map<number, number>();
      for (const space of forks[0]!.spaces) {
        if (space.y !== 0) laneSizes.set(space.y, (laneSizes.get(space.y) ?? 0) + 1);
      }
      expect([...laneSizes.values()].sort((a, b) => a - b)).toEqual([3, 3]);
    }
  });
});
