import { afterEach, describe, expect, it, vi } from 'vitest';
import { motionScale, reducedMotion } from '../../src/art/motion';
import { shake } from '../../src/fx';
import type Phaser from 'phaser';

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

  it('never shakes with reduced motion or instant speed', () => {
    const cameraShake = vi.fn();
    const scene = { cameras: { main: { shake: cameraShake } } } as unknown as Phaser.Scene;
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    shake(scene, 1);
    expect(cameraShake).not.toHaveBeenCalled();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    shake(scene, 0);
    expect(cameraShake).not.toHaveBeenCalled();
    shake(scene, 1);
    expect(cameraShake).toHaveBeenCalledOnce();
  });
});
