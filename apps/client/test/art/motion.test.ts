import { afterEach, describe, expect, it, vi } from 'vitest';
import { motionScale, reducedMotion } from '../../src/art/motion';

describe('art motion policy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.diceBanditsSpeed = 1;
  });

  it('uses the configured speed scale', () => {
    window.diceBanditsSpeed = 0;
    expect(motionScale()).toBe(0);
    window.diceBanditsSpeed = 0.5;
    expect(motionScale()).toBe(0.5);
    window.diceBanditsSpeed = 1;
    expect(motionScale()).toBe(1);
  });

  it('follows the prefers-reduced-motion media query', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', matchMedia);
    expect(reducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    expect(reducedMotion()).toBe(false);
  });
});
