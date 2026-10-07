import {
  createGame,
  legalActions,
  step,
  type GameEvent,
  type GameState,
} from '@dice-bandits/engine';
import type { ClientMsg, ServerMsg } from '@dice-bandits/room';
import { describe, expect, it, vi } from 'vitest';
import { OnlineController } from '../src/online/onlineController';
import { renderHud } from '../src/ui/hud';

const { fakeGame } = vi.hoisted(() => ({ fakeGame: vi.fn() }));
vi.mock('phaser', () => ({
  default: {
    Game: class {
      constructor() {
        return fakeGame();
      }
    },
    AUTO: 0,
    Scale: { FIT: 0, CENTER_BOTH: 0 },
  },
}));
vi.mock('../src/scenes/BootScene', () => ({ default: class {} }));
vi.mock('../src/scenes/BoardScene', () => ({ default: class {} }));
vi.mock('../src/scenes/BattleScene', () => ({ default: class {} }));

const initialState = createGame({
  seed: 'online-controller-test',
  rounds: 12,
  seats: [
    { name: 'Human', classId: 'knight', control: 'human', personality: null },
    { name: 'Bot', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
});

class FakeSocket {
  sent: ClientMsg[] = [];
  send(message: ClientMsg): void {
    this.sent.push(message);
  }
}

function view(
  overrides: Partial<Extract<ServerMsg, { type: 'view' }>> = {},
): Extract<ServerMsg, { type: 'view' }> {
  return {
    type: 'view',
    turn: 12,
    state: structuredClone(initialState),
    you: 0,
    legal: [{ type: 'endTurn' }],
    seats: [
      {
        seat: 0,
        name: 'Human',
        classId: 'knight',
        kind: 'human',
        controller: 'player',
        connected: true,
      },
      { seat: 1, name: 'Bot', classId: 'thief', kind: 'bot', controller: 'bot', connected: true },
    ],
    opponentPicked: false,
    ...overrides,
  };
}

function battleStateWithSeatZeroPicking(): GameState {
  let state = createGame({
    seed: 'online-pvp-test',
    rounds: 12,
    seats: [0, 1].map((seat) => ({
      name: `Human ${seat}`,
      classId: seat === 0 ? 'knight' : 'thief',
      control: 'human' as const,
      personality: null,
    })),
  });
  state.phase = { kind: 'duelOffer', remaining: 1, targets: [1] };
  state.turnSeat = 0;
  state = step(state, { type: 'duel', target: 1 }).state;
  if (state.phase.kind !== 'battle') throw new Error('expected PvP battle');
  const firstPicker = state.players.find((player) =>
    legalActions(state, player.seat).some((action) => action.type === 'battlePick'),
  );
  if (!firstPicker) throw new Error('expected first PvP picker');
  const firstPick = legalActions(state, firstPicker.seat).find(
    (action) => action.type === 'battlePick',
  );
  if (!firstPick) throw new Error('expected legal battle pick');
  state = step(state, firstPick).state;
  if (!legalActions(state, 0).some((action) => action.type === 'battlePick'))
    throw new Error('expected seat 0 to pick second');
  return state;
}

function makeController(
  onEvents: (events: GameEvent[], state: GameState) => Promise<void> = async () => undefined,
) {
  const socket = new FakeSocket();
  const controller = new OnlineController({
    state: structuredClone(initialState),
    socket,
    onEvents,
  });
  return { controller, socket };
}

describe('online main movement seam', () => {
  it.each(['reconnect', 'newer-view'])(
    'keeps queued authoritative commits but suppresses ghosts superseded by %s',
    async (invalidation) => {
      document.body.innerHTML = '<div id="app"></div>';
      vi.resetModules();
      const { startOnlineGame } = await import('../src/main');
      const previous = createGame({
        seed: 'movement-overlay',
        rounds: 12,
        seats: initialState.players.map((player) => ({
          name: player.name,
          classId: player.classId,
          control: player.control,
          personality: player.personality,
        })),
      });
      const next = step(previous, { type: 'roll' });
      expect(next.events.filter((event) => event.type === 'Moved')).toHaveLength(5);
      let battleActive = false;
      let releaseBattle!: () => void;
      const board = {
        presentOnlineMovement: vi.fn(),
        cancelOnlineMovement: vi.fn(),
        playEvents: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseBattle = resolve;
            }),
        ),
        scene: { launch: vi.fn(), stop: vi.fn() },
      };
      const mounted = {
        destroy: vi.fn(),
        registry: { set: vi.fn() },
        events: { on: vi.fn(), emit: vi.fn() },
        scene: { getScene: () => board, isActive: () => battleActive },
      };
      fakeGame.mockReturnValue(mounted);
      let handlers!: import('../src/online/socket').RoomSocketHandlers;
      const socket = {
        send: vi.fn(),
        close: vi.fn(),
        setHandlers: (next: typeof handlers) => {
          handlers = next;
        },
      };
      const flush = async () => {
        for (let i = 0; i < 60; i++) await Promise.resolve();
      };
      startOnlineGame(
        socket,
        { code: 'ABCDE', seat: 0, token: 'test', name: 'Human' },
        view({ turn: 1, state: previous }),
      );
      await flush();
      board.presentOnlineMovement.mockClear();
      mounted.registry.set.mockClear();
      try {
        // Unchanged battle playback holds the queue before the next view's callback starts.
        battleActive = true;
        handlers.onMessage(view({ turn: 2, state: previous }));
        await flush();
        expect(board.playEvents).toHaveBeenCalledOnce();
        handlers.onMessage({ type: 'events', turn: 3, events: next.events });
        handlers.onMessage(
          view({ turn: 3, state: next.state, legal: legalActions(next.state, 0) }),
        );
        if (invalidation === 'reconnect') {
          handlers.onStatus('reconnecting');
          handlers.onStatus('open');
        } else {
          handlers.onMessage(
            view({ turn: 4, state: next.state, legal: legalActions(next.state, 0) }),
          );
        }
        battleActive = false;
        releaseBattle();
        await flush();
        expect(mounted.registry.set.mock.calls).toEqual([
          ['state', previous],
          ['state', next.state],
          ...(invalidation === 'newer-view' ? [['state', next.state]] : []),
        ]);
        if (invalidation === 'reconnect') {
          expect(board.presentOnlineMovement).not.toHaveBeenCalled();
          // Only a view received after reconnect may schedule movement again.
          handlers.onMessage({ type: 'events', turn: 4, events: next.events });
          handlers.onMessage(
            view({ turn: 4, state: next.state, legal: legalActions(next.state, 0) }),
          );
          await flush();
        }
        expect(board.presentOnlineMovement).toHaveBeenCalledOnce();
        expect(board.presentOnlineMovement).toHaveBeenLastCalledWith(
          next.state,
          next.state,
          invalidation === 'reconnect' ? next.events : [],
          expect.any(Number),
        );
        const actions = document.querySelectorAll<HTMLButtonElement>(
          '[data-action-index], [data-choice]',
        );
        expect(actions.length).toBeGreaterThan(0);
        expect([...actions].every((action) => !action.disabled)).toBe(true);
      } finally {
        document.querySelector('#app')!.dispatchEvent(new Event('dice-bandits:menu-exit'));
      }
    },
  );
  it('commits views and enables legal actions before a delayed board tween; cancels on input/reconnect/exit', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    vi.resetModules();
    const { startOnlineGame } = await import('../src/main');
    const board = {
      playEvents: vi.fn(() => new Promise<void>(() => undefined)),
      presentOnlineMovement: vi.fn(),
      cancelOnlineMovement: vi.fn(),
    };
    const commits: string[] = [];
    const mounted = {
      destroy: vi.fn(),
      registry: { set: vi.fn() },
      events: { on: vi.fn(), emit: vi.fn(() => commits.push('state')) },
      scene: { getScene: () => board, isActive: () => false },
    };
    fakeGame.mockReturnValue(mounted);
    let handlers!: import('../src/online/socket').RoomSocketHandlers;
    const socket = {
      send: vi.fn(),
      close: vi.fn(),
      setHandlers: (next: typeof handlers) => {
        handlers = next;
      },
    };
    const flush = async () => {
      for (let i = 0; i < 40; i++) await Promise.resolve();
    };
    startOnlineGame(socket, { code: 'ABCDE', seat: 0, token: 'test', name: 'Human' }, view());
    await flush();
    vi.useFakeTimers();
    try {
      board.presentOnlineMovement.mockImplementation(() => {
        commits.push('ghost');
        setTimeout(() => commits.push('tween'), 120);
      });
      const next = structuredClone(initialState);
      next.players[0]!.pos = 6;
      const events: GameEvent[] = [{ type: 'Moved', seat: 0, params: { to: 6, remaining: 0 } }];
      handlers.onMessage({ type: 'events', turn: 13, events });
      handlers.onMessage(view({ turn: 13, state: next }));
      await flush();
      expect(board.playEvents).not.toHaveBeenCalled();
      expect(mounted.registry.set).toHaveBeenLastCalledWith('state', next);
      expect(commits.slice(-2)).toEqual(['state', 'ghost']);
      expect(commits).not.toContain('tween');
      expect(board.presentOnlineMovement).toHaveBeenLastCalledWith(
        initialState,
        next,
        events,
        expect.any(Number),
      );
      const action = document.querySelector<HTMLButtonElement>('[data-testid="action-endTurn"]')!;
      expect(action.disabled).toBe(false);
      action.click();
      expect(socket.send).toHaveBeenCalledOnce();
      expect(board.cancelOnlineMovement).toHaveBeenCalled();
      board.cancelOnlineMovement.mockClear();
      handlers.onStatus('reconnecting');
      expect(board.cancelOnlineMovement).toHaveBeenCalledOnce();
      handlers.onMessage(view({ turn: 14, state: next }));
      await flush();
      expect(board.presentOnlineMovement).toHaveBeenLastCalledWith(
        next,
        next,
        [],
        expect.any(Number),
      );
      document.querySelector('#app')!.dispatchEvent(new Event('dice-bandits:menu-exit'));
      expect(mounted.destroy).toHaveBeenCalledWith(true);
      expect(board.cancelOnlineMovement.mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('OnlineController', () => {
  it.each([true, false])(
    'commits the next scene state exactly once for a view with no events (empty batch: %s)',
    async (sendEmptyBatch) => {
      const before = structuredClone(initialState);
      before.phase = { kind: 'endOfTurn' };
      const next = step(before, { type: 'endTurn' });
      expect(next.events).toEqual([]);
      expect(next.state.turnSeat).toBe(1);
      expect(next.state.phase.kind).toBe('awaitRoll');
      let sceneState = before;
      const commits: Array<{ events: GameEvent[]; state: GameState }> = [];
      const { controller } = makeController(async (events, state) => {
        sceneState = state;
        commits.push({ events, state });
      });
      await controller.handleMessage(view({ state: before }));
      // A welcome/initial view has no preceding batch, but still commits once
      // with no presentation events and leaves the HUD ready for input.
      expect(commits).toEqual([{ events: [], state: before }]);
      expect(sceneState).toEqual(before);
      expect(controller.hudOnlineState.awaitingView).toBe(false);
      commits.length = 0;

      if (sendEmptyBatch) await controller.handleMessage({ type: 'events', turn: 13, events: [] });
      await controller.handleMessage(
        view({ turn: 13, state: next.state, legal: legalActions(next.state, 0) }),
      );

      expect(controller.state).toEqual(next.state);
      expect(sceneState).toEqual(next.state);
      expect(commits).toEqual([{ events: [], state: next.state }]);
      expect(controller.hudOnlineState.awaitingView).toBe(false);
    },
  );

  it('disables actions after dispatch until the next view and ignores duplicate dispatches', async () => {
    const { controller, socket } = makeController();
    await controller.handleMessage(view());
    const root = document.createElement('div');
    document.body.append(root);
    const render = () =>
      renderHud(root, controller.state, (action) => void controller.dispatch(action), {
        legal: controller.legal,
        online: controller.hudOnlineState,
      });
    render();

    root.querySelector<HTMLButtonElement>('[data-testid="action-endTurn"]')!.click();
    render();
    expect(root.querySelector<HTMLButtonElement>('[data-testid="action-endTurn"]')?.disabled).toBe(
      true,
    );
    root.querySelector<HTMLButtonElement>('[data-testid="action-endTurn"]')!.click();
    expect(socket.sent).toHaveLength(1);

    await controller.handleMessage(view({ turn: 13 }));
    render();
    expect(root.querySelector<HTMLButtonElement>('[data-testid="action-endTurn"]')?.disabled).toBe(
      false,
    );
    root.remove();
  });

  it('disables actions on events until the following view is applied', async () => {
    const { controller, socket } = makeController();
    await controller.handleMessage(view());
    const root = document.createElement('div');
    document.body.append(root);
    const render = () =>
      renderHud(root, controller.state, (action) => void controller.dispatch(action), {
        legal: controller.legal,
        online: controller.hudOnlineState,
      });
    render();

    await controller.handleMessage({ type: 'events', turn: 13, events: [] });
    render();
    expect(root.querySelector<HTMLButtonElement>('[data-testid="action-endTurn"]')?.disabled).toBe(
      true,
    );
    root.querySelector<HTMLButtonElement>('[data-testid="action-endTurn"]')!.click();
    expect(socket.sent).toHaveLength(0);

    await controller.handleMessage(view({ turn: 13 }));
    render();
    expect(root.querySelector<HTMLButtonElement>('[data-testid="action-endTurn"]')?.disabled).toBe(
      false,
    );
    root.remove();
  });

  it('uses only server-provided legal actions in the HUD and sends them with the current turn', async () => {
    const { controller, socket } = makeController();
    await controller.handleMessage(view({ legal: [{ type: 'endTurn' }] }));
    const root = document.createElement('div');
    document.body.append(root);

    renderHud(root, controller.state, (action) => void controller.dispatch(action), {
      legal: controller.legal,
      online: controller.hudOnlineState,
    });

    expect(root.querySelector('[data-testid="action-endTurn"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="action-roll"]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-testid="action-endTurn"]')!.click();
    expect(socket.sent).toEqual([{ type: 'action', action: { type: 'endTurn' }, turn: 12 }]);
    root.remove();
  });

  it('uses the server battle picks without showing a pass-the-device screen online', async () => {
    const state = battleStateWithSeatZeroPicking();
    const serverLegal = legalActions(state, 0).filter((action) => action.type === 'battlePick');
    const { controller } = makeController();
    await controller.handleMessage(view({ state, legal: serverLegal, opponentPicked: true }));
    const root = document.createElement('div');
    document.body.append(root);

    renderHud(root, controller.state, (action) => void controller.dispatch(action), {
      legal: controller.legal,
      online: controller.hudOnlineState,
    });

    expect(root.querySelector('[data-testid="pass-screen"]')).toBeNull();
    expect(root.querySelectorAll('[data-testid^="pick-"]')).toHaveLength(serverLegal.length);
    expect(root.querySelector('[data-testid="online-opponent-picked"]')).not.toBeNull();
    root.remove();
  });

  it('serializes views and events that arrive while an animation is pending', async () => {
    let releaseAnimation!: () => void;
    const animation = new Promise<void>((resolve) => {
      releaseAnimation = resolve;
    });
    const onEvents = vi.fn((events: GameEvent[]) =>
      events.length > 0 ? animation : Promise.resolve(),
    );
    const { controller } = makeController(onEvents);
    await controller.handleMessage(view({ turn: 10 }));
    // The initial view now commits too; count only the pending event batches.
    onEvents.mockClear();
    const view1State = { ...structuredClone(initialState), round: 2 };
    const view2State = { ...structuredClone(initialState), round: 3 };
    const events = [{ type: 'turnEnded' } as unknown as GameEvent];

    const applyingEvents1 = controller.handleMessage({ type: 'events', turn: 11, events });
    const applyingView1 = controller.handleMessage(view({ turn: 11, state: view1State }));
    await Promise.resolve();
    const applyingEvents2 = controller.handleMessage({ type: 'events', turn: 12, events });
    const applyingView2 = controller.handleMessage(view({ turn: 12, state: view2State }));
    await Promise.resolve();

    await vi.waitFor(() => expect(onEvents).toHaveBeenCalledTimes(1));
    expect(controller.turn).toBe(10);
    expect(controller.state.round).toBe(1);
    expect(onEvents).toHaveBeenCalledTimes(1);
    releaseAnimation();
    await Promise.all([applyingEvents1, applyingView1, applyingEvents2, applyingView2]);
    expect(controller.turn).toBe(12);
    expect(controller.state.round).toBe(3);
  });

  it('shows takeover and reconnecting banners and reclaims the controlled seat', async () => {
    const { controller, socket } = makeController();
    await controller.handleMessage(
      view({
        seats: [
          {
            seat: 0,
            name: 'Human',
            classId: 'knight',
            kind: 'human',
            controller: 'botTakeover',
            connected: false,
          },
          {
            seat: 1,
            name: 'Bot',
            classId: 'thief',
            kind: 'bot',
            controller: 'bot',
            connected: true,
          },
        ],
      }),
    );
    const root = document.createElement('div');
    document.body.append(root);
    const render = () =>
      renderHud(root, controller.state, (action) => void controller.dispatch(action), {
        legal: controller.legal,
        online: controller.hudOnlineState,
      });
    render();

    expect(root.querySelector('[data-testid="online-takeover"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="online-reclaim"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="seat-takeover-0"]')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-testid="online-reclaim"]')!.click();
    expect(socket.sent).toEqual([{ type: 'reclaim' }]);

    controller.setSocketStatus('reconnecting');
    render();
    expect(root.querySelector('[data-testid="online-reconnecting"]')).not.toBeNull();
    root.remove();
  });

  it('does not save online state locally', async () => {
    const saveSpy = vi.spyOn(await import('../src/save'), 'saveGame');
    const { controller } = makeController();
    await controller.handleMessage(view());
    await controller.dispatch({ type: 'endTurn' });
    expect(saveSpy).not.toHaveBeenCalled();
    saveSpy.mockRestore();
  });
});
