export type RngState = [number, number, number, number]; // sfc32 words (uint32)

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function sfc32(s: RngState): [number, RngState] {
  let [a, b, c, d] = s;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) >>> 0;
  return [t, [a >>> 0, b >>> 0, c >>> 0, d]];
}

export function seedRng(seed: string): RngState {
  const h = xmur3(seed);
  let s: RngState = [h(), h(), h(), h()];
  for (let i = 0; i < 15; i++) s = sfc32(s)[1];
  return s;
}

export function nextFloat(s: RngState): [number, RngState] {
  const [t, n] = sfc32(s);
  return [t / 4294967296, n];
}

export function nextInt(s: RngState, min: number, max: number): [number, RngState] {
  const [f, n] = nextFloat(s);
  return [min + Math.floor(f * (max - min + 1)), n];
}

export function pick<T>(s: RngState, arr: readonly T[]): [T, RngState] {
  const [i, n] = nextInt(s, 0, arr.length - 1);
  return [arr[i] as T, n];
}

export function shuffle<T>(s: RngState, arr: readonly T[]): [T[], RngState] {
  const out = [...arr];
  let st = s;
  for (let i = out.length - 1; i > 0; i--) {
    const [j, n] = nextInt(st, 0, i);
    st = n;
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return [out, st];
}
