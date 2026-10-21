import {
  chooseAction,
  createGame,
  legalActions,
  step,
  type GameEvent,
  type GameState,
} from '@dice-bandits/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../../src/i18n';
import BoardScene from '../../src/scenes/BoardScene';
import { gameplayZoom } from '../../src/scenes/board/camera';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../../src/fx', () => ({
  dice: vi.fn(),
  dustPuff: vi.fn(),
  coinBurst: vi.fn(),
  shake: vi.fn(),
}));

function fixture(control: 'human' | 'bot' = 'human') {
  let state = createGame({
    seed: 'm6-study-1',
    rounds: 30,
    seats: [
      { name: 'Sir Bram', classId: 'knight', control: 'human', personality: null },
      { name: 'Mint', classId: 'thief', control: 'bot', personality: 'greedy' },
    ],
  });
  for (let action = 0; action < 1200; action++) {
    const actor = state.players.find((p) => legalActions(state, p.seat).length)!;
    const result = step(state, chooseAction(state, actor.seat));
    if (result.events.filter((e) => e.type === 'Moved').length === 5) {
      state.players[result.events.find((e) => e.type === 'Moved')!.seat!]!.control = control;
      return { previous: state, next: result.state, events: result.events };
    }
    state = result.state;
  }
  throw new Error('No five-step fixture');
}

type TweenConfig = {
  duration: number;
  targets: { progress?: number };
  onUpdate?: () => void;
  onComplete?: () => void;
};

function counterObject() {
  const object = {
    x: 0,
    y: 0,
    visible: false,
    scaleX: 1,
    scaleY: 1,
    setScale: vi.fn((scale: number) => {
      object.scaleX = scale;
      object.scaleY = scale;
      return object;
    }),
    setStrokeStyle: vi.fn().mockReturnThis(),
    text: '',
    displayWidth: 20,
    height: 36,
    setDepth: vi.fn(),
    setName: vi.fn(),
    setOrigin: vi.fn(),
    setVisible: vi.fn(),
    setPosition: vi.fn(),
    setText: vi.fn(),
    destroy: vi.fn(),
    clear: vi.fn(),
    fillStyle: vi.fn(),
    fillRoundedRect: vi.fn(),
    lineStyle: vi.fn(),
    strokeCircle: vi.fn(),
  };
  for (const method of [
    object.setDepth,
    object.setName,
    object.setOrigin,
    object.clear,
    object.fillStyle,
    object.fillRoundedRect,
    object.lineStyle,
    object.strokeCircle,
  ])
    method.mockReturnValue(object);
  object.setVisible.mockImplementation((visible: boolean) => {
    object.visible = visible;
    return object;
  });
  object.setText.mockImplementation((text: string) => {
    object.text = text;
    return object;
  });
  object.setPosition.mockImplementation((x: number, y: number) => {
    Object.assign(object, { x, y });
    return object;
  });
  return object;
}

function setup(previous: GameState) {
  const callbacks = new Map<string, () => void>();
  const source = previous.board.spaces.find(
    (s) => s.id === previous.players[previous.turnSeat]!.pos,
  )!;
  const token = {
    x: source.x,
    y: source.y,
    scaleX: 1,
    scaleY: 1,
    displayHeight: 72,
    setFlipX: vi.fn(),
    setPosition: vi.fn(),
  };
  token.setPosition.mockImplementation((x: number, y: number) => Object.assign(token, { x, y }));
  const tweenConfigs: TweenConfig[] = [];
  const tweenTimers = new Map<object, Set<number>>();
  const graphics: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const label = counterObject();
  const labelText = counterObject();
  const pill = counterObject();
  const resizeHandlers = new Map<string, () => void>();
  const camera = {
    width: 1280,
    height: 720,
    setBounds: vi.fn(),
    setScroll: vi.fn(),
    setZoom: vi.fn(),
    centerOn: vi.fn(),
    setVisible: vi.fn(),
    ignore: vi.fn(),
  };
  const scene = Object.assign(Object.create(BoardScene.prototype), {
    latestState: previous,
    wholeMap: true,
    cameras: { main: camera, add: () => camera },
    mapImages: [],
    applyViewports: vi.fn(),
    drawPaintedMap: vi.fn(),
    scale: { on: (name: string, cb: () => void) => resizeHandlers.set(name, cb) },
    tokenObjects: new Map([[previous.turnSeat, token]]),
    textures: { exists: () => false },
    nameTags: new Map(),
    nameTagLifts: new Map(),
    localDust: new Map(),
    spacePositions: new Map(previous.board.spaces.map(({ id, x, y }) => [id, { x, y }])),
    scene: { isActive: () => true },
    game: {
      canvas: document.querySelector('canvas'),
      registry: { get: () => undefined },
      events: { on: vi.fn() },
    },
    events: { once: (name: string, cb: () => void) => callbacks.set(name, cb), on: vi.fn() },
    tweens: {
      add: vi.fn((config) => {
        tweenConfigs.push(config);
        const owned = tweenTimers.get(config.targets) ?? new Set<number>();
        tweenTimers.set(config.targets, owned);
        const timer = window.setTimeout(() => {
          owned.delete(timer);
          if (config.targets === token) token.setPosition(config.x, config.y);
          config.onComplete?.();
        }, config.duration);
        owned.add(timer);
        return {
          remove: () => {
            window.clearTimeout(timer);
            owned.delete(timer);
          },
        };
      }),
      killTweensOf: vi.fn((target: object) => {
        for (const timer of tweenTimers.get(target) ?? []) window.clearTimeout(timer);
        tweenTimers.delete(target);
      }),
    },
    add: {
      circle: () => counterObject(),
      text: vi.fn(() => labelText),
      container: vi.fn(() => label),
      graphics: () => pill,
    },
  }) as BoardScene;
  // Exercise renderBoard's real lifecycle and signature guard without drawing
  // the map in jsdom (the browser cases cover the actual endpoint redraw).
  const commit = (state: GameState) => {
    const internal = scene as unknown as {
      renderBoard(state: GameState): void;
      renderSignature: string;
    };
    internal.renderSignature = JSON.stringify([
      state.config.seed,
      state.turnSeat,
      state.phase.kind === 'chooseBranch' ? state.phase.options : null,
      state.towns.map((town) => [town.spaceId, town.owner, town.value]),
      state.players.map((player) => [player.pos, player.classId, !!player.prank]),
    ]);
    internal.renderBoard(state);
  };
  return {
    scene,
    token,
    tweenConfigs,
    callbacks,
    graphics,
    resizeHandlers,
    commit,
    label,
    labelText,
    pill,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  window.diceBanditsSpeed = 1;
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  document.body.innerHTML =
    '<div id="app"><div class="game-shell"><div class="game-topline"><button id="roll">Roll</button><div class="event-banner"></div></div><canvas></canvas></div></div>';
  setLang('en');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const find = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('movement readout', () => {
  it('announces localized counts without moving focus or adding a dialog', async () => {
    const { createMovementReadout } = await import('../../src/ui/movementReadout');
    const view = createMovementReadout(document.querySelector('#app')!);
    document.querySelector<HTMLButtonElement>('#roll')!.focus();
    for (const count of [4, 3, 2, 1, 0]) {
      view.step(count, 0);
      expect(find('movement-remaining')?.textContent).toBe(`${count} spaces left`);
    }
    expect(document.activeElement?.id).toBe('roll');
    expect(find('movement-readout')?.getAttribute('role')).toBe('status');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    setLang('th');
    expect(find('movement-readout')).toBeNull();
    view.step(3, 0);
    expect(find('movement-remaining')?.textContent).toBe('เหลือ 3 ช่อง');
    view.destroy();
    view.step(2, 0);
    expect(find('movement-readout')).toBeNull();
  });
  it('shows only real final landing rewards for the mover, never another seat or invalid gold', async () => {
    const { createMovementReadout } = await import('../../src/ui/movementReadout');
    const { events } = fixture();
    const moves = events.filter((e) => e.type === 'Moved');
    const terminal = moves.at(-1)!;
    const view = createMovementReadout(document.querySelector('#app')!);
    view.step(0, terminal.seat!);
    view.land(Number(terminal.params.to), [
      ...moves,
      { type: 'GoldGained', seat: terminal.seat, params: { amount: 95 } },
      { type: 'GoldGained', seat: 1 - terminal.seat!, params: { amount: 999 } },
      { type: 'GoldGained', seat: terminal.seat, params: { amount: 'invented' } },
    ]);
    expect(find('movement-arrival')?.textContent).toContain('95 gold gained');
    expect(find('movement-arrival')?.textContent).not.toContain('999');
    expect(find('movement-arrival')?.textContent).not.toContain('invented');
    expect(find('movement-arrival')?.querySelector('button')).toBeNull();
    view.clear();
    view.step(1, terminal.seat!);
    view.land(Number(terminal.params.to), moves.slice(0, -1));
    expect(find('movement-arrival')).toBeNull();
    view.destroy();
  });
});

describe('real local BoardScene playback', () => {
  it('follows the sine arc, plants exactly, counts down in one pill and never outlines destinations', async () => {
    const { previous, events } = fixture();
    const moves = events.filter((e) => e.type === 'Moved');
    const { scene, token, tweenConfigs, label, labelText, pill } = setup(previous);
    const start = { x: token.x, y: token.y };
    const destination = previous.board.spaces.find((s) => s.id === moves[0]!.params.to)!;
    const promise = scene.playEvents(moves);
    await vi.advanceTimersByTimeAsync(300);
    const hop = tweenConfigs.find((c) => c.targets.progress !== undefined)!;
    expect(hop, 'arc is driven by normalized progress').toBeDefined();
    hop.targets.progress = 0.5;
    hop.onUpdate!();
    expect(token.x).toBeCloseTo((start.x + destination.x) / 2);
    expect(token.y).toBeCloseTo((start.y + destination.y) / 2 - 26);
    expect(label.x).toBe(token.x);
    expect(label.y).toBe(token.y - token.displayHeight - 36);
    hop.targets.progress = 0.85;
    hop.onUpdate!();
    expect(token.scaleY).toBeCloseTo(0.88);
    await vi.advanceTimersByTimeAsync(560);
    expect(token).toMatchObject({ x: destination.x, y: destination.y, scaleY: 1 });
    expect(labelText.text).toBe('4');
    expect(label.visible).toBe(true);
    for (const remaining of [3, 2, 1, 0]) {
      await vi.advanceTimersByTimeAsync(700);
      expect(labelText.text).toBe(remaining > 0 ? String(remaining) : '');
      expect(label.visible).toBe(remaining > 0);
    }
    await vi.runAllTimersAsync();
    await promise;
    expect(pill.lineStyle).not.toHaveBeenCalled();
    expect(pill.strokeCircle).not.toHaveBeenCalled();
    expect(label.visible).toBe(false);
    const endpoint = previous.board.spaces.find((s) => s.id === moves.at(-1)!.params.to)!;
    expect(token).toMatchObject({ x: endpoint.x, y: endpoint.y, scaleY: 1 });
  });

  it('reuses the scene pill across batches, hides it and restores squash on cancel, then destroys it on shutdown', async () => {
    const { previous, events } = fixture();
    const { scene, token, tweenConfigs, label, labelText, callbacks } = setup(previous);
    scene.create();
    const moves = events.filter((e) => e.type === 'Moved');
    const promise = scene.playEvents(moves);
    await vi.advanceTimersByTimeAsync(300 + 560 + 140);
    const hop = tweenConfigs.filter((c) => c.targets.progress !== undefined).at(-1)!;
    expect(labelText.text).toBe('4');
    hop.targets.progress = 0.85;
    hop.onUpdate!();
    scene.cancelLocalMovement();
    await promise;
    expect(token.scaleY).toBe(1);
    expect(label.visible).toBe(false);
    expect(labelText.text).toBe('');
    expect(vi.getTimerCount()).toBe(0);
    expect(label.destroy).not.toHaveBeenCalled();
    const again = scene.playEvents(moves.slice(1));
    await vi.advanceTimersByTimeAsync(300 + 560);
    expect(scene.add.container).toHaveBeenCalledOnce();
    callbacks.get('destroy')!();
    await again;
    expect(label.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leads the camera to the source for 300ms before the first hop', async () => {
    const { previous, events } = fixture();
    const { scene, token, tweenConfigs } = setup(previous);
    Object.assign(scene, { wholeMap: false });
    const promise = scene.playEvents(events.filter((e) => e.type === 'Moved'));
    // One map, one scale: walk pans share the followCentre clamp (the source
    // token sits near the southern edge), so the pan centres as close as the
    // whole safe view staying over the authored map allows.
    expect(tweenConfigs[0]).toMatchObject({
      duration: 300,
      scrollX: token.x - 640,
      scrollY: 1800 - 720 / (2 * gameplayZoom()) - 360,
    });
    await vi.advanceTimersByTimeAsync(299);
    expect(tweenConfigs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tweenConfigs.some((c) => c.targets.progress === 0)).toBe(true);
    scene.cancelLocalMovement();
    await promise;
  });
  it('hides and clears the reusable pill at touchdown before the arrival hold finishes', async () => {
    const { previous, events } = fixture();
    const { scene, label, labelText } = setup(previous);
    const moves = events.filter((event) => event.type === 'Moved');
    const promise = scene.playEvents(moves, { mode: 'human' });
    await vi.advanceTimersByTimeAsync(300 + 4 * (560 + 140) + 560);
    expect(label.visible).toBe(false);
    expect(labelText.text).toBe('');
    expect(label.destroy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.runAllTimersAsync();
    await promise;
  });

  it.each(['human', 'bot'] as const)(
    'uses moved-seat %s timing and counts 4,3,2,1,0 at planted endpoints',
    async (control) => {
      const { previous, events } = fixture(control);
      const moves = events.filter((e) => e.type === 'Moved');
      const { scene, token, tweenConfigs } = setup(previous);
      const counts: Array<{ count: number; at: number; x: number; y: number }> = [];
      const started = Date.now();
      const promise = scene.playEvents(
        events.filter((e) => e.type !== 'DiceRolled'),
        {
          onStep: (count: number) => {
            counts.push({ count, at: Date.now() - started, x: token.x, y: token.y });
            expect(find('movement-remaining')?.textContent).toBe(`${count} spaces left`);
          },
        },
      );
      await vi.runAllTimersAsync();
      await promise;
      const hop = control === 'human' ? 560 : 400;
      const hold = control === 'human' ? 140 : 100;
      expect(counts.map((c) => c.count)).toEqual([4, 3, 2, 1, 0]);
      expect(counts.map((c) => c.at)).toEqual(moves.map((_, i) => 300 + i * (hop + hold) + hop));
      expect(counts.map(({ x, y }) => ({ x, y }))).toEqual(
        moves.map((e) => {
          const s = previous.board.spaces.find((s) => s.id === e.params.to)!;
          return { x: s.x, y: s.y };
        }),
      );
      expect(
        tweenConfigs.filter((c) => c.targets.progress !== undefined).map((c) => c.duration),
      ).toEqual(Array(5).fill(hop));
      expect(Date.now() - started).toBe(control === 'human' ? 4630 : 3050);
      expect(find('movement-readout')).toBeNull();
    },
  );
  it.each(['speed zero', 'reduced motion'])(
    '%s has a static endpoint and counter without waits',
    async (policy) => {
      if (policy === 'speed zero') window.diceBanditsSpeed = 0;
      else vi.stubGlobal('matchMedia', () => ({ matches: true }));
      const { previous, next, events } = fixture();
      const { scene, token, tweenConfigs, commit } = setup(previous);
      const counts: number[] = [];
      await scene.playEvents(events, { onStep: (count: number) => counts.push(count) });
      expect(counts).toEqual([4, 3, 2, 1, 0]);
      expect(tweenConfigs).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
      const final = previous.board.spaces.find(
        (s) => s.id === events.filter((e) => e.type === 'Moved').at(-1)!.params.to,
      )!;
      expect({ x: token.x, y: token.y }).toEqual({ x: final.x, y: final.y });
      commit(next);
      const painted = new Promise<{ count?: string | null; arrival?: string | null }>((resolve) =>
        requestAnimationFrame(() => {
          resolve({
            count: find('movement-remaining')?.textContent,
            arrival: find('movement-arrival')?.textContent,
          });
        }),
      );
      await vi.advanceTimersToNextFrame();
      const frame = await painted;
      expect(frame.count).toBe('0 spaces left');
      expect(frame.arrival).toContain(`Arrived at space ${final.id}`);
      expect(vi.getTimerCount()).toBe(0);
      // A later view is not the presentation's own authoritative commit.
      commit(next);
      expect(find('movement-readout')).toBeNull();
    },
  );
  it.each(['pointerdown', 'keydown'])('clears static feedback on superseding %s', async (type) => {
    window.diceBanditsSpeed = 0;
    const { previous, next, events } = fixture();
    const { scene, commit } = setup(previous);
    await scene.playEvents(events);
    commit(next);
    expect(find('movement-remaining')?.textContent).toBe('0 spaces left');
    document.querySelector('#roll')!.dispatchEvent(new Event(type, { bubbles: true }));
    expect(find('movement-readout')).toBeNull();
  });
  it.each([100, 350, 2100, 2400])(
    'real resize handler settles hop/pause/highlight/card at %i ms',
    async (at) => {
      const { previous, events } = fixture();
      const { scene, token, tweenConfigs, graphics, resizeHandlers } = setup(previous);
      scene.create();
      Object.assign(scene, { wholeMap: false });
      const counts: number[] = [];
      let settled = false;
      const promise = scene
        .playEvents(
          events.filter((e) => e.type === 'Moved'),
          {
            onStep: (remaining) => counts.push(remaining),
          },
        )
        .then(() => {
          settled = true;
        });
      await vi.advanceTimersByTimeAsync(at);
      expect(settled).toBe(false);
      resizeHandlers.get('resize')!();
      await promise;
      expect(settled).toBe(true);
      expect(find('movement-readout')).toBeNull();
      expect(graphics.every((graphic) => graphic.destroy.mock.calls.length > 0)).toBe(true);
      expect((scene as unknown as { cameraMovement?: unknown }).cameraMovement).toBeUndefined();
      const snapshot = { counts: [...counts], tweens: tweenConfigs.length, x: token.x, y: token.y };
      await vi.runAllTimersAsync();
      expect({ counts, tweens: tweenConfigs.length, x: token.x, y: token.y }).toEqual(snapshot);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('rejects invalid/duplicate steps and never treats a paused fork as an arrival', async () => {
    const { previous, events } = fixture();
    const { scene } = setup(previous);
    const moves = events.filter((e) => e.type === 'Moved');
    const counts: number[] = [];
    const invalid: GameEvent = {
      type: 'Moved',
      seat: moves[0]!.seat,
      params: { to: 999, remaining: 2 },
    };
    const promise = scene.playEvents([moves[0]!, moves[0]!, invalid, ...moves.slice(1, 3)], {
      onStep: (count: number) => counts.push(count),
    });
    await vi.runAllTimersAsync();
    await promise;
    expect(counts).toEqual([4, 3, 2]);
    expect(find('movement-arrival')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('resumes a legal fork from its real position/count and does not pop an arrival before the final landing', async () => {
    let previous = createGame({
      seed: 'm6-study-1',
      rounds: 30,
      seats: [
        { name: 'A', classId: 'knight', control: 'human', personality: null },
        { name: 'B', classId: 'thief', control: 'human', personality: null },
      ],
    });
    for (let action = 0; action < 1200; action++) {
      const actor = previous.players.find((player) => legalActions(previous, player.seat).length)!;
      const result = step(previous, chooseAction(previous, actor.seat));
      if (
        result.state.phase.kind === 'chooseBranch' &&
        result.events.some((event) => event.type === 'Moved')
      ) {
        const { scene, token } = setup(previous);
        const counts: number[] = [];
        const first = scene.playEvents(result.events, { onStep: (count) => counts.push(count) });
        await vi.runAllTimersAsync();
        await first;
        expect(find('movement-arrival')).toBeNull();
        const stop = result.state.board.spaces.find(
          (space) => space.id === result.state.players[actor.seat]!.pos,
        )!;
        expect({ x: token.x, y: token.y }).toEqual({ x: stop.x, y: stop.y });
        expect(counts.at(-1)).toBe(result.state.phase.remaining);
        const resumed = step(result.state, chooseAction(result.state, actor.seat));
        const moves = resumed.events.filter((event) => event.type === 'Moved');
        expect(moves.length).toBeGreaterThan(0);
        Object.assign(scene, { latestState: result.state });
        const resumeCounts: number[] = [];
        const second = scene.playEvents(resumed.events, {
          onStep: (count) => resumeCounts.push(count),
        });
        await vi.runAllTimersAsync();
        await second;
        expect(resumeCounts).toEqual(
          moves.map((event) =>
            Number(event.params.remaining) > 0 ? Number(event.params.remaining) - 1 : 0,
          ),
        );
        const final = resumed.state.board.spaces.find(
          (space) => space.id === resumed.state.players[actor.seat]!.pos,
        )!;
        expect({ x: token.x, y: token.y }).toEqual({ x: final.x, y: final.y });
        return;
      }
      previous = result.state;
    }
    throw new Error('No legal fork fixture');
  });
  it.each([100, 350, 2100, 2400])(
    'settles cancellation at %i ms (hop/pause/highlight/card) without recreating DOM',
    async (at) => {
      const { previous, events } = fixture();
      const { scene } = setup(previous);
      let settled = false;
      const promise = scene.playEvents(events.filter((e) => e.type === 'Moved')).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(at);
      scene.cancelLocalMovement();
      await promise;
      expect(settled).toBe(true);
      await vi.runAllTimersAsync();
      expect(find('movement-readout')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('cleans empty/loading/error batches and an explicit mode overrides moved-seat inference', async () => {
    const { previous, events } = fixture('bot');
    const { scene, tweenConfigs } = setup(previous);
    const moves = events.filter((e) => e.type === 'Moved');
    const promise = scene.playEvents(moves, { mode: 'human' });
    await vi.runAllTimersAsync();
    await promise;
    expect(
      tweenConfigs.filter((c) => c.targets.progress !== undefined).map((c) => c.duration),
    ).toEqual(Array(5).fill(560));
    await scene.playEvents([]);
    expect(find('movement-readout')).toBeNull();
    const unloaded = setup(previous).scene;
    Object.assign(unloaded, { latestState: null });
    await unloaded.playEvents(moves);
    expect(find('movement-readout')).toBeNull();
    const broken = setup(previous).scene;
    broken.tweens.add = () => {
      throw new Error('renderer unavailable');
    };
    const failure = expect(broken.playEvents(moves)).rejects.toThrow('renderer unavailable');
    await vi.runAllTimersAsync();
    await failure;
    expect(find('movement-readout')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
