import { loadBuffer, type AudioGraph } from './context';
import type { MusicId } from './events';

const FADE_SECONDS = 0.5;

export interface MusicPlayer {
  set: (track: MusicId | 'none') => void;
}

interface Track {
  id: MusicId;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export function MusicPlayer(
  graph: AudioGraph,
  opts: { url: (id: MusicId) => string; fetcher?: typeof fetch },
): MusicPlayer {
  const buffers = new Map<MusicId, AudioBuffer>();
  let current: Track | null = null;
  let desired: MusicId | 'none' = 'none';

  function set(track: MusicId | 'none'): void {
    desired = track;
    if (!current) {
      start(track);
      return;
    }
    if (current.id === track) return;
    fadeOut(current);
    current = null;
    start(track);
  }

  function fadeOut(track: Track): void {
    const at = graph.ctx.currentTime;
    track.gain.gain.cancelScheduledValues(at);
    track.gain.gain.setValueAtTime(track.gain.gain.value, at);
    track.gain.gain.linearRampToValueAtTime(0, at + FADE_SECONDS);
    track.source.stop(at + FADE_SECONDS);
  }

  function start(track: MusicId | 'none'): void {
    if (track === 'none') return;
    const cached = buffers.get(track);
    if (cached) {
      begin(track, cached);
      return;
    }
    loadBuffer(graph.ctx, opts.url(track), opts.fetcher)
      .then((buffer) => {
        if (!buffer) return;
        buffers.set(track, buffer);
        if (desired === track && !current) begin(track, buffer);
      })
      .catch((error: unknown) => {
        console.warn(`[audio] music load failed for ${track}: ${describe(error)}`);
      });
  }

  function begin(track: MusicId, buffer: AudioBuffer): void {
    const gain = graph.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(graph.music);
    const source = graph.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.onended = () => {
      gain.disconnect();
    };
    source.start();
    const at = graph.ctx.currentTime;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(1, at + FADE_SECONDS);
    current = { id: track, source, gain };
  }

  return { set };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
