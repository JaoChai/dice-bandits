import { createGame } from '@dice-bandits/engine';
import type { ClientMsg, ServerMsg } from '@dice-bandits/room';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomSocketHandlers } from '../src/online/socket';

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
vi.mock('../src/scenes/BootScene', () => ({ default: class BootScene {} }));
vi.mock('../src/scenes/BoardScene', () => ({ default: class BoardScene {} }));
vi.mock('../src/scenes/BattleScene', () => ({ default: class BattleScene {} }));

import type { OnlineSocket } from '../src/online/screens';

let startOnlineGame: typeof import('../src/main').startOnlineGame;

class FakeSocket implements OnlineSocket {
  sent: ClientMsg[] = [];
  handlers: RoomSocketHandlers | null = null;
  send(message: ClientMsg): void {
    this.sent.push(message);
  }
  close(): void {}
  setHandlers(handlers: RoomSocketHandlers): void {
    this.handlers = handlers;
  }
  receive(message: ServerMsg): void {
    this.handlers?.onMessage(message);
  }
  terminate(code: number): void {
    this.handlers?.onTerminal?.(code);
    this.handlers?.onStatus('closed');
  }
}

const game = createGame({
  seed: 'online-screen-test',
  rounds: 12,
  seats: [
    { name: 'Ada', classId: 'knight', control: 'human', personality: null },
    { name: 'Lin', classId: 'thief', control: 'human', personality: null },
  ],
});

function makeView(overrides: Partial<Extract<ServerMsg, { type: 'view' }>> = {}) {
  return {
    type: 'view' as const,
    turn: 23,
    state: structuredClone(game),
    you: 0,
    legal: [{ type: 'endTurn' as const }],
    seats: [
      {
        seat: 0,
        name: 'Ada',
        classId: 'knight' as const,
        kind: 'human' as const,
        controller: 'player' as const,
        connected: true,
      },
      {
        seat: 1,
        name: 'Lin',
        classId: 'thief' as const,
        kind: 'human' as const,
        controller: 'player' as const,
        connected: true,
      },
    ],
    opponentPicked: false,
    ...overrides,
  };
}

beforeEach(async () => {
  if (!document.querySelector('#app')) document.body.innerHTML = '<div id="app"></div>';
  document.querySelector<HTMLElement>('#app')!.innerHTML = '';
  ({ startOnlineGame } = await import('../src/main'));
  fakeGame.mockClear();
  fakeGame.mockImplementation(() => ({
    destroy: vi.fn(),
    registry: { set: vi.fn() },
    events: { emit: vi.fn(), on: vi.fn() },
    scene: { getScene: vi.fn(), isActive: vi.fn(() => false) },
  }));
});

describe('lobby-to-game language lifecycle', () => {
  it.each([0, 1])(
    'keeps seat %i in the live game after a pending-choice language switch',
    async (viewer) => {
      const { showOnlineScreens } = await import('../src/online/screens');
      const { saveSession } = await import('../src/online/session');
      const { setLang } = await import('../src/i18n');
      const { step, legalActions } = await import('@dice-bandits/engine');
      setLang('th');
      saveSession({ code: 'ABCDE', seat: viewer, token: 'test', name: game.players[viewer]!.name });
      const socket = new FakeSocket();
      showOnlineScreens({
        initialCode: 'ABCDE',
        socketFactory: (options) => {
          socket.setHandlers(options);
          return socket;
        },
        onStartGame: startOnlineGame,
      });
      socket.receive({ type: 'lobby', code: 'ABCDE', host: 0, seats: makeView().seats });
      expect(document.querySelector('[data-testid="screen-lobby"]')).not.toBeNull();
      const state = structuredClone(game);
      state.phase = { kind: 'duelOffer', remaining: 1, targets: [1] };
      const battle = step(state, { type: 'duel', target: 1 }).state;
      socket.receive(makeView({ state: battle, you: viewer, legal: [] }));
      await vi.waitFor(() => expect(fakeGame).toHaveBeenCalled());
      const pending = structuredClone(battle);
      pending.phase = { kind: 'pvpReward', winner: 0, loser: 1 };
      pending.players[1]!.items = ['steelSword'];
      socket.receive({
        type: 'events',
        turn: 24,
        events: [{ type: 'BattleEnded', seat: 0, params: { result: 'aWin' } }],
      });
      const view = makeView({
        state: pending,
        turn: 24,
        you: viewer,
        legal: legalActions(pending, viewer),
      });
      socket.receive(view);
      await vi.waitFor(() =>
        expect(
          document.querySelector(
            '.battle-post[data-beat="choice"] .post-choice-panel:not([hidden])',
          ),
        ).not.toBeNull(),
      );
      const shell = document.querySelector('.game-shell');
      const canvasMount = document.querySelector('#phaser-board');
      setLang('en');
      expect(document.querySelector('.game-shell')).toBe(shell);
      expect(document.querySelector('#phaser-board')).toBe(canvasMount);
      expect(document.querySelector('[data-testid="screen-lobby"]')).toBeNull();
      expect(document.querySelector('.battle-post')?.isConnected).toBe(true);
      expect(document.querySelector('.post-title')?.textContent).toBe(
        viewer === 0 ? 'Take one reward' : 'Waiting for Ada to choose…',
      );
      socket.receive({ ...view, turn: 25 });
      await vi.waitFor(() => expect(document.querySelector('.post-choice-panel')).not.toBeNull());
      if (viewer === 0) {
        const card = document.querySelector<HTMLButtonElement>(
          '[data-testid="post-loot-steelSword"]',
        )!;
        card.click();
        card.click();
        await vi.waitFor(() =>
          expect(socket.sent.filter((msg) => msg.type === 'action')).toHaveLength(1),
        );
      } else {
        expect(
          document.querySelector('.post-choice-panel button, .post-choice-panel [data-choice]'),
        ).toBeNull();
        const picked = step(pending, {
          type: 'pvpReward',
          reward: 'loot',
          item: 'steelSword',
          townId: null,
          alias: null,
        });
        socket.receive({ type: 'events', turn: 26, events: picked.events });
        socket.receive(makeView({ state: picked.state, turn: 26, you: viewer, legal: [] }));
        await vi.waitFor(() =>
          expect(document.querySelector('.post-selected')?.textContent).toContain('Ada took'),
        );
        await vi.waitFor(() => expect(document.querySelector('.battle-post')).toBeNull());
      }
      // Owning game subscriptions must disappear on teardown too.
      socket.terminate(4404);
      const error = document.querySelector('[data-testid="screen-online-error"]');
      setLang('th');
      expect(document.querySelector('[data-testid="screen-online-error"]')).toBe(error);
      expect(document.querySelector('.game-shell')).toBeNull();
    },
  );
});

describe('online post authoritative commits', () => {
  it('commits every view during cosmetics, then keeps a loser receipt without blocking newer views', async () => {
    const { step } = await import('@dice-bandits/engine');
    const state = structuredClone(game);
    state.phase = { kind: 'duelOffer', remaining: 1, targets: [1] };
    const battle = step(state, { type: 'duel', target: 1 }).state;
    const emit = vi.fn();
    const set = vi.fn();
    fakeGame.mockImplementation(() => ({
      destroy: vi.fn(),
      registry: { set },
      events: { emit, on: vi.fn() },
      scene: { getScene: vi.fn(), isActive: () => false },
    }));
    const socket = new FakeSocket();
    startOnlineGame(
      socket,
      { code: 'ABCDE', seat: 1, token: 'test', name: 'Lin' },
      makeView({ state: battle, you: 1, legal: [] }),
    );
    await vi.waitFor(() => expect(fakeGame).toHaveBeenCalled());
    const pending = structuredClone(battle);
    pending.phase = { kind: 'pvpReward', winner: 0, loser: 1 };
    pending.players[1]!.items = ['steelSword'];
    socket.receive({
      type: 'events',
      turn: 24,
      events: [{ type: 'BattleEnded', seat: 0, params: { result: 'aWin' } }],
    });
    socket.receive(makeView({ state: pending, turn: 24, you: 1, legal: [] }));
    await vi.waitFor(() => expect(set).toHaveBeenCalledWith('state', pending));
    expect(emit).toHaveBeenCalledWith('game-state', pending);
    await vi.waitFor(() => expect(document.querySelector('.post-readonly')).not.toBeNull());
    const picked = step(pending, {
      type: 'pvpReward',
      reward: 'loot',
      item: 'steelSword',
      townId: null,
      alias: null,
    });
    socket.receive({ type: 'events', turn: 25, events: picked.events });
    socket.receive(makeView({ state: picked.state, turn: 25, you: 1, legal: [] }));
    await vi.waitFor(() => expect(set).toHaveBeenCalledWith('state', picked.state));
    expect(emit).toHaveBeenCalledWith('game-state', picked.state);
    expect(document.querySelector('.post-selected')?.textContent).toContain('Ada');
    await vi.waitFor(() => expect(document.querySelector('.battle-post')).toBeNull());
  });
});

describe('startOnlineGame', () => {
  it('renders the board with server legal actions and routes clicks to the room socket', async () => {
    const socket = new FakeSocket();
    startOnlineGame(socket, { code: 'ABCDE', seat: 0, token: 'token', name: 'Ada' }, makeView());
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="screen-board"]')).not.toBeNull(),
    );

    expect(document.querySelector('[data-testid="action-endTurn"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="action-roll"]')).toBeNull();
    document.querySelector<HTMLButtonElement>('[data-testid="action-endTurn"]')!.click();
    expect(socket.sent).toEqual([{ type: 'action', action: { type: 'endTurn' }, turn: 23 }]);

    socket.receive(
      makeView({
        turn: 24,
        legal: [],
        seats: makeView().seats.map((seat) =>
          seat.seat === 0 ? { ...seat, controller: 'botTakeover' as const } : seat,
        ),
      }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="online-takeover"]')).not.toBeNull(),
    );
    document.querySelector<HTMLButtonElement>('[data-testid="online-reclaim"]')!.click();
    expect(socket.sent.at(-1)).toEqual({ type: 'reclaim' });
    socket.handlers?.onStatus('reconnecting');
    expect(document.querySelector('[data-testid="online-reconnecting"]')).not.toBeNull();
  });

  it('shows the results screen when the server sends the final view', async () => {
    const finalView = makeView();
    finalView.state.phase = { kind: 'gameOver', ranking: [0, 1], winners: [0], highlights: [] };
    const socket = new FakeSocket();

    startOnlineGame(socket, { code: 'ABCDE', seat: 0, token: 'token', name: 'Ada' }, finalView);

    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="results"]')).not.toBeNull(),
    );
    expect(fakeGame).not.toHaveBeenCalled();
  });

  it('keeps the board after a recoverable error and applies the following view', async () => {
    const { setLang } = await import('../src/i18n');
    setLang('en');
    const socket = new FakeSocket();
    startOnlineGame(socket, { code: 'ABCDE', seat: 0, token: 'token', name: 'Ada' }, makeView());
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="screen-board"]')).not.toBeNull(),
    );

    socket.receive({ type: 'error', key: 'online.error.staleAction' });
    socket.receive(makeView({ turn: 24, legal: [] }));

    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="online-notice"]')).not.toBeNull(),
    );
    expect(document.querySelector('[data-testid="screen-board"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="online-notice"]')?.textContent).toContain(
      'That action is out of date',
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="action-endTurn"]')).toBeNull(),
    );
  });

  it('shows a not-found error and clears the session', async () => {
    const { saveSession, loadSession } = await import('../src/online/session');
    saveSession({ code: 'ABCDE', seat: 0, token: 'token', name: 'Ada' });
    const socket = new FakeSocket();
    startOnlineGame(socket, { code: 'ABCDE', seat: 0, token: 'token', name: 'Ada' }, makeView());
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="screen-board"]')).not.toBeNull(),
    );

    socket.receive({ type: 'error', key: 'online.error.notFound' });

    expect(document.querySelector('[data-testid="screen-online-error"]')).not.toBeNull();
    expect(loadSession('ABCDE')).toBeNull();
  });

  it('shows terminal socket errors and clears the session for a missing room', async () => {
    const { saveSession, loadSession } = await import('../src/online/session');
    saveSession({ code: 'ABCDE', seat: 0, token: 'token', name: 'Ada' });
    const socket = new FakeSocket();
    startOnlineGame(socket, { code: 'ABCDE', seat: 0, token: 'token', name: 'Ada' }, makeView());
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="screen-board"]')).not.toBeNull(),
    );

    socket.terminate(4404);

    expect(document.querySelector('[data-testid="screen-online-error"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="online-error"]')?.textContent).toContain(
      'Room not found',
    );
    expect(loadSession('ABCDE')).toBeNull();
  });

  it('does not call hot-seat saveGame while starting an online game', async () => {
    const saveModule = await import('../src/save');
    const saveSpy = vi.spyOn(saveModule, 'saveGame');
    const socket = new FakeSocket();
    startOnlineGame(socket, { code: 'ABCDE', seat: 0, token: 'token', name: 'Ada' }, makeView());
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="screen-board"]')).not.toBeNull(),
    );
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
