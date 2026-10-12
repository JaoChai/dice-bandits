import type Phaser from 'phaser';
import { createGame, type GameEvent, type GameState } from '@dice-bandits/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BoardScene from '../../src/scenes/BoardScene';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

beforeEach(() => {
  vi.useFakeTimers();
  window.diceBanditsSpeed = 1;
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  const state = createGame({
    seed: 'juice',
    rounds: 12,
    seats: [
      { name: 'A', classId: 'knight', control: 'human', personality: null },
      { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' },
    ],
  });
  const destination = state.board.spaces.find((s) => s.id === 1)!;
  const token = {
    x: destination.x + 100,
    y: destination.y,
    scaleX: 1.18,
    scaleY: 1.18,
    angle: 0,
    flipX: false,
    frame: { name: 'idle', width: 72, height: 72 },
    texture: { has: (name: string) => ['idle', 'happy'].includes(name) },
    get displayHeight() {
      return token.frame.height * token.scaleY;
    },
    get displayWidth() {
      return token.frame.width * token.scaleX;
    },
    setFrame: vi.fn((name: string) => {
      token.frame = { name, width: 72, height: 72 };
      return token;
    }),
    setDisplaySize: vi.fn((width: number, height: number) => {
      token.scaleX = width / token.frame.width;
      token.scaleY = height / token.frame.height;
      return token;
    }),
    setFlipX: vi.fn((flip: boolean) => {
      token.flipX = flip;
      return token;
    }),
    setPosition: vi.fn((x: number, y: number) => {
      token.x = x;
      token.y = y;
      return token;
    }),
  };
  const tag = {
    x: token.x,
    y: token.y - 89,
    displayHeight: 24,
    destroy: vi.fn(),
    setPosition: vi.fn((x: number, y: number) => {
      tag.x = x;
      tag.y = y;
      return tag;
    }),
  };
  const shadow = {
    x: token.x,
    y: token.y,
    scaleX: 1,
    scaleY: 1,
    setPosition: vi.fn().mockReturnThis(),
    setScale: vi.fn((scale: number) => {
      shadow.scaleX = scale;
      shadow.scaleY = scale;
      return shadow;
    }),
  };
  type Puff = Record<
    'destroy' | 'setStrokeStyle' | 'setDepth' | 'setName',
    ReturnType<typeof vi.fn>
  >;
  const puffs: Puff[] = [];
  function circle(): Puff {
    const puff = {
      destroy: vi.fn(),
      setStrokeStyle: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
      setName: vi.fn().mockReturnThis(),
    };
    puffs.push(puff);
    return puff;
  }
  const icons: Array<ReturnType<typeof image>> = [];
  function image(x: number, y: number, _key: string, frame: string) {
    const icon = {
      x,
      y,
      frame: { name: frame },
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      destroy: vi.fn(),
      setDepth: vi.fn().mockReturnThis(),
      setName: vi.fn().mockReturnThis(),
      setDisplaySize: vi.fn((w: number, h: number) => {
        icon.scaleX = w / 100;
        icon.scaleY = h / 100;
        return icon;
      }),
      setScale: vi.fn((scale: number) => {
        icon.scaleX = scale;
        icon.scaleY = scale;
        return icon;
      }),
      setAlpha: vi.fn((alpha: number) => {
        icon.alpha = alpha;
        return icon;
      }),
      setPosition: vi.fn((x: number, y: number) => {
        icon.x = x;
        icon.y = y;
        return icon;
      }),
    };
    return icon;
  }
  const configs: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
  const handles: Array<{ remove: ReturnType<typeof vi.fn> }> = [];
  const handlers = new Map<string, () => void>();
  const camera = {
    width: 1280,
    height: 720,
    setVisible: vi.fn(),
    setBounds: vi.fn(),
    setScroll: vi.fn(),
    ignore: vi.fn(),
  };
  const board = Object.assign(new BoardScene(), {
    game: { registry: { get: () => undefined }, events: { on: vi.fn(), off: vi.fn() } },
    cameras: { main: camera, add: () => camera, remove: vi.fn() },
    events: {
      once: (key: string, fn: () => void) => handlers.set(key, fn),
      on: vi.fn(),
      off: vi.fn(),
    },
    scale: { on: (key: string, fn: () => void) => handlers.set(key, fn), off: vi.fn() },
    tweens: {
      killTweensOf: vi.fn(),
      add: vi.fn((config) => {
        configs.push(config);
        const handle = { remove: vi.fn() };
        handles.push(handle);
        return handle;
      }),
    },
    add: {
      circle,
      image: (...args: Parameters<typeof image>) => {
        const icon = image(...args);
        icons.push(icon);
        return icon;
      },
    },
    textures: { exists: () => true, get: () => ({ has: () => true }) },
    nameTags: new Map(),
    applyViewports: vi.fn(),
    drawPaintedMap: vi.fn(),
    applyCamera: vi.fn(),
    panCameraTo: vi.fn(),
    showWalkCounter: vi.fn(),
  }) as unknown as BoardScene;
  board.create();
  const live = board as unknown as {
    latestState: typeof state;
    tokenObjects: Map<number, typeof token>;
    nameTags: Map<number, typeof tag>;
    spacePositions: Map<number, { x: number; y: number }>;
    activeShadow: typeof shadow;
    renderSignature: string;
    renderBoard(state: GameState): void;
  };
  live.latestState = state;
  live.tokenObjects.set(0, token);
  live.nameTags.set(0, tag);
  live.activeShadow = shadow;
  live.spacePositions.set(1, destination);
  handlers.set('renderBoard', () => {
    // Superseding state can retain its geometry: cancellation must happen
    // even before the scene's unchanged-signature fast path.
    live.renderSignature = JSON.stringify([
      state.config.seed,
      state.turnSeat,
      null,
      state.towns.map((town) => [town.spaceId, town.owner, town.value]),
      state.players.map((player) => [player.pos, player.classId, !!player.prank]),
    ]);
    live.renderBoard(state);
  });
  const move: GameEvent = { type: 'Moved', seat: 0, params: { to: 1, remaining: 0 } };
  const update = (progress: number) => {
    const config = configs.find((c) => c.progress === 1)!;
    (config.targets as { progress: number }).progress = progress;
    (config.onUpdate as () => void)();
  };
  return {
    board,
    live,
    token,
    tag,
    shadow,
    puffs,
    configs,
    handles,
    handlers,
    move,
    update,
    destination,
    icons,
  };
}

describe('local walk juice and lifecycle', () => {
  it('squeezes once at a genuine direction change inside the original 560ms hop', async () => {
    const s = setup();
    const done = s.board.playEvents([s.move]);
    await vi.advanceTimersByTimeAsync(300);
    expect(s.token.setFlipX).not.toHaveBeenCalled();
    expect(s.configs.filter((c) => c.progress === 1).map((c) => c.duration)).toEqual([560]);
    s.update(90 / 560);
    expect(s.token.scaleX).toBeCloseTo(1.18 * 0.05);
    expect(s.token.flipX).toBe(true);
    s.update(180 / 560);
    expect(s.token.scaleX).toBeCloseTo(1.18);
    s.update(0.6);
    expect(s.token.setFlipX).toHaveBeenCalledOnce();
    s.board.cancelLocalMovement();
    await done;
  });
  it('keeps facing on a near-vertical hop without a squeeze', async () => {
    const s = setup();
    s.token.x = s.destination.x + 5;
    s.token.flipX = true;
    const done = s.board.playEvents([s.move]);
    await vi.advanceTimersByTimeAsync(300);
    s.update(0.1);
    expect(s.token.flipX).toBe(true);
    expect(s.token.setFlipX).not.toHaveBeenCalled();
    expect(s.token.scaleX).toBe(1.18);
    s.board.cancelLocalMovement();
    await done;
  });
  it.each(['speed zero', 'reduced motion'])(
    'flips instantly without cosmetic waits for %s',
    async (policy) => {
      const s = setup();
      if (policy === 'speed zero') window.diceBanditsSpeed = 0;
      else vi.stubGlobal('matchMedia', () => ({ matches: true }));
      await s.board.playEvents([s.move]);
      expect(s.token.flipX).toBe(true);
      expect(s.configs).toEqual([]);
      expect(s.puffs).toEqual([]);
      expect(s.token).toMatchObject({
        x: s.destination.x,
        y: s.destination.y,
        angle: 0,
        scaleX: 1.18,
        scaleY: 1.18,
      });
    },
  );
  it.each(['cancel', 'resize', 'shutdown', 'destroy', 'renderBoard'])(
    'restores angle, scales, shadow and fences stale callbacks on %s',
    async (exit) => {
      const s = setup();
      const done = s.board.playEvents([s.move]);
      await vi.advanceTimersByTimeAsync(300);
      s.update(0.1);
      expect(s.token.scaleY).toBeCloseTo(1.18 * 0.82);
      expect(Math.abs(s.token.angle)).toBeGreaterThan(6);
      s.update(0.5);
      expect(s.token.frame.name).toBe('happy');
      expect(s.shadow.scaleX).toBeCloseTo(0.55);
      if (exit === 'cancel') s.board.cancelLocalMovement();
      else s.handlers.get(exit)!();
      await done;
      expect(s.token).toMatchObject({ angle: 0, scaleX: 1.18, scaleY: 1.18 });
      expect(s.shadow).toMatchObject({ scaleX: 1, scaleY: 1 });
      const before = { x: s.token.x, y: s.token.y };
      s.update(0.8);
      (s.configs.find((c) => c.progress === 1)!.onComplete as () => void)();
      expect(s.token).toMatchObject(before);
      expect(s.puffs).toEqual([]);
    },
  );
  it('plants upright, follows the name tag and destroys eight landing puffs after fade', async () => {
    const s = setup();
    const done = s.board.playEvents([s.move]);
    await vi.advanceTimersByTimeAsync(300);
    s.update(0.25);
    expect(s.tag.x).toBe(s.token.x);
    expect(s.tag.y).toBeLessThan(s.token.y - s.token.displayHeight);
    (s.configs.find((c) => c.progress === 1)!.onComplete as () => void)();
    expect(s.token).toMatchObject({ angle: 0, scaleX: 1.18, scaleY: 1.18 });
    expect(s.puffs).toHaveLength(8);
    const fades = s.configs.filter((c) => c.alpha === 0);
    expect(fades).toHaveLength(8);
    for (const fade of fades) {
      expect(fade.duration).toBe(520);
      (fade.onComplete as () => void)();
    }
    expect(s.puffs.every((puff) => puff.destroy.mock.calls.length === 1)).toBe(true);
    await vi.advanceTimersByTimeAsync(970);
    await done;
  });
  it('removes dust tweens and puffs on cancel, without duplicate destruction from old callbacks', async () => {
    const s = setup();
    const done = s.board.playEvents([s.move]);
    await vi.advanceTimersByTimeAsync(300);
    (s.configs.find((c) => c.progress === 1)!.onComplete as () => void)();
    expect(s.puffs).toHaveLength(8);
    s.board.cancelLocalMovement();
    await done;
    for (const fade of s.configs.filter((c) => c.alpha === 0)) (fade.onComplete as () => void)();
    expect(s.puffs.every((puff) => puff.destroy.mock.calls.length === 1)).toBe(true);
    expect(s.handles.slice(1).every((handle) => handle.remove.mock.calls.length === 1)).toBe(true);
  });
});

const roll = (value = 4, dice = 1): GameEvent => ({
  type: 'DiceRolled',
  seat: 0,
  params: { value, dice, sides: 6 },
});
describe('owned roll cue and overhead die', () => {
  it('never spins, shows idle/happy/idle and settles in the original 350ms pause', async () => {
    const s = setup();
    const done = s.board.playEvents([roll()]);
    expect(s.configs.every((c) => c.angle === undefined)).toBe(true);
    const cue = s.configs.find((c) => c.duration === 350)!;
    expect(cue).toBeDefined();
    for (const [ms, frame] of [
      [0, 'idle'],
      [110, 'happy'],
      [240, 'happy'],
      [350, 'idle'],
    ] as const) {
      (cue.targets as { roll: number }).roll = ms / 350;
      (cue.onUpdate as () => void)();
      expect(s.token.frame.name).toBe(frame);
      expect(Math.abs(s.token.angle)).toBeLessThanOrEqual(15);
    }
    await vi.advanceTimersByTimeAsync(349);
    expect(s.icons[0]!.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(s.token.frame.name).toBe('idle');
    expect(s.icons[0]!.destroy).toHaveBeenCalledOnce();
  });
  it.each(['speed zero', 'reduced motion'])(
    'creates no animated cue or die for %s',
    async (policy) => {
      const s = setup();
      if (policy === 'speed zero') window.diceBanditsSpeed = 0;
      else vi.stubGlobal('matchMedia', () => ({ matches: true }));
      await s.board.playEvents([roll()]);
      expect(s.configs).toEqual([]);
      expect(s.icons).toEqual([]);
      expect(s.token).toMatchObject({ angle: 0, frame: { name: 'idle' } });
    },
  );
  it.each([
    [1, 1, 'dieFace1'],
    [2, 1, 'dieFace2'],
    [3, 1, 'dieFace3'],
    [4, 1, 'dieFace4'],
    [5, 1, 'dieFace5'],
    [6, 1, 'dieFace6'],
    [7, 1, 'die'],
    [4, 2, 'die'],
  ] as const)(
    'shows truthful value %i with %i dice, grows from the hero, and cleans up across turns',
    async (value, dice, frame) => {
      const s = setup();
      const done = s.board.playEvents([roll(value, dice)]);
      expect(s.icons).toHaveLength(1);
      expect(s.icons[0]!.frame.name).toBe(frame);
      expect(s.icons[0]!.scaleX).toBeLessThan(0.4);
      const pop = s.configs.find((c) => c.ease === 'Back.easeOut')!;
      expect(pop).toBeDefined();
      (pop.targets as { growth: number }).growth = 1;
      (pop.onUpdate as () => void)();
      expect(s.icons[0]!.y + 20).toBeLessThanOrEqual(s.tag.y - s.tag.displayHeight);
      expect(s.icons[0]!.x).toBe(s.token.x);
      await vi.advanceTimersByTimeAsync(350);
      await done;
      expect(s.icons[0]!.destroy).toHaveBeenCalledOnce();
      const next = s.board.playEvents([roll(value, dice)]);
      s.board.cancelLocalMovement();
      await next;
      for (const c of s.configs) {
        (c.onUpdate as (() => void) | undefined)?.();
        (c.onComplete as (() => void) | undefined)?.();
      }
      expect(s.icons.every((i) => i.destroy.mock.calls.length === 1)).toBe(true);
    },
  );
  it.each(['cancel', 'resize', 'shutdown', 'destroy', 'renderBoard'])(
    'resets the airborne roll and destroys its die on %s, fencing stale callbacks',
    async (exit) => {
      const s = setup();
      const baseY = s.token.y;
      const done = s.board.playEvents([roll()]);
      const cue = s.configs.find((c) => c.duration === 350)!;
      (cue.targets as { roll: number }).roll = 0.5;
      (cue.onUpdate as () => void)();
      expect(s.token.frame.name).toBe('happy');
      if (exit === 'cancel') s.board.cancelLocalMovement();
      else s.handlers.get(exit)!();
      await done;
      expect(s.token).toMatchObject({ angle: 0, y: baseY, frame: { name: 'idle' } });
      expect(s.icons[0]!.destroy).toHaveBeenCalledOnce();
      for (const c of s.configs) {
        (c.onUpdate as (() => void) | undefined)?.();
        (c.onComplete as (() => void) | undefined)?.();
      }
      expect(s.token).toMatchObject({ y: baseY, frame: { name: 'idle' } });
      expect(s.icons[0]!.destroy).toHaveBeenCalledOnce();
    },
  );
  it('clamps the whole die including its pop overshoot at the north and left map edge', async () => {
    const s = setup();
    s.token.x = 2;
    s.token.y = 100;
    s.tag.x = 2;
    s.tag.y = 25;
    const done = s.board.playEvents([roll()]);
    const pop = s.configs.find((c) => c.ease === 'Back.easeOut')!;
    (pop.targets as { growth: number }).growth = 1.1;
    (pop.onUpdate as () => void)();
    expect(s.icons[0]!.x - 22).toBeGreaterThanOrEqual(0);
    expect(s.icons[0]!.y - 22).toBeGreaterThanOrEqual(0);
    s.board.cancelLocalMovement();
    await done;
  });
});
