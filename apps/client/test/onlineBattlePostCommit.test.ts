import type { GameState } from '@dice-bandits/engine';
import type { ServerMsg } from '@dice-bandits/room';
import { expect, it, vi } from 'vitest';
import capture from './fixtures/online-battle-end-capture.json';

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

it('does not roll the board back when the captured bot-chain battle post resolves before controller handoff', async () => {
  document.body.innerHTML = '<div id="app"></div>';
  const { startOnlineGame } = await import('../src/main');
  const frames = capture.frames.map(({ message }) => message) as ServerMsg[];
  const finalView = frames.find((message) => message.type === 'view')!;
  if (finalView.type !== 'view') throw new Error('missing captured view');
  const previous = capture.previous as unknown as GameState;
  let latestState = previous;
  const registry = new Map<string, unknown>();
  const committed: GameState[] = [];
  const board = {
    presentOnlineMovement: vi.fn(),
    cancelOnlineMovement: vi.fn(),
    scene: { launch: vi.fn(), stop: vi.fn() },
  };
  fakeGame.mockReturnValue({
    destroy: vi.fn(),
    registry: {
      set: (key: string, value: unknown) => registry.set(key, value),
      get: (key: string) => registry.get(key),
    },
    events: {
      on: vi.fn(),
      emit: (event: string, state: GameState) => {
        if (event === 'game-state') {
          latestState = state;
          committed.push(state);
        }
      },
    },
    scene: { getScene: () => board, isActive: () => false },
  });
  let handlers!: import('../src/online/socket').RoomSocketHandlers;
  const socket = {
    send: vi.fn(),
    close: vi.fn(),
    setHandlers: (next: typeof handlers) => {
      handlers = next;
    },
  };
  const flush = async () => {
    for (let i = 0; i < 80; i++) await Promise.resolve();
  };
  window.diceBanditsSpeed = 0;
  startOnlineGame(
    socket,
    { code: 'ABCDE', seat: finalView.you, token: 'test', name: 'Alice' },
    {
      ...finalView,
      turn: finalView.turn - 1,
      state: previous,
      legal: [],
    },
  );
  await flush();
  window.diceBanditsSpeed = 0;
  committed.length = 0;
  vi.useFakeTimers();
  try {
    // Replay the captured events/view pair verbatim. Only the initial scene
    // state is bootstrapped from the stale commit observed in the same capture.
    for (const message of frames) handlers.onMessage(message);
    await flush();
    expect(registry.get('state')).toEqual(finalView.state);
    expect(committed[0]).toEqual(finalView.state);
    // With no further server view, the obsolete cosmetic emission persists
    // beyond the unchanged scene-convergence deadline.
    await vi.advanceTimersByTimeAsync(2001);
    expect(latestState).toEqual(finalView.state);
  } finally {
    vi.useRealTimers();
    document.querySelector('#app')!.dispatchEvent(new Event('dice-bandits:menu-exit'));
  }
});
