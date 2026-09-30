import { describe, expect, it } from 'vitest';
import { encodeWav } from './wav';
import { synth, type SfxSpec } from './synth';
import { SFX_TABLE } from './table';

const IDS = [
  'click',
  'dice',
  'step',
  'battleStart',
  'hit',
  'ko',
  'coin',
  'stolen',
  'levelUp',
  'item',
  'town',
  'win',
];

const decoder = new TextDecoder('ascii');

function text(bytes: Uint8Array, offset: number, length: number): string {
  return decoder.decode(bytes.subarray(offset, offset + length));
}

describe('encodeWav', () => {
  it('writes a little-endian RIFF PCM mono header and 16-bit sample payload', () => {
    const bytes = encodeWav(Int16Array.of(0, 0x1234, -1), 22050);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(text(bytes, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(42);
    expect(text(bytes, 8, 4)).toBe('WAVE');
    expect(text(bytes, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(22050);
    expect(view.getUint32(28, true)).toBe(44100);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(bytes, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(6);
    expect(bytes.byteLength).toBe(50);
    expect([...bytes.subarray(44)]).toEqual([0, 0, 0x34, 0x12, 0xff, 0xff]);
  });
});

describe('synth', () => {
  const tone: SfxSpec = {
    segments: [{ wave: 'square', f0: 440, f1: 660, ms: 100, gain: 1, duty: 0.25 }],
    volume: 0.7,
    attackMs: 2,
    releaseMs: 10,
  };

  it('reproduces the same tone sample bytes on repeated calls', () => {
    const first = synth(tone);
    expect(first.length).toBe(2205);
    expect([...new Uint8Array(first.buffer)]).toEqual([...new Uint8Array(synth(tone).buffer)]);
  });

  it('reproduces seeded noise samples across repeated calls', () => {
    const noise: SfxSpec = {
      segments: [{ wave: 'noise', f0: 100, f1: 100, ms: 80 }],
      volume: 0.6,
    };
    const first = synth(noise);
    expect(first.some((sample) => sample !== 0)).toBe(true);
    expect([...new Uint8Array(first.buffer)]).toEqual([...new Uint8Array(synth(noise).buffer)]);
  });
});

describe('SFX_TABLE', () => {
  it('contains the exact twelve runtime sound ids', () => {
    expect(Object.keys(SFX_TABLE)).toEqual(IDS);
  });

  it('keeps every sound short, silent at the edges, and under 80% full scale', () => {
    for (const id of IDS) {
      const samples = synth(SFX_TABLE[id as keyof typeof SFX_TABLE]);
      expect(samples.length, id).toBeGreaterThan(0);
      expect(samples.length, id).toBeLessThanOrEqual(id === 'win' ? 26460 : 13230);
      expect(samples[0], id).toBe(0);
      expect(samples[samples.length - 1], id).toBe(0);
      expect(Math.max(...samples.map((s) => Math.abs(s))), id).toBeLessThanOrEqual(0.8 * 32767);
    }
  });

  it('encodes the twelve effects within a 300000-byte combined budget', () => {
    const total = IDS.reduce(
      (bytes, id) =>
        bytes + encodeWav(synth(SFX_TABLE[id as keyof typeof SFX_TABLE]), 22050).length,
      0,
    );
    expect(total).toBeLessThanOrEqual(300000);
  });
});
