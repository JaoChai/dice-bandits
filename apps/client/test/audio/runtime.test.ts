import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySettings, createGraph, loadBuffer, type AudioGraph } from '../../src/audio/context';
import { SfxPlayer } from '../../src/audio/sfx';
import { MusicPlayer } from '../../src/audio/music';
import type { SfxId } from '../../src/audio/events';
import {
  asAudioContext,
  connectionsOf,
  destinationOf,
  FakeAudioBuffer,
  FakeAudioContext,
  fakeAudioUrlMap,
  fakeFetch,
  flushAudio,
  paramOf,
  sourcesOf,
  startedSources,
} from './fakeAudio';

function makeGraph(fake: FakeAudioContext): AudioGraph {
  return createGraph(() => asAudioContext(fake));
}

function trackGains(fake: FakeAudioContext, graph: AudioGraph) {
  return fake.gains.filter(
    (gain) =>
      gain !== (graph.master as unknown) &&
      gain !== (graph.music as unknown) &&
      gain !== (graph.sfx as unknown),
  );
}

const sfxUrl = (id: SfxId): string => `/audio/sfx/${id}.wav`;
const musicUrl = (id: 'board' | 'battle'): string => `/audio/music/${id}.ogg`;

let warns: string[] = [];

beforeEach(() => {
  warns = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warns.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createGraph', () => {
  it('routes music and sfx through master into destination with three gains', () => {
    const fake = new FakeAudioContext();
    const graph = makeGraph(fake);
    const destination = destinationOf(asAudioContext(fake));
    expect(graph.ctx).toBe(asAudioContext(fake));
    expect(connectionsOf(graph.music)).toContain(graph.master as unknown);
    expect(connectionsOf(graph.sfx)).toContain(graph.master as unknown);
    expect(connectionsOf(graph.master)).toContain(destination);
    expect(fake.gains.length).toBe(3);
  });
});

describe('applySettings', () => {
  it('mutes master to zero and restores volumes on unmute', () => {
    const fake = new FakeAudioContext();
    const graph = makeGraph(fake);
    applySettings(graph, { muted: true, music: 0.5, sfx: 0.8 });
    expect(paramOf(graph.master).last('setValueAtTime')?.value).toBe(0);
    expect(paramOf(graph.music).value).toBe(0.5);
    expect(paramOf(graph.sfx).value).toBe(0.8);
    applySettings(graph, { muted: false, music: 0.4, sfx: 0.6 });
    expect(paramOf(graph.master).last('setValueAtTime')?.value).toBe(1);
    expect(paramOf(graph.music).value).toBe(0.4);
    expect(paramOf(graph.sfx).value).toBe(0.6);
  });
});

describe('loadBuffer', () => {
  it('decodes a fetched file', async () => {
    const fake = new FakeAudioContext();
    const fetcher = fakeFetch({ '/audio/sfx/dice.wav': new ArrayBuffer(64) });
    const buffer = await loadBuffer(asAudioContext(fake), '/audio/sfx/dice.wav', fetcher);
    expect(buffer).not.toBeNull();
    expect(fetcher.requests).toEqual(['/audio/sfx/dice.wav']);
  });

  it('resolves null and warns exactly once on a 404', async () => {
    const fake = new FakeAudioContext();
    const fetcher = fakeFetch({});
    const buffer = await loadBuffer(asAudioContext(fake), '/audio/sfx/missing.wav', fetcher);
    expect(buffer).toBeNull();
    expect(warns.length).toBe(1);
    expect(warns[0]?.startsWith('[audio]')).toBe(true);
  });

  it('resolves null and warns exactly once when decoding fails', async () => {
    const fake = new FakeAudioContext({ decodeError: new Error('bad data') });
    const fetcher = fakeFetch({ '/audio/sfx/dice.wav': new ArrayBuffer(64) });
    const buffer = await loadBuffer(asAudioContext(fake), '/audio/sfx/dice.wav', fetcher);
    expect(buffer).toBeNull();
    expect(warns.length).toBe(1);
    expect(warns[0]?.startsWith('[audio]')).toBe(true);
  });
});

describe('sfx player', () => {
  it('starts a preloaded sound routed into the sfx branch', async () => {
    const fake = new FakeAudioContext();
    const graph = makeGraph(fake);
    const fetcher = fakeFetch(fakeAudioUrlMap());
    const player = SfxPlayer(graph, { url: sfxUrl, fetcher });
    player.preload();
    await flushAudio();
    player.play('dice');
    const started = startedSources(asAudioContext(fake));
    expect(started.length).toBe(1);
    expect(started[0]?.loop).toBe(false);
    expect(connectionsOf(started[0] as never)).toContain(graph.sfx as unknown);
  });

  it('throttles the same id within 80 ms on the audio clock', async () => {
    const fake = new FakeAudioContext();
    const graph = makeGraph(fake);
    const fetcher = fakeFetch(fakeAudioUrlMap());
    const player = SfxPlayer(graph, { url: sfxUrl, fetcher });
    player.preload();
    await flushAudio();
    player.play('dice');
    fake.currentTime = 0.05;
    player.play('dice');
    expect(startedSources(asAudioContext(fake)).length).toBe(1);
    fake.currentTime = 0.1;
    player.play('dice');
    expect(startedSources(asAudioContext(fake)).length).toBe(2);
  });

  it('caps simultaneous voices at six', async () => {
    const fake = new FakeAudioContext();
    const graph = makeGraph(fake);
    const fetcher = fakeFetch(fakeAudioUrlMap());
    const player = SfxPlayer(graph, { url: sfxUrl, fetcher });
    player.preload();
    await flushAudio();
    const ids = ['dice', 'step', 'hit', 'ko', 'coin', 'item', 'town'] as const;
    for (const id of ids) player.play(id);
    expect(startedSources(asAudioContext(fake)).length).toBe(6);
  });

  it('skips a sound whose buffer never loaded without throwing', async () => {
    const fake = new FakeAudioContext();
    const graph = makeGraph(fake);
    const fetcher = fakeFetch({});
    const player = SfxPlayer(graph, { url: sfxUrl, fetcher });
    player.preload();
    await flushAudio();
    expect(warns.length).toBe(SFX_COUNT);
    expect(() => player.play('dice')).not.toThrow();
    expect(startedSources(asAudioContext(fake)).length).toBe(0);
  });

  it('schedules playback on the audio clock, not the wall clock', async () => {
    const fake = new FakeAudioContext();
    const graph = makeGraph(fake);
    const fetcher = fakeFetch(fakeAudioUrlMap());
    const player = SfxPlayer(graph, { url: sfxUrl, fetcher });
    player.preload();
    await flushAudio();
    fake.currentTime = 7;
    player.play('dice');
    expect(startedSources(asAudioContext(fake))[0]?.startCalls).toContain(7);
  });
});

const SFX_COUNT = 12;

describe('music player', () => {
  it('starts the board track looping through a faded-in track gain', async () => {
    const fake = new FakeAudioContext();
    const graph = makeGraph(fake);
    const fetcher = fakeFetch(fakeAudioUrlMap());
    const player = MusicPlayer(graph, { url: musicUrl, fetcher });
    player.set('board');
    await flushAudio();
    const started = startedSources(asAudioContext(fake));
    expect(started.length).toBe(1);
    expect(started[0]?.loop).toBe(true);
    expect((started[0]?.buffer as unknown as FakeAudioBuffer).duration).toBe(10);
    const tracks = trackGains(fake, graph);
    expect(tracks.length).toBe(1);
    expect(tracks[0]?.gain.last('linearRampToValueAtTime')?.value).toBe(1);
  });

  it('cross-fades board to battle over 0.5 s and stops the old source after the fade', async () => {
    const fake = new FakeAudioContext();
    const graph = makeGraph(fake);
    const fetcher = fakeFetch(fakeAudioUrlMap());
    const player = MusicPlayer(graph, { url: musicUrl, fetcher });
    player.set('board');
    await flushAudio();
    fake.currentTime = 10;
    player.set('battle');
    await flushAudio();
    const started = startedSources(asAudioContext(fake));
    expect(started.length).toBe(2);
    expect(started[0]?.loop).toBe(true);
    expect(started[1]?.loop).toBe(true);
    expect((started[0]?.buffer as unknown as FakeAudioBuffer).duration).toBe(10);
    expect((started[1]?.buffer as unknown as FakeAudioBuffer).duration).toBe(12);
    const tracks = trackGains(fake, graph);
    expect(tracks.length).toBe(2);
    expect(tracks[0]?.gain.last('linearRampToValueAtTime')).toMatchObject({
      value: 0,
      time: 10.5,
    });
    expect(tracks[1]?.gain.last('linearRampToValueAtTime')).toMatchObject({
      value: 1,
      time: 10.5,
    });
    expect(started[0]?.stopCalls).toContain(10.5);
  });

  it('fades the current track out for none without starting a new source', async () => {
    const fake = new FakeAudioContext();
    const graph = makeGraph(fake);
    const fetcher = fakeFetch(fakeAudioUrlMap());
    const player = MusicPlayer(graph, { url: musicUrl, fetcher });
    player.set('board');
    await flushAudio();
    fake.currentTime = 4;
    player.set('none');
    await flushAudio();
    expect(startedSources(asAudioContext(fake)).length).toBe(1);
    const tracks = trackGains(fake, graph);
    expect(tracks.length).toBe(1);
    expect(tracks[0]?.gain.last('linearRampToValueAtTime')).toMatchObject({ value: 0, time: 4.5 });
    expect(sourcesOf(asAudioContext(fake))[0]?.stopCalls).toContain(4.5);
  });
});
