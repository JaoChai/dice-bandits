import { createGame, type GameState } from '@dice-bandits/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reducedMotion } from '../../src/art/motion';
import { HUD_RECTS } from '../../src/scenes/board/layout';
import { placeAmbients, placeDecorations } from '../../src/art/decorations';

vi.mock('phaser', () => ({
  default: {
    Scene: class Scene {},
    Math: { Vector2: class Vector2 {} },
    GameObjects: {
      Image: class Image {},
      Sprite: class Sprite {},
      Graphics: class Graphics {},
    },
  },
}));

vi.mock('../../src/art/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/art/motion')>()),
  reducedMotion: vi.fn(() => false),
}));

vi.mock('../../src/art/decorations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/art/decorations')>();
  return {
    ...actual,
    placeDecorations: vi.fn(actual.placeDecorations),
    placeAmbients: vi.fn(actual.placeAmbients),
  };
});

const { default: BoardScene } = await import('../../src/scenes/BoardScene');

interface Rec {
  kind: string;
  depth: number;
  texture?: string;
  frame?: number | string;
  origin?: number[];
  displaySize?: number[];
  scale?: number;
  tint?: number;
  played?: string;
}

/** Chainable Phaser game-object test double that records what the scene did. */
function gameObject(
  kind: string,
  texture?: string,
  frame?: number | string,
): { proxy: never; rec: Rec } {
  const rec: Rec = { kind, depth: 0, texture, frame };
  const proxy: unknown = new Proxy(rec, {
    get(target, prop: string | symbol) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'depth') return target.depth;
      if (prop === 'setDepth')
        return (depth: number) => {
          target.depth = depth;
          return proxy;
        };
      if (prop === 'play')
        return (key: string) => {
          target.played = key;
          return proxy;
        };
      if (prop === 'setOrigin')
        return (...args: number[]) => {
          target.origin = args;
          return proxy;
        };
      if (prop === 'setDisplaySize')
        return (...args: number[]) => {
          target.displaySize = args;
          return proxy;
        };
      if (prop === 'setScale')
        return (scale: number) => {
          target.scale = scale;
          return proxy;
        };
      if (prop === 'setTint')
        return (tint: number) => {
          target.tint = tint;
          return proxy;
        };
      if (prop === 'texture') return { key: target.texture };
      if (prop === 'anims') return { stop: () => proxy };
      if (prop === 'x') return 0;
      if (prop === 'y') return 0;
      return () => proxy;
    },
  });
  return { proxy: proxy as never, rec };
}

function makeScene() {
  const objects: Rec[] = [];
  const handlers = new Map<string, (state: GameState) => void>();
  const scene = Object.assign(Object.create(BoardScene.prototype), {
    tokenObjects: new Map(),
    spacePositions: new Map(),
    children: { removeAll: vi.fn() },
    cameras: { main: { setScroll: vi.fn() } },
    game: {
      events: {
        on: vi.fn((event: string, handler: (state: GameState) => void) =>
          handlers.set(event, handler),
        ),
      },
      registry: { get: vi.fn(() => undefined) },
    },
    textures: {
      exists: vi.fn((key: string) => key.startsWith('ambient-')),
      get: vi.fn(() => undefined),
    },
    anims: { exists: vi.fn(() => true) },
    cache: { json: { get: vi.fn(() => undefined) } },
    tweens: { add: vi.fn() },
    add: {
      image: vi.fn((x: number, y: number, key: string, frame?: number) => {
        const made = gameObject('image', key, frame);
        objects.push(made.rec);
        return made.proxy;
      }),
      sprite: vi.fn((x: number, y: number, key: string, frame?: number) => {
        const made = gameObject('sprite', key, frame);
        objects.push(made.rec);
        return made.proxy;
      }),
      graphics: vi.fn(() => {
        const made = gameObject('graphics');
        objects.push(made.rec);
        return made.proxy;
      }),
    },
  }) as unknown as {
    renderBoard(state: GameState): void;
    create(): void;
  };
  return { scene, objects, handlers };
}

function gameFor(seed: string): GameState {
  return createGame({
    seed,
    rounds: 12,
    seats: [
      { name: 'P1', classId: 'knight', control: 'human', personality: null },
      { name: 'P2', classId: 'thief', control: 'human', personality: null },
      { name: 'P3', classId: 'mage', control: 'human', personality: null },
      { name: 'P4', classId: 'cleric', control: 'human', personality: null },
    ],
  });
}

beforeEach(() => {
  vi.mocked(reducedMotion).mockReturnValue(false);
  vi.mocked(placeDecorations).mockClear();
  vi.mocked(placeAmbients).mockClear();
  delete (window as { __phaser_probe__?: unknown }).__phaser_probe__;
});

describe('BoardScene layering', () => {
  it('renders ground below road below tiles below decor below ambient below tokens', () => {
    const { scene, objects } = makeScene();
    const state = gameFor('a');
    (scene as unknown as { renderBoard(state: GameState): void }).renderBoard(state);

    const ground = objects.filter((o) => o.depth <= -9);
    const road = objects.filter((o) => o.depth === -5);
    const tiles = objects.filter((o) => o.depth === 0);
    const decorAndAmbient = objects.filter((o) => o.depth >= 10 && o.depth < 12);
    const ambientSprites = objects.filter((o) => o.texture?.startsWith('ambient-'));
    const tokens = objects.filter((o) => o.texture?.startsWith('token-'));
    const rings = objects.filter((o) => o.depth >= 30 && o.kind === 'graphics');

    expect(ground.length).toBeGreaterThan(0);
    expect(road.length).toBeGreaterThan(0);
    expect(tiles.length).toBe(state.board.spaces.length); // one marker per space
    expect(decorAndAmbient.length).toBeGreaterThan(state.board.spaces.length);
    expect(ambientSprites.length).toBeGreaterThan(0);
    expect(tokens).toHaveLength(4);
    expect(rings.length).toBeGreaterThan(0);

    // tokens draw over every prop/ambient, bottom-anchored, idling
    for (const token of tokens) {
      expect(token.depth).toBe(30);
      expect(token.origin).toEqual([0.5, 1]);
      expect(token.played).toBe(`token-${token.texture?.split('-')[1]}:idle`);
    }
    for (const over of decorAndAmbient) expect(over.depth).toBeLessThan(30);
    expect(rings[0]!.depth).toBeGreaterThan(30);
  });

  it('skips the ambient layer entirely under prefers-reduced-motion', () => {
    vi.mocked(reducedMotion).mockReturnValue(true);
    const { scene, objects } = makeScene();
    (scene as unknown as { renderBoard(state: GameState): void }).renderBoard(gameFor('a'));
    expect(objects.filter((o) => o.texture?.startsWith('ambient-'))).toHaveLength(0);
  });

  it('passes the HUD rectangles as decoration exclusion zones', () => {
    const { scene } = makeScene();
    (scene as unknown as { renderBoard(state: GameState): void }).renderBoard(gameFor('a'));
    for (const spy of [placeDecorations, placeAmbients]) {
      expect(spy).toHaveBeenCalledTimes(1);
      const view = vi.mocked(spy).mock.calls[0]![2] as { avoid?: unknown };
      expect(view.avoid).toEqual(HUD_RECTS);
    }
  });
});

describe('BoardScene boot', () => {
  it('wires the game-state event without debug logging or probe globals', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { scene, handlers } = makeScene();
    scene.create();
    expect(handlers.has('game-state')).toBe(true);
    expect(info).not.toHaveBeenCalled();
    expect((window as { __phaser_probe__?: unknown }).__phaser_probe__).toBeUndefined();
    info.mockRestore();
  });
});
