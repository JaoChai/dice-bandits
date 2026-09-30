import type { AudioSettings } from './settings';

export interface AudioGraph {
  ctx: AudioContext;
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
}

export function createGraph(make: () => AudioContext): AudioGraph {
  const ctx = make();
  const master = ctx.createGain();
  const music = ctx.createGain();
  const sfx = ctx.createGain();
  music.connect(master);
  sfx.connect(master);
  master.connect(ctx.destination);
  return { ctx, master, music, sfx };
}

export function applySettings(graph: AudioGraph, settings: AudioSettings): void {
  graph.master.gain.setValueAtTime(settings.muted ? 0 : 1, graph.ctx.currentTime);
  graph.music.gain.value = settings.music;
  graph.sfx.gain.value = settings.sfx;
}

export function loadBuffer(
  ctx: AudioContext,
  url: string,
  fetcher?: typeof fetch,
): Promise<AudioBuffer | null> {
  const doFetch = fetcher ?? fetch;
  return (async () => {
    try {
      const response = await doFetch(url);
      if (!response.ok) {
        console.warn(`[audio] fetch failed for ${url}: HTTP ${response.status}`);
        return null;
      }
      const bytes = await response.arrayBuffer();
      return await ctx.decodeAudioData(bytes);
    } catch (error) {
      console.warn(`[audio] load failed for ${url}: ${message(error)}`);
      return null;
    }
  })();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
