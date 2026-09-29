import { data, type ClassId, type Region, type SpaceKind } from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import { CLASS_ACCENT, MONSTER_SHEETS, REGION_VISUALS, SPACE_VISUALS } from '../../src/art/tables';

describe('art visual tables', () => {
  it('provides visual metadata for every engine region and space kind', () => {
    const regions: Region[] = ['meadow', 'desert', 'snow', 'volcano'];
    const kinds: SpaceKind[] = ['castle', 'town', 'shop', 'chest', 'monster', 'event', 'trap'];

    expect(Object.keys(REGION_VISUALS).sort()).toEqual([...regions].sort());
    expect(Object.keys(SPACE_VISUALS).sort()).toEqual([...kinds].sort());
    for (const visual of Object.values(REGION_VISUALS)) {
      expect(visual.ground).toBeTruthy();
      expect(visual.backdrop).toBeTruthy();
      expect(visual.ambient).toBeTruthy();
      expect(Number.isInteger(visual.road)).toBe(true);
    }
    for (const visual of Object.values(SPACE_VISUALS)) {
      expect(Number.isInteger(visual.tile)).toBe(true);
      expect(visual.icon).toBeTruthy();
    }
  });

  it('provides class accents and monster sheets for engine ids', () => {
    const classes = Object.keys(data.CLASSES) as ClassId[];
    const monsters = Object.keys(data.MONSTERS);

    expect(Object.keys(CLASS_ACCENT).sort()).toEqual([...classes].sort());
    expect(monsters).toEqual(
      expect.arrayContaining([
        'goldSlime',
        'mushroomBandit',
        'lanternGhost',
        'mimic',
        'rockGolem',
        'shadowImp',
      ]),
    );
    expect(Object.keys(MONSTER_SHEETS).sort()).toEqual([...monsters].sort());
    for (const accent of Object.values(CLASS_ACCENT)) expect(accent).toMatch(/^#[\da-f]{6}$/i);
    for (const key of Object.values(MONSTER_SHEETS)) expect(key).toMatch(/^monster-/);
  });
});
