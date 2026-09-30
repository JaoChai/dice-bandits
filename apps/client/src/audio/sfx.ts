import { loadBuffer, type AudioGraph } from './context';
import { SFX_IDS, type SfxId } from './events';

const THROTTLE_SECONDS = 0.08;
const MAX_VOICES = 6;

export interface SfxPlayer {
  preload: () => void;
  play: (id: SfxId) => void;
}

interface Voice {
  source: AudioBufferSourceNode;
}

export function SfxPlayer(
  graph: AudioGraph,
  opts: {
    url: (id: SfxId) => string;
    onStart?: (id: SfxId) => void;
    fetcher?: typeof fetch;
  },
): SfxPlayer {
  const buffers = new Map<SfxId, AudioBuffer>();
  const lastPlayedAt = new Map<SfxId, number>();
  const voices: Voice[] = [];

  function preload(): void {
    for (const id of SFX_IDS) {
      loadBuffer(graph.ctx, opts.url(id), opts.fetcher)
        .then((buffer) => {
          if (buffer) buffers.set(id, buffer);
        })
        .catch((error: unknown) => {
          console.warn(`[audio] sfx preload failed for ${id}: ${describe(error)}`);
        });
    }
  }

  function play(id: SfxId): void {
    const buffer = buffers.get(id);
    if (!buffer) return;
    const at = graph.ctx.currentTime;
    const last = lastPlayedAt.get(id);
    if (last !== undefined && at - last < THROTTLE_SECONDS) return;
    if (voices.length >= MAX_VOICES) return;
    lastPlayedAt.set(id, at);
    const source = graph.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(graph.sfx);
    voices.push({ source });
    source.onended = () => {
      const index = voices.findIndex((candidate) => candidate.source === source);
      if (index !== -1) voices.splice(index, 1);
    };
    source.start(at);
    opts.onStart?.(id);
  }

  return { preload, play };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
