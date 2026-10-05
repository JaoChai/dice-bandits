import { createGame, type GameState } from '@dice-bandits/engine';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class Scene {} } }));

/**
 * Review 6a: BoardScene re-renders many times per game; each render must
 * NOT add another `input.on('pointerdown')` handler (they pile up, each
 * holding a stale state).
 */
describe('Review 6a: bindSpaceTaps registers exactly one pointerdown handler', () => {
  it('re-binding across renders keeps a single pointerdown listener', async () => {
    const state: GameState = createGame({
      seed: 'bind-once',
      rounds: 12,
      seats: [
        { name: 'P1', classId: 'knight', control: 'human', personality: null },
        { name: 'P2', classId: 'thief', control: 'bot', personality: 'greedy' },
      ],
    });
    const { bindSpaceTaps } = await import('../../src/scenes/board/spaceTaps');
    const handlers: Array<(pointer: unknown) => void> = [];
    const input = {
      on: vi.fn((_event: string, handler: (pointer: unknown) => void) => {
        handlers.push(handler);
      }),
      off: vi.fn((_event: string, handler: (pointer: unknown) => void) => {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      }),
    };
    const scene = { input, cameras: { main: {} } };
    const contextOf = () => ({ state, wholeMap: false });

    // Simulate three renders; every bind unbinds the previous handler so the
    // scene keeps exactly one live listener while binding.
    const unbind1 = bindSpaceTaps(scene as never, contextOf, vi.fn());
    expect(handlers).toHaveLength(1);
    const unbind2 = bindSpaceTaps(scene as never, contextOf, vi.fn());
    unbind1();
    expect(handlers).toHaveLength(1);
    const unbind3 = bindSpaceTaps(scene as never, contextOf, vi.fn());
    unbind2();
    expect(handlers).toHaveLength(1);
    unbind3();
    expect(handlers).toHaveLength(0);

    expect(input.on).toHaveBeenCalledTimes(3);
  });
});
