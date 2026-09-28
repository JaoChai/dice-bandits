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
    events: { emit: vi.fn() },
    scene: { getScene: vi.fn(), isActive: vi.fn(() => false) },
  }));
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
