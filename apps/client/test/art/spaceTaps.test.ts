import { createGame, type GameState } from '@dice-bandits/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeSpaceInfo } from '../../src/ui/spaceInfo';
import { bindSpaceTaps } from '../../src/scenes/board/spaceTaps';

vi.mock('phaser', () => ({ default: { Scene: class Scene {} } }));

// Removing the viewport guard must expose real popups or exit whole-map.
// The camera double maps each test point near a real space deliberately:
// inverse projection itself does not reject coordinates outside its viewport.
describe('space taps respect the logical gameplay viewport', () => {
  afterEach(closeSpaceInfo);
  for (const wholeMap of [false, true]) {
    it.each([
      { x: 7, y: 100, inside: false },
      { x: 100, y: 57, inside: false },
      { x: 779, y: 100, inside: false },
      { x: 100, y: 340, inside: false },
      { x: 8, y: 58, inside: true },
      { x: 778, y: 339, inside: true },
    ])(
      `handles ($x, $y) only inside the main viewport, wholeMap=${wholeMap}`,
      ({ x, y, inside }) => {
        const state = createGame({
          seed: 'viewport-taps',
          rounds: 12,
          seats: [
            { name: 'P1', classId: 'knight', control: 'human', personality: null },
            { name: 'P2', classId: 'thief', control: 'human', personality: null },
          ],
        });
        const space = state.board.spaces[0]!;
        let handler: (pointer: { x: number; y: number }) => void = () => {};
        let exited = false;
        const scene = {
          cameras: {
            main: {
              x: 8,
              y: 58,
              width: 771,
              height: 282,
              getWorldPoint: () => ({ x: space.x, y: space.y }),
            },
          },
          input: {
            on: (_event: string, listener: typeof handler) => {
              handler = listener;
            },
            off: () => {},
          },
        };
        const dispose = bindSpaceTaps(
          scene as never,
          () => ({ state, wholeMap }),
          () => {
            exited = true;
          },
        );
        try {
          handler({ x, y });
          expect(exited).toBe(wholeMap && inside);
          expect(document.querySelector('[data-testid="space-info"]') !== null).toBe(
            !wholeMap && inside,
          );
        } finally {
          dispose();
        }
      },
    );
  }
});

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
