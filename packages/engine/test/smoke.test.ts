import { describe, it, expect } from 'vitest';
import { ENGINE_VERSION } from '../src/index';

describe('engine package', () => {
  it('exposes a version', () => {
    expect(ENGINE_VERSION).toBe(1);
  });
});
