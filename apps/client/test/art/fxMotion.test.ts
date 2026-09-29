import { afterEach, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { shake } from '../../src/fx';

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

it('runs board camera shake at normal speed without reduced motion and suppresses it with reduced motion', () => {
  const cameraShake = vi.fn();
  const scene = { cameras: { main: { shake: cameraShake } } } as unknown as Phaser.Scene;
  window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
  shake(scene, 1);
  expect(cameraShake).toHaveBeenCalledWith(220, 0.008);
  window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
  shake(scene, 1);
  expect(cameraShake).toHaveBeenCalledTimes(1);
});
