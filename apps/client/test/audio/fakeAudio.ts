import { SFX_IDS, type MusicId } from '../../src/audio/events';

export interface FakeParamEvent {
  method: 'setValueAtTime' | 'linearRampToValueAtTime' | 'cancelScheduledValues';
  value: number;
  time: number;
}

export class FakeAudioParam {
  value = 1;
  readonly events: FakeParamEvent[] = [];

  setValueAtTime(value: number, time: number): void {
    this.value = value;
    this.events.push({ method: 'setValueAtTime', value, time });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.events.push({ method: 'linearRampToValueAtTime', value, time });
  }

  cancelScheduledValues(time: number): void {
    this.events.push({ method: 'cancelScheduledValues', value: Number.NaN, time });
  }

  last(method: FakeParamEvent['method']): FakeParamEvent | undefined {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const event = this.events[i];
      if (event && event.method === method) return event;
    }
    return undefined;
  }
}

export class FakeGainNode {
  readonly gain = new FakeAudioParam();
  readonly connections: unknown[] = [];

  connect(destination: unknown): unknown {
    this.connections.push(destination);
    return destination;
  }
}

export class FakeAudioBuffer {
  constructor(readonly duration: number) {}
}

export class FakeBufferSourceNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  readonly connections: unknown[] = [];
  onended: (() => void) | null = null;
  started = false;
  readonly startCalls: number[] = [];
  readonly stopCalls: number[] = [];

  connect(destination: unknown): unknown {
    this.connections.push(destination);
    return destination;
  }

  start(...time: number[]): void {
    this.started = true;
    if (time.length > 0 && time[0] !== undefined) this.startCalls.push(time[0]);
  }

  stop(...time: number[]): void {
    if (time.length > 0 && time[0] !== undefined) this.stopCalls.push(time[0]);
  }

  fireEnded(): void {
    this.onended?.();
  }
}

export interface FakeAudioContextOptions {
  decodeError?: Error;
}

export class FakeAudioContext {
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 0;
  readonly destination = new FakeGainNode();
  readonly gains: FakeGainNode[] = [];
  readonly sources: FakeBufferSourceNode[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  private readonly decodeError: Error | undefined;

  constructor(options: FakeAudioContextOptions = {}) {
    this.decodeError = options.decodeError;
  }

  createGain(): FakeGainNode {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain;
  }

  createBufferSource(): FakeBufferSourceNode {
    const source = new FakeBufferSourceNode();
    this.sources.push(source);
    return source;
  }

  decodeAudioData(buffer: ArrayBuffer): Promise<AudioBuffer> {
    if (this.decodeError) return Promise.reject(this.decodeError);
    return Promise.resolve(new FakeAudioBuffer(buffer.byteLength / 8) as unknown as AudioBuffer);
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspendCalls += 1;
    this.state = 'suspended';
    return Promise.resolve();
  }
}

export type RecordingFetch = typeof fetch & { requests: string[] };

export function fakeFetch(map: Record<string, ArrayBuffer | Uint8Array>): RecordingFetch {
  const requests: string[] = [];
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    const bytes = map[url];
    if (!bytes) {
      return {
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response;
    }
    const body = bytes instanceof ArrayBuffer ? bytes : toArrayBuffer(bytes);
    return { ok: true, status: 200, arrayBuffer: async () => body } as unknown as Response;
  };
  return Object.assign(impl, { requests }) as RecordingFetch;
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

export function fakeAudioUrlMap(): Record<string, ArrayBuffer> {
  const map: Record<string, ArrayBuffer> = {};
  for (const id of SFX_IDS) map[`/audio/sfx/${id}.wav`] = new ArrayBuffer(64);
  const musicIds: readonly MusicId[] = ['board', 'battle'];
  for (const id of musicIds) {
    // Durations are byteLength/8: board = 10 s, battle = 12 s, deterministic per track.
    map[`/audio/music/${id}.ogg`] = new ArrayBuffer(id === 'board' ? 80 : 96);
    map[`/audio/music/${id}.mp3`] = new ArrayBuffer(id === 'board' ? 80 : 96);
  }
  return map;
}

export function asAudioContext(fake: FakeAudioContext): AudioContext {
  return fake as unknown as AudioContext;
}

export function destinationOf(ctx: AudioContext): FakeGainNode {
  return (ctx as unknown as FakeAudioContext).destination;
}

export function paramOf(node: AudioNode): FakeAudioParam {
  return (node as unknown as FakeGainNode).gain;
}

export function connectionsOf(node: AudioNode): unknown[] {
  return (node as unknown as FakeGainNode).connections;
}

export function sourcesOf(ctx: AudioContext): FakeBufferSourceNode[] {
  return (ctx as unknown as FakeAudioContext).sources;
}

export function startedSources(ctx: AudioContext): FakeBufferSourceNode[] {
  return sourcesOf(ctx).filter((source) => source.started);
}

export async function flushAudio(): Promise<void> {
  for (let i = 0; i < 25; i += 1) await Promise.resolve();
}
