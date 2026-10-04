import { data, type ClassId } from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import { CLASS_ACCENT } from '../../src/art/tables';

describe('art visual tables', () => {
  it('provides class accents for every engine class id', () => {
    const classes = Object.keys(data.CLASSES) as ClassId[];
    expect(Object.keys(CLASS_ACCENT).sort()).toEqual([...classes].sort());
    for (const accent of Object.values(CLASS_ACCENT)) expect(accent).toMatch(/^#[\da-f]{6}$/i);
  });
});
