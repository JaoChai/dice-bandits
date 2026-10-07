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
      return { previous: state, events: result.events };
    }
    state = result.state;
  }
  throw new Error('No five-step fixture');
}

function setup(previous: GameState) {
  const callbacks = new Map<string, () => void>();
  const source = previous.board.spaces.find(
    (s) => s.id === previous.players[previous.turnSeat]!.pos,
  )!;
  const token = { x: source.x, y: source.y, setFlipX: vi.fn(), setPosition: vi.fn() };
  token.setPosition.mockImplementation((x: number, y: number) => Object.assign(token, { x, y }));
  const tweenConfigs: Array<{ duration: number; targets: unknown }> = [];
  const scene = Object.assign(Object.create(BoardScene.prototype), {
    latestState: previous,
    wholeMap: true,
    cameras: { main: {} },
    tokenObjects: new Map([[previous.turnSeat, token]]),
    spacePositions: new Map(previous.board.spaces.map(({ id, x, y }) => [id, { x, y }])),
    scene: { isActive: () => true },
    game: { canvas: document.querySelector('canvas'), registry: { get: () => undefined } },
    events: { once: (name: string, cb: () => void) => callbacks.set(name, cb) },
    tweens: {
      add: vi.fn((config) => {
        tweenConfigs.push(config);
        const timer = window.setTimeout(() => {
          if (config.targets === token) token.setPosition(config.x, config.y);
          config.onComplete?.();
        }, config.duration);
        return { remove: () => window.clearTimeout(timer) };
      }),
      killTweensOf: vi.fn(),
    },
    add: {
      graphics: () => {
        const graphic = {
          setDepth: vi.fn(),
          lineStyle: vi.fn(),
          strokeCircle: vi.fn(),
          destroy: vi.fn(),
        };
        for (const method of [graphic.setDepth, graphic.lineStyle, graphic.strokeCircle])
          method.mockReturnValue(graphic);
        return graphic;
      },
    },
  }) as BoardScene;
  return { scene, token, tweenConfigs, callbacks };
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
      const hop = control === 'human' ? 280 : 120;
      const hold = control === 'human' ? 120 : 40;
      expect(counts.map((c) => c.count)).toEqual([4, 3, 2, 1, 0]);
      expect(counts.map((c) => c.at)).toEqual(moves.map((_, i) => i * (hop + hold) + hop));
      expect(counts.map(({ x, y }) => ({ x, y }))).toEqual(
        moves.map((e) => {
          const s = previous.board.spaces.find((s) => s.id === e.params.to)!;
          return { x: s.x, y: s.y };
        }),
      );
      expect(tweenConfigs.filter((c) => c.targets === token).map((c) => c.duration)).toEqual(
        Array(5).fill(hop),
      );
      expect(Date.now() - started).toBe(control === 'human' ? 2830 : 1050);
      expect(find('movement-readout')).toBeNull();
    },
  );
  it.each(['speed zero', 'reduced motion'])(
    '%s has a static endpoint and counter without waits',
    async (policy) => {
      if (policy === 'speed zero') window.diceBanditsSpeed = 0;
      else vi.stubGlobal('matchMedia', () => ({ matches: true }));
      const { previous, events } = fixture();
      const { scene, token, tweenConfigs } = setup(previous);
      const counts: number[] = [];
      await scene.playEvents(events, { onStep: (count: number) => counts.push(count) });
      expect(counts).toEqual([4, 3, 2, 1, 0]);
      expect(tweenConfigs).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
      const final = previous.board.spaces.find(
        (s) => s.id === events.filter((e) => e.type === 'Moved').at(-1)!.params.to,
      )!;
      expect({ x: token.x, y: token.y }).toEqual({ x: final.x, y: final.y });
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
    const { scene, tweenConfigs, token } = setup(previous);
    const moves = events.filter((e) => e.type === 'Moved');
    const promise = scene.playEvents(moves, { mode: 'human' });
    await vi.runAllTimersAsync();
    await promise;
    expect(tweenConfigs.filter((c) => c.targets === token).map((c) => c.duration)).toEqual(
      Array(5).fill(280),
    );
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
    await expect(broken.playEvents(moves)).rejects.toThrow('renderer unavailable');
    expect(find('movement-readout')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
