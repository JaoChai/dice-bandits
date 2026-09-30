export type Wave = 'square' | 'triangle' | 'saw' | 'noise';

export interface Segment {
  wave: Wave;
  f0: number;
  f1: number;
  ms: number;
  gain?: number;
  duty?: number;
}

export interface SfxSpec {
  segments: Segment[];
  volume: number;
  attackMs?: number;
  releaseMs?: number;
}

// Reset for each render: repeated renders and different machines produce the same noise.
const NOISE_SEED = 0x5eed1234;

export function synth(spec: SfxSpec, sampleRate = 22050): Int16Array {
  const lengths = spec.segments.map((segment) => Math.round((segment.ms * sampleRate) / 1000));
  const length = lengths.reduce((sum, count) => sum + count, 0);
  const samples = new Int16Array(length);
  const attack = Math.max(2, spec.attackMs ?? 2) * (sampleRate / 1000);
  const release = Math.max(10, spec.releaseMs ?? 10) * (sampleRate / 1000);
  let state = NOISE_SEED;
  let offset = 0;

  for (const [segmentIndex, segment] of spec.segments.entries()) {
    const count = lengths[segmentIndex];
    let phase = 0;
    for (let index = 0; index < count; index++) {
      const frequency = segment.f0 + (segment.f1 - segment.f0) * (index / Math.max(1, count - 1));
      phase = (phase + frequency / sampleRate) % 1;
      let wave: number;
      switch (segment.wave) {
        case 'square':
          wave = phase < (segment.duty ?? 0.5) ? 1 : -1;
          break;
        case 'triangle':
          wave = 1 - 4 * Math.abs(phase - 0.5);
          break;
        case 'saw':
          wave = 2 * phase - 1;
          break;
        case 'noise':
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
          wave = (state / 0xffffffff) * 2 - 1;
          break;
      }
      const position = offset + index;
      const envelope = Math.min(1, position / attack, (length - 1 - position) / release);
      const amplitude =
        Math.min(0.8, Math.max(0, spec.volume)) *
        Math.min(1, Math.max(0, segment.gain ?? 1)) *
        envelope;
      samples[position] = Math.round(wave * amplitude * 32767);
    }
    offset += count;
  }
  return samples;
}
