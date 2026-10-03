import { createGame, type GameState } from '@dice-bandits/engine';
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
    Scene: class Scene {},
    Math: { Vector2: class Vector2 {} },
    GameObjects: {
      Image: class Image {},
      Sprite: class Sprite {},
      Graphics: class Graphics {},
    },
  },
}));
vi.mock('../src/scenes/BootScene', () => ({ default: class BootScene {} }));
// Real BoardScene: the review item is its validate() gate firing the
// `onBoardOutdated` registry callback main.ts registers.
vi.mock('../src/scenes/BattleScene', () => ({ default: class BattleScene {} }));

import type { OnlineSocket } from '../src/online/screens';
import { default as BoardScene } from '../src/scenes/BoardScene';

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
  seed: 'board-outdated-test',
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

/** Board whose ids/coords differ from MAP: a room created before a deploy. */
function outdatedView() {
  const view = makeView();
  view.state.board.spaces = view.state.board.spaces.map((space) => ({
    ...space,
    id: space.id + 1000,
    next: space.next.map((next) => next + 1000),
  }));
  return view;
}

interface Rec {
  kind: string;
}

/** Chainable game-object double so a (wrongly) rendered board draws silently. */
function gameObject(kind: string): never {
  const rec: Rec = { kind };
  return new Proxy(rec, {
    get() {
      return () => proxyOf(rec);
    },
  }) as never;
}

function proxyOf(rec: Rec): never {
  return new Proxy(rec, {
    get() {
      return () => proxyOf(rec);
    },
  }) as never;
}

/**
 * Real BoardScene wired to the SAME registry the controller under test
 * registered its callbacks on, so renderBoard exercises the genuine
 * validate() gate instead of a hand-fired callback.
 */
function realSceneOn(gameMock: {
  registry: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
}): void {
  const registry = new Map<string, unknown>();
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
    game: { events: { on: vi.fn(), emit: vi.fn() }, registry: gameMock.registry },
    textures: { exists: vi.fn(() => false), get: vi.fn(() => ({ has: () => true })) },
    anims: { exists: vi.fn(() => true) },
    cache: { json: { get: vi.fn(() => undefined) } },
    tweens: { add: vi.fn(), remove: vi.fn() },
    add: {
      image: vi.fn(() => gameObject('image')),
      sprite: vi.fn(() => gameObject('sprite')),
      graphics: vi.fn(() => gameObject('graphics')),
      rectangle: vi.fn(() => gameObject('rectangle')),
      zone: vi.fn(() => gameObject('zone')),
    },
  }) as unknown as { renderBoard(state: GameState): void };
  // Serve back exactly what main.ts registered on the shared registry.
  const registrySet = gameMock.registry.set as unknown as {
    mock: { calls: [string, unknown][] };
  };
  for (const [key, value] of registrySet.mock.calls) registry.set(key, value);
  gameMock.registry.get.mockImplementation((key: unknown) => registry.get(String(key)));
  scene.renderBoard(registry.get('state') as GameState);
}

beforeEach(async () => {
  if (!document.querySelector('#app')) document.body.innerHTML = '<div id="app"></div>';
  document.querySelector<HTMLElement>('#app')!.innerHTML = '';
  ({ startOnlineGame } = await import('../src/main'));
  fakeGame.mockClear();
  fakeGame.mockImplementation(() => ({
    destroy: vi.fn(),
    registry: { set: vi.fn(), get: vi.fn(() => undefined) },
    events: { emit: vi.fn(), on: vi.fn() },
    scene: { getScene: vi.fn(), isActive: vi.fn(() => false) },
  }));
});

describe('startOnlineGame boardOutdated flow', () => {
  it('shows error.boardOutdated and returns to title for a board from another map', async () => {
    const { setLang } = await import('../src/i18n');
    const { loadSession } = await import('../src/online/session');
    setLang('en');
    const socket = new FakeSocket();
    const session = { code: 'OUTDA', seat: 0, token: 'token', name: 'Ada' };
    startOnlineGame(socket, session, outdatedView());

    // The board view mounts and the Phaser game is created; driving the real
    // BoardScene with the mismatched view state must trip the gate.
    await vi.waitFor(() => expect(fakeGame).toHaveBeenCalled());
    realSceneOn(fakeGame.mock.results.at(-1)!.value);

    expect(fakeGame.mock.results.at(-1)!.value.destroy).toHaveBeenCalledWith(true);
    expect(document.querySelector('[data-testid="screen-online-error"]')).not.toBeNull();
    const error = document.querySelector('[data-testid="online-error"]');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('This room was created with an older board');
    expect(document.querySelector('[data-testid="screen-board"]')).toBeNull();

    // Back to title.
    document.querySelector<HTMLButtonElement>('[data-testid="online-back-title"]')!.click();
    expect(document.querySelector('[data-testid="screen-title"]')).not.toBeNull();
    expect(loadSession('OUTDA')).toBeNull();
  });

  it('still renders the board for a view produced by the current MAP', async () => {
    const socket = new FakeSocket();
    startOnlineGame(socket, { code: 'VALID', seat: 0, token: 'token', name: 'Ada' }, makeView());
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="screen-board"]')).not.toBeNull(),
    );
    expect(fakeGame).toHaveBeenCalled();
  });
});
