import {
  chooseAction,
  createGame,
  legalActions,
  MAP,
  step,
  type GameState,
} from '@dice-bandits/engine';
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

type TestCamera = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  inputEnabled: boolean;
} & Record<
  'setViewport' | 'ignore' | 'setBounds' | 'setScroll' | 'setZoom' | 'setVisible' | 'centerOn',
  ReturnType<typeof vi.fn>
>;

function makeScene() {
  const objects: Rec[] = [];
  const handlers = new Map<string, (state: GameState) => void>();
  const scene = Object.assign(Object.create(BoardScene.prototype), {
    tokenObjects: new Map(),
    spacePositions: new Map(),
    wholeMap: false,
    ringTween: null,
    children: { removeAll: vi.fn() },
    scale: { on: vi.fn(), off: vi.fn() },
    events: { once: vi.fn(), on: vi.fn(), off: vi.fn() },
    cameras: {
      add: vi.fn(),
      remove: vi.fn(),
      main: {
        id: 1,
        x: 0,
        y: 0,
        inputEnabled: true,
        setViewport: vi.fn(),
        ignore: vi.fn(),
        setBounds: vi.fn(),
        setScroll: vi.fn(),
        setZoom: vi.fn(),
        setVisible: vi.fn(),
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
        off: vi.fn(),
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
      killTweensOf: vi.fn(),
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
    cameras: { main: TestCamera; add: ReturnType<typeof vi.fn> };
    tweens: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  };
  scene.cameras.add.mockImplementation((x: number, y: number, width: number, height: number) => {
    scene.cameras.main = { ...scene.cameras.main, id: 2, x, y, width, height };
    return scene.cameras.main;
  });
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
  document.querySelectorAll('[data-testid^="fork-arrow-"]').forEach((marker) => marker.remove());
  delete (window as { __phaser_probe__?: unknown }).__phaser_probe__;
});

/** Rebuild the study route using only legal engine actions, not copied state. */
function fiveStepWalk() {
  let state = createGame({
    seed: 'm6-study-1',
    rounds: 30,
    seats: [
      { name: 'Sir Bram', classId: 'knight', control: 'human', personality: null },
      { name: 'Mint', classId: 'thief', control: 'bot', personality: 'greedy' },
    ],
  });
  for (let action = 0; action < 1200; action++) {
    const actor = state.players.find((player) => legalActions(state, player.seat).length > 0)!;
    const result = step(state, chooseAction(state, actor.seat));
    const moves = result.events.filter((event) => event.type === 'Moved');
    if (moves.length === 5) return { previous: state, next: result.state, moves };
    state = result.state;
  }
  throw new Error('No legal five-step walk found');
}

describe('BoardScene movement destinations', () => {
  it('indexes every board space independently of occupied token offsets', () => {
    const { scene } = makeScene();
    const { previous } = fiveStepWalk();
    scene.renderBoard(previous);
    const positions = (
      scene as unknown as { spacePositions: Map<number, { x: number; y: number }> }
    ).spacePositions;
    expect([...positions]).toEqual(previous.board.spaces.map(({ id, x, y }) => [id, { x, y }]));
  });

  it.each([1, 0])('plays five empty destinations in order at speed %s', async (speed) => {
    window.diceBanditsSpeed = speed;
    const { scene } = makeScene();
    const { previous, next, moves } = fiveStepWalk();
    expect(moves.map((event) => event.params.to)).toEqual([6, 7, 8, 9, 10]);
    expect(
      moves.every((event) => !previous.players.some((player) => player.pos === event.params.to)),
    ).toBe(true);
    scene.renderBoard(previous);
    const mover = previous.players[moves[0]!.seat!]!;
    const source = previous.board.spaces.find((space) => space.id === mover.pos)!;
    const token = { x: source.x, y: source.y, setFlipX: vi.fn(), setPosition: vi.fn() };
    token.setPosition.mockImplementation((x: number, y: number) => Object.assign(token, { x, y }));
    const live = scene as unknown as {
      tokenObjects: Map<number, typeof token>;
      playEvents: InstanceType<typeof BoardScene>['playEvents'];
    };
    live.tokenObjects.set(mover.seat, token);
    scene.tweens.add.mockClear();
    scene.tweens.add.mockImplementation((config) => {
      if (config.targets === token) {
        Object.assign(token, { x: config.x, y: config.y });
        config.onComplete();
      }
    });
    await live.playEvents(moves);
    const walks = scene.tweens.add.mock.calls
      .map(([config]) => config)
      .filter((config) => config.targets === token);
    const destinations = moves.map((event) =>
      previous.board.spaces.find((space) => space.id === event.params.to)!,
    );
    expect(walks.map(({ x, y, duration }) => ({ x, y, duration }))).toEqual(
      speed > 0
        ? destinations.map(({ x, y }) => ({
            x,
            y,
            duration: previous.players[mover.seat]!.control === 'human' ? 280 : 120,
          }))
        : [],
    );
    const endpoint = next.board.spaces.find((space) => space.id === next.players[mover.seat]!.pos)!;
    expect({ x: token.x, y: token.y }).toEqual({ x: endpoint.x, y: endpoint.y });
    if (speed === 0) {
      expect(scene.tweens.add).not.toHaveBeenCalled();
      expect(token.setPosition.mock.calls).toEqual(destinations.map(({ x, y }) => [x, y]));
    }
  });
});

describe('BoardScene layering', () => {
  it('ignores a queued fork click after the branch phase has already ended', () => {
    const { scene } = makeScene();
    const state = gameFor('queued-fork');
    state.players[0]!.pos = 19;
    scene.renderBoard({
      ...state,
      phase: { kind: 'chooseBranch', remaining: 1, options: [20, 37] },
    });
    const arrow = document.querySelector<HTMLButtonElement>('[data-testid="fork-arrow-20"]')!;
    const emit = (scene as unknown as { game: { events: { emit: ReturnType<typeof vi.fn> } } }).game
      .events.emit;
    arrow.click();
    expect(emit).toHaveBeenCalledWith('board-chooseBranch', 20);
    emit.mockClear();
    scene.renderBoard({ ...state, phase: { kind: 'awaitRoll' } });
    // A pending Phaser/window pointer queue may retain a removed arrow callback.
    arrow.click();
    expect(emit).not.toHaveBeenCalled();
  });

  it('draws arrows when rolling from a fork without moving the player', () => {
    const { scene } = makeScene();
    const state = gameFor('fork-start');
    state.players[0]!.pos = 19;
    scene.renderBoard(state);
    scene.renderBoard({
      ...state,
      phase: { kind: 'chooseBranch', remaining: 1, options: [20, 37] },
    });
    expect(document.querySelector('[data-testid="fork-arrow-20"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="fork-arrow-37"]')).not.toBeNull();
  });

  it('replaces arrows when branch options change without a position change', () => {
    const { scene } = makeScene();
    const state = gameFor('fork-options');
    state.players[0]!.pos = 19;
    scene.renderBoard({
      ...state,
      phase: { kind: 'chooseBranch', remaining: 1, options: [20, 37] },
    });
    scene.renderBoard({ ...state, phase: { kind: 'chooseBranch', remaining: 1, options: [37] } });
    expect(document.querySelector('[data-testid="fork-arrow-20"]')).toBeNull();
    expect(document.querySelectorAll('[data-testid="fork-arrow-37"]')).toHaveLength(1);
  });

  it('removes branch controls after movement leaves chooseBranch', () => {
    const { scene } = makeScene();
    const state = gameFor('fork-leave');
    state.players[0]!.pos = 19;
    scene.renderBoard({
      ...state,
      phase: { kind: 'chooseBranch', remaining: 1, options: [20, 37] },
    });
    state.players[0]!.pos = 37;
    scene.renderBoard(state);
    expect(document.querySelectorAll('[data-testid^="fork-arrow-"]')).toHaveLength(0);
  });

  it('renders painted map below road below tiles below tokens', () => {
    const { scene, objects } = makeScene();
    const state = gameFor('a');
    (scene as unknown as { renderBoard(state: GameState): void }).renderBoard(state);

    const mapTiles = objects.filter((o) => o.depth === -10);
    const road = objects.filter((o) => o.depth === -5);
    const tiles = objects.filter((o) => o.depth === 0);
    const tokens = objects.filter((o) => o.texture === '__WHITE');
    const rings = objects.filter((o) => o.depth >= 40 && o.kind === 'graphics');

    expect(mapTiles.length).toBe(15); // 5x3 painted background tiles
    expect(road.length).toBe(1); // one graphics pass for the whole road
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

  it('hides the covered board in battle and restores it even with the same visual signature', () => {
    const { scene, objects } = makeScene();
    const state = gameFor('covered-board');
    scene.renderBoard(state);
    const drawn = objects.length;
    const battle = { ...state, phase: { kind: 'battle' as const } } as GameState;
    scene.renderBoard(battle);
    scene.renderBoard(state);

    expect(scene.cameras.main.setVisible).toHaveBeenNthCalledWith(1, true);
    expect(scene.cameras.main.setVisible).toHaveBeenNthCalledWith(2, false);
    expect(scene.cameras.main.setVisible).toHaveBeenNthCalledWith(3, true);
    expect(objects).toHaveLength(drawn);
  });

  it('starts with the board camera hidden when the initial state is already a battle', () => {
    const { scene } = makeScene();
    const state = gameFor('initial-battle');
    scene.renderBoard({ ...state, phase: { kind: 'battle' as const } } as GameState);

    expect(scene.cameras.main.setVisible).toHaveBeenCalledWith(false);
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

describe('BoardScene safe playfield lifecycle', () => {
  function setup() {
    const { scene, handlers } = makeScene();
    const live = scene as unknown as {
      cameras: {
        main: typeof scene.cameras.main;
        add: ReturnType<typeof vi.fn>;
        remove: ReturnType<typeof vi.fn>;
      };
      events: {
        once: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
        off: ReturnType<typeof vi.fn>;
      };
      scale: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> };
      game: { canvas: HTMLCanvasElement };
      mapImages: Array<{ cameraFilter: number }>;
    };
    const backdrop = live.cameras.main;
    const main = { ...backdrop, id: 2, setViewport: vi.fn(), ignore: vi.fn() };
    live.cameras.add.mockImplementation(() => (live.cameras.main = main));
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 1280, 720);
    live.game.canvas = canvas;
    scene.create();
    return { scene, live, backdrop, main, handlers, canvas };
  }

  it('makes only the safe camera main and leaves the full-bleed backdrop noninteractive', () => {
    const { live, backdrop, main } = setup();
    expect(live.cameras.main).not.toBe(backdrop);
    expect(live.cameras.main).toBe(main);
    expect(backdrop.inputEnabled).toBe(false);
    expect(live.cameras.add).toHaveBeenCalledWith(8, 58, 1088, 602, true, 'board-playfield');
  });

  it('excludes every newly added foreground object including late effects from the backdrop', () => {
    const { live, backdrop } = setup();
    const added = live.events.on.mock.calls.find(([name]) => name === 'addedtoscene')?.[1];
    expect(added).toBeTypeOf('function');
    for (const kind of ['token', 'building', 'road', 'flag', 'ring', 'fork-zone', 'effect']) {
      const object = { name: kind, cameraFilter: 0 };
      added?.(object);
      expect(backdrop.ignore).toHaveBeenCalledWith(object);
    }
  });

  it('reapplies safe and full viewports on resize and removes the extra camera/listeners on shutdown', () => {
    const { live, scene, main, backdrop, handlers, canvas } = setup();
    handlers.get('game-state')!(gameFor('resize-safe'));
    expect(live.mapImages.length).toBeGreaterThan(0);
    for (const image of live.mapImages) expect(image.cameraFilter & backdrop.id).toBe(0);
    canvas.width = 1599;
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 915, 412);
    const resize = live.scale.on.mock.calls.find(([name]) => name === 'resize')![1];
    resize();
    expect(main.setViewport).toHaveBeenLastCalledWith(
      expect.closeTo((8 * 1599) / 915, 4),
      expect.closeTo((58 * 720) / 412, 4),
      expect.closeTo((771 * 1599) / 915, 4),
      expect.closeTo((294 * 720) / 412, 4),
    );
    expect(backdrop.setViewport).toHaveBeenLastCalledWith(0, 0, 1599, 720);
    const shutdown = live.events.once.mock.calls.find(([name]) => name === 'shutdown')![1];
    shutdown();
    expect(live.cameras.remove).toHaveBeenCalledWith(main);
    expect(live.cameras.main).toBe(backdrop);
    expect(live.scale.off).toHaveBeenCalledWith('resize', resize);
    expect(live.events.off).toHaveBeenCalledWith('addedtoscene', expect.any(Function));
    expect(scene).toBeDefined();
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
