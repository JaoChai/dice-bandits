import { createGame, type GameState, type Town } from '@dice-bandits/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class Scene {} } }));

const { drawBuildings, townTier, BUILDING_SCALE, CASTLE_BUILDING, BARON_FORT_BUILDING } =
  await import('../../src/scenes/board/buildings');

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

beforeEach(() => vi.restoreAllMocks());

/** Image double capturing placement for position assertions. */
function buildingScene() {
  const placed: Array<{ key: string; frame: string; x: number; y: number; displayW: number }> = [];
  const scene = {
    textures: {
      exists: vi.fn(() => true),
      get: vi.fn(() => ({
        has: (frame: string) =>
          ['castle', 'town1', 'town2', 'town3', 'shopCart', 'baronFort'].includes(frame),
        get: (frame: string) =>
          frame === 'town1' ? { width: 270, height: 192 } : { width: 280, height: 275 },
      })),
    },
    add: {
      image: vi.fn((x: number, y: number, key: string, frame: string) => {
        const record = { key, frame, x, y, displayW: 0 };
        placed.push(record);
        const image = {
          setDepth: () => image,
          setDisplaySize: (w: number) => {
            record.displayW = w;
            return image;
          },
          setOrigin: () => image,
        };
        return image;
      }),
    },
  };
  return { scene, placed };
}

describe('townTier', () => {
  it('maps value tiers to the atlas town frames', () => {
    expect(townTier(150)).toBe('town1');
    expect(townTier(450)).toBe('town2');
    expect(townTier(900)).toBe('town3');
  });
});

describe('Review 3: buildings sit beside their tile at authored spots', () => {
  it('offsets and scales town buildings so they clear the 96 px tile', () => {
    const { scene, placed } = buildingScene();
    const state = gameFor('buildings-tier');
    const towns: Town[] = [{ spaceId: 1, owner: 0, value: 10, guardianLevel: 0 }];
    drawBuildings(
      scene as never,
      towns,
      (spaceId) => (spaceId === 1 ? { x: 600, y: 1200 } : undefined),
    );
    expect(placed).toHaveLength(3);
    const building = placed.find((entry) => entry.frame === 'town1')!;
    expect(building.frame).toBe('town1');
    // Beside the tile: at least half a tile + half a building away from centre.
    expect(Math.hypot(building.x - 600, building.y - 1200)).toBeGreaterThan(96);
    // Scaled down from the ~270 px native frame.
    expect(building.displayW).toBeLessThanOrEqual(190);
    expect(building.displayW).toBeGreaterThan(0);
    expect(BUILDING_SCALE).toBeGreaterThan(0);
  });

  it('draws the castle building about 250 px left of node 0', () => {
    const { scene, placed } = buildingScene();
    const state = gameFor('buildings-castle');
    void state;
    drawBuildings(scene as never, [], () => undefined);
    const castle = placed.find((entry) => entry.frame === CASTLE_BUILDING);
    expect(castle).toBeTruthy();
    expect(castle!.key).toBe('art:buildings');
    expect(castle!.x).toBe(470 - 250);
    expect(castle!.y).toBe(1150);
  });

  it('draws the baron fort at its authored loop position', () => {
    const { scene, placed } = buildingScene();
    drawBuildings(scene as never, [], () => undefined);
    const fort = placed.find((entry) => entry.frame === BARON_FORT_BUILDING);
    expect(fort).toBeTruthy();
    expect(fort!.x).toBe(656);
    expect(fort!.y).toBe(900);
  });
});
