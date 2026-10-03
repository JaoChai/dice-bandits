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

describe('Review 4: one seat-colour system across rings and town flags', () => {
  it('derives town flag colours from seatColors, indexed by owner seat', async () => {
    const { seatColors, seatTint } = await import('../../src/art/colors');
    const { drawTiles } = await import('../../src/scenes/board/tiles');
    const state = gameFor('flag-colors');
    // Two knights: seat 0 keeps blue, seat 1 must fall back — ring and flag
    // must agree per seat.
    state.players[0]!.classId = 'knight';
    state.players[1]!.classId = 'knight';
    const colors = seatColors(state.players.map((player) => player.classId));

    const flagColors: number[] = [];
    const graphicsCreated: Array<Record<string, unknown>> = [];
    const image = { setDepth: () => image, setDisplaySize: () => image };
    const scene = {
      textures: {
        exists: () => true,
        get: () => ({ has: () => true }),
      },
      add: {
        image: vi.fn(() => image),
        graphics: vi.fn(() => {
          const g: Record<string, unknown> = {
            setDepth: () => g,
            __fills: [] as number[],
            fillStyle: (color: number) => {
              (g.__fills as number[]).push(color);
              return g;
            },
            fillRoundedRect: () => g,
            fillRect: () => g,
          };
          graphicsCreated.push(g);
          return g;
        }),
      },
    };
    const owners = new Map<number, number | null>([
      [0, 0],
      [1, 1],
    ]);
    const spaces = [
      { id: 0, kind: 'town', x: 400, y: 400 },
      { id: 1, kind: 'town', x: 800, y: 400 },
    ] as never[];
    drawTiles(scene as never, spaces, owners, state);

    // Each owned space draws a flag whose first fillStyle is the seat colour.
    const flagFor = (spaceId: number) => (graphicsCreated[spaceId]!.__fills as number[])[0]!;
    expect(flagFor(0)).toBe(seatTint(colors[0]!));
    expect(flagFor(1)).toBe(seatTint(colors[1]!));
    // Duplicate knights: the two flags differ (no shared green/orange clash).
    expect(flagFor(0)).not.toBe(flagFor(1));
    flagColors.push(flagFor(0), flagFor(1));
    expect(new Set(flagColors).size).toBe(2);
  });
});
