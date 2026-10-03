import { createGame, MAP, type GameState } from '@dice-bandits/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reducedMotion } from '../../src/art/motion';

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
  name?: string;
  destroyed?: boolean;
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
      if (prop === 'destroy')
        return () => {
          target.destroyed = true;
        };
      if (prop === 'depth') return target.depth;
      if (prop === 'setDepth')
        return (depth: number) => {
          target.depth = depth;
          return proxy;
        };
      if (prop === 'setName')
        return (name: string) => {
          target.name = name;
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
      if (prop === 'play')
        return (key: string) => {
          target.played = key;
          return proxy;
        };
      if (prop === 'texture') return { key: target.texture };
      if (prop === 'anims') return { stop: () => proxy };
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
    wholeMap: false,
    ringTween: null,
    children: { removeAll: vi.fn() },
    cameras: {
      main: {
        setScroll: vi.fn(),
        setZoom: vi.fn(),
        centerOn: vi.fn(),
        width: 1280,
        height: 720,
        zoom: 0.4,
        getWorldPoint: vi.fn(() => ({ x: 0, y: 0 })),
      },
    },
    input: { on: vi.fn(), off: vi.fn() },
    game: {
      events: {
        on: vi.fn((event: string, handler: (state: GameState) => void) =>
          handlers.set(event, handler),
        ),
        emit: vi.fn(),
      },
      registry: { get: vi.fn(() => undefined) },
    },
    textures: {
      exists: vi.fn(() => false),
      get: vi.fn(() => ({ has: () => true })),
    },
    anims: { exists: vi.fn(() => true) },
    cache: { json: { get: vi.fn(() => undefined) } },
    tweens: {
      add: vi.fn(),
      remove: vi.fn(),
    },
    add: {
      image: vi.fn((x: number, y: number, key: string, frame?: number | string) => {
        const made = gameObject('image', key, frame);
        objects.push(made.rec);
        return made.proxy;
      }),
      sprite: vi.fn((x: number, y: number, key: string, frame?: number | string) => {
        const made = gameObject('sprite', key, frame);
        objects.push(made.rec);
        return made.proxy;
      }),
      graphics: vi.fn(() => {
        const made = gameObject('graphics');
        objects.push(made.rec);
        return made.proxy;
      }),
      rectangle: vi.fn(() => {
        const made = gameObject('rectangle');
        objects.push(made.rec);
        return made.proxy;
      }),
      zone: vi.fn(() => {
        const made = gameObject('zone');
        objects.push(made.rec);
        return made.proxy;
      }),
    },
  }) as unknown as {
    renderBoard(state: GameState): void;
    create(): void;
    input: { on: ReturnType<typeof vi.fn> };
    cameras: { main: Record<string, ReturnType<typeof vi.fn> & number> };
    tweens: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
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
  delete (window as { __phaser_probe__?: unknown }).__phaser_probe__;
});

describe('BoardScene layering', () => {
  it('renders painted map below road below tiles below tokens', () => {
    const { scene, objects } = makeScene();
    const state = gameFor('a');
    (scene as unknown as { renderBoard(state: GameState): void }).renderBoard(state);

    const mapTiles = objects.filter((o) => o.depth === -10);
    const road = objects.filter((o) => o.depth === -5 && !o.destroyed);
    const tiles = objects.filter((o) => o.depth === 0);
    const tokens = objects.filter((o) => o.texture?.startsWith('token-'));
    const rings = objects.filter((o) => o.depth >= 40 && o.kind === 'graphics');

    expect(mapTiles.length).toBe(15); // 5x3 painted background tiles
    expect(road.length).toBe(1); // one cached image for the whole road
    expect(road[0]!.texture).toBe('board:road');
    expect(tiles.length).toBe(state.board.spaces.length); // one marker per space
    expect(tokens).toHaveLength(4);
    expect(rings.length).toBeGreaterThan(0);

    // ordering: map < road < tiles < tokens < rings
    expect(Math.max(...mapTiles.map((tile) => tile.depth))).toBeLessThan(
      Math.min(...road.map((segment) => segment.depth)),
    );
    expect(rings[0]!.depth).toBeGreaterThan(tokens[0]!.depth);
  });

  it('does not rebuild the board for nonvisual battle state changes', () => {
    const { scene, objects } = makeScene();
    const state = gameFor('a');
    scene.renderBoard(state);
    const drawn = objects.length;
    const updated = { ...state, phase: { kind: 'gameOver' as const } } as GameState;
    scene.renderBoard(updated);
    expect(objects).toHaveLength(drawn);
  });

  it('binds one tap handler and eases the camera to the active seat (Review 7a)', () => {
    window.diceBanditsSpeed = 1;
    const { scene } = makeScene();
    const state = gameFor('a');
    (scene as unknown as { renderBoard(state: GameState): void }).renderBoard(state);
    expect(scene.input.on).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    const player = state.players[state.turnSeat]!;
    const space = state.board.spaces.find((candidate) => candidate.id === player.pos)!;
    expect(scene.tweens.add).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: scene.cameras.main,
        zoom: expect.any(Number),
        scrollX: space.x - 640,
        scrollY: space.y - 360,
        duration: 600,
        ease: 'Sine.easeInOut',
      }),
    );
    expect(scene.cameras.main.setZoom).not.toHaveBeenCalled();
  });

  it('snaps the camera to the active seat under reduced motion (Review 7a)', () => {
    window.diceBanditsSpeed = 1;
    vi.mocked(reducedMotion).mockReturnValue(true);
    const { scene } = makeScene();
    const state = gameFor('a');
    (scene as unknown as { renderBoard(state: GameState): void }).renderBoard(state);
    const player = state.players[state.turnSeat]!;
    const space = state.board.spaces.find((candidate) => candidate.id === player.pos)!;
    expect(scene.cameras.main.setZoom).toHaveBeenCalled();
    expect(scene.cameras.main.centerOn).toHaveBeenCalledWith(space.x, space.y);
    expect(scene.tweens.add).not.toHaveBeenCalled();
  });

  it('pans to the exact centre-on offset while walking (Review 7b)', () => {
    window.diceBanditsSpeed = 1;
    const { scene } = makeScene();
    (scene as unknown as { panCameraTo(x: number, y: number): void }).panCameraTo(470, 1150);
    expect(scene.tweens.add).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: scene.cameras.main,
        scrollX: 470 - 640,
        scrollY: 1150 - 360,
        ease: 'Sine.easeOut',
      }),
    );
    expect(scene.cameras.main.centerOn).not.toHaveBeenCalled();
  });

  it('names a fork-arrow hit zone per option while chooseBranch is pending', async () => {
    const { drawForkArrows } = await import('../../src/scenes/board/forkArrows');
    const state = gameFor('a');
    const fork = state.board.spaces.find((space) => space.next.length > 1)!;
    state.players[state.turnSeat]!.pos = fork.id;
    state.phase = { kind: 'chooseBranch', remaining: 2, options: [...fork.next] };
    const { scene, objects } = makeScene();
    const onChoose = vi.fn();
    drawForkArrows(scene as unknown as Parameters<typeof drawForkArrows>[0], state, onChoose);
    const zones = objects.filter((o) => o.kind === 'zone');
    expect(zones.length).toBe(state.phase.options.length);
    for (const option of state.phase.options) {
      expect(zones.some((zone) => zone.name === `fork-arrow-${option}`)).toBe(true);
    }
  });
});

describe('BoardScene ambient life (M5a spec §5: tween-only accents)', () => {
  it('adds at most one accent per region, tweens it, and flags the E2E probe at speed > 0', async () => {
    window.diceBanditsSpeed = 1;
    window.__db = {
      getState: () => gameFor('ambient'),
      art: {
        boardReady: false,
        battleReady: false,
        ambientRunning: false,
        shakeCount: 0,
      },
    };
    const { drawAmbients } = await import('../../src/scenes/board/ambient');
    const { scene, objects } = makeScene();
    drawAmbients(scene as never, MAP.nodes);
    const accents = objects.filter((o) => o.depth === 15 && o.kind === 'graphics');
    expect(accents.length).toBeGreaterThan(0);
    expect(accents.length).toBeLessThanOrEqual(4); // one per region, not per node
    expect(scene.tweens.add).toHaveBeenCalledTimes(accents.length);
    expect(window.__db!.art.ambientRunning).toBe(true);
  });

  it('draws nothing under reduced motion or speed 0', async () => {
    window.diceBanditsSpeed = 0;
    window.__db!.art.ambientRunning = false;
    vi.mocked(reducedMotion).mockReturnValue(true);
    const { drawAmbients } = await import('../../src/scenes/board/ambient');
    const { scene } = makeScene();
    drawAmbients(scene as never, MAP.nodes);
    expect(scene.tweens.add).not.toHaveBeenCalled();
    expect(window.__db?.art.ambientRunning ?? false).toBe(false);
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
