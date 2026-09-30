import type { SfxSpec } from './synth';

export const SFX_TABLE: Record<
  | 'click'
  | 'dice'
  | 'step'
  | 'battleStart'
  | 'hit'
  | 'ko'
  | 'coin'
  | 'stolen'
  | 'levelUp'
  | 'item'
  | 'town'
  | 'win',
  SfxSpec
> = {
  click: {
    segments: [{ wave: 'square', f0: 1800, f1: 1600, ms: 30 }],
    volume: 0.24,
  },
  dice: {
    segments: [
      { wave: 'noise', f0: 0, f1: 0, ms: 50 },
      { wave: 'noise', f0: 0, f1: 0, ms: 40, gain: 0 },
      { wave: 'noise', f0: 0, f1: 0, ms: 50 },
      { wave: 'noise', f0: 0, f1: 0, ms: 40, gain: 0 },
      { wave: 'noise', f0: 0, f1: 0, ms: 50 },
    ],
    volume: 0.35,
  },
  step: {
    segments: [{ wave: 'triangle', f0: 440, f1: 520, ms: 60 }],
    volume: 0.35,
  },
  battleStart: {
    segments: [330, 440, 660].map((frequency) => ({
      wave: 'square',
      f0: frequency,
      f1: frequency,
      ms: 90,
    })),
    volume: 0.45,
  },
  hit: {
    segments: [
      { wave: 'noise', f0: 0, f1: 0, ms: 40 },
      { wave: 'square', f0: 180, f1: 60, ms: 80 },
    ],
    volume: 0.55,
  },
  ko: {
    segments: [{ wave: 'square', f0: 440, f1: 55, ms: 450 }],
    volume: 0.45,
    releaseMs: 130,
  },
  coin: {
    segments: [
      { wave: 'square', f0: 988, f1: 988, ms: 70, duty: 0.25 },
      { wave: 'square', f0: 1319, f1: 1319, ms: 180, duty: 0.25 },
    ],
    volume: 0.42,
    releaseMs: 80,
  },
  stolen: {
    segments: [660, 494, 330].map((frequency) => ({
      wave: 'square',
      f0: frequency,
      f1: frequency,
      ms: 90,
    })),
    volume: 0.4,
  },
  levelUp: {
    segments: [523, 659, 784, 1047].map((frequency) => ({
      wave: 'square',
      f0: frequency,
      f1: frequency,
      ms: 80,
    })),
    volume: 0.4,
  },
  item: {
    segments: [{ wave: 'triangle', f0: 600, f1: 900, ms: 90 }],
    volume: 0.4,
  },
  town: {
    segments: [
      { wave: 'triangle', f0: 784, f1: 760, ms: 200 },
      { wave: 'triangle', f0: 1175, f1: 1120, ms: 200, gain: 0.75 },
    ],
    volume: 0.48,
    releaseMs: 110,
  },
  win: {
    segments: [
      ...[523, 659, 784].map((frequency) => ({
        wave: 'square' as const,
        f0: frequency,
        f1: frequency,
        ms: 120,
      })),
      { wave: 'square', f0: 1047, f1: 1047, ms: 400, duty: 0.25 },
    ],
    volume: 0.47,
    releaseMs: 160,
  },
};
