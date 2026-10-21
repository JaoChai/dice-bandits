import { createGame, MAP, type GameState } from '@dice-bandits/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { reducedMotion } = vi.hoisted(() => ({ reducedMotion: vi.fn(() => false) }));

vi.mock('phaser', () => ({ default: { Scene: class Scene {} } }));
vi.mock('../../src/art/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/art/motion')>()),
  reducedMotion: vi.fn(() => reducedMotion()),
}));

const { cameraTarget, WORLD, VIEW, zoomForSpan, followCentre, paintedBounds } =
  await import('../../src/scenes/board/camera');

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

afterEach(() => {
  reducedMotion.mockReturnValue(false);
  window.diceBanditsSpeed = 1;
});

describe('boardViewport', () => {
  it.each([
    {
      css: { width: 915, height: 412 },
      right: 136,
      want: { x: 16, y: 116, width: 1542, height: 588 },
    },
    {
      css: { width: 932, height: 388 },
      right: 136,
      want: { x: 16, y: 116, width: 1576, height: 540 },
    },
    {
      css: { width: 1280, height: 720 },
      right: 184,
      want: { x: 16, y: 116, width: 2176, height: 1204 },
    },
  ])(
    'converts approved CSS lanes without changing tile scale at $css.width',
    async ({ css, right, want }) => {
      const camera = await import('../../src/scenes/board/camera');
      expect(
        camera.boardViewport({ width: css.width * 2, height: css.height * 2 }, css, {
          left: 8,
          top: 58,
          right,
          bottom: 60,
        }),
      ).toEqual(want);
    },
  );

  it('bounds invalid dimensions and oversized or nonfinite insets', async () => {
    const camera = await import('../../src/scenes/board/camera');
    for (const logical of [
      { width: NaN, height: Infinity },
      { width: 0, height: -1 },
      { width: 1280, height: 720 },
    ]) {
      const viewport = camera.boardViewport(
        logical,
        { width: 0, height: NaN },
        { left: Infinity, top: -10, right: 1e12, bottom: NaN },
      );
      for (const value of Object.values(viewport)) expect(Number.isFinite(value)).toBe(true);
      expect(viewport.x).toBeGreaterThanOrEqual(0);
      expect(viewport.y).toBeGreaterThanOrEqual(0);
      expect(viewport.width).toBeGreaterThanOrEqual(1);
      expect(viewport.height).toBeGreaterThanOrEqual(1);
      expect(viewport.x + viewport.width).toBeLessThanOrEqual(
        Math.max(1, Number.isFinite(logical.width) ? logical.width : 1),
      );
      expect(viewport.y + viewport.height).toBeLessThanOrEqual(
        Math.max(1, Number.isFinite(logical.height) ? logical.height : 1),
      );
    }
  });

  it('fits the whole authored world inside the safe camera, not the full canvas', () => {
    const view = { width: 1347, height: 514 };
    const target = cameraTarget(gameFor('safe-whole'), true, view);
    expect(view.width / target.zoom).toBeGreaterThanOrEqual(3200);
    expect(view.height / target.zoom).toBeGreaterThanOrEqual(1800);
    expect(target.zoom).toBeCloseTo(514 / 1800, 8);
  });

  it('fits the world inside the 1280x720 safe rect with room to spare', () => {
    const view = { width: 1088, height: 602 };
    const target = cameraTarget(gameFor('safe-720'), true, view);
    expect(view.width / target.zoom).toBeGreaterThanOrEqual(3200 - 1e-8);
    expect(view.height / target.zoom).toBeGreaterThanOrEqual(1800 - 1e-8);
    expect(target.zoom).toBeCloseTo(602 / 1800, 8);
  });
});

describe('cameraTarget', () => {
  it('places the active seat centre, clamped inward at the world edge', () => {
    const state = gameFor('camera-centre');
    const player = state.players[state.turnSeat]!;
    const space = state.board.spaces.find((candidate) => candidate.id === player.pos)!;
    const target = cameraTarget(state);
    // One map, one scale: no Phaser bounds, the shared centre clamps so the
    // whole safe view stays over the authored map (seed 'camera-centre' starts
    // the hero at the western edge, x=470).
    const halfWidth = VIEW.width / (2 * target.zoom);
    expect(target.x).toBe(Math.min(WORLD.width - halfWidth, Math.max(halfWidth, space.x)));
    expect(target.y).toBe(space.y);
  });

  it('clamps the follow centre so the safe view stays inside the authored map', () => {
    const state = gameFor('camera-clamp');
    const corner = state.board.spaces.reduce((west, space) => (space.x < west.x ? space : west));
    state.players[state.turnSeat]!.pos = corner.id;
    const view = { width: 1088, height: 602 };
    const target = cameraTarget(state, false, view);
    const halfWidth = view.width / (2 * target.zoom);
    expect(target.x, 'western clamp keeps the safe view over painted map').toBe(
      Math.min(WORLD.width - halfWidth, Math.max(halfWidth, corner.x)),
    );
    expect(target.x).toBeGreaterThan(corner.x);
    expect(target.y).toBe(
      Math.min(
        WORLD.height - view.height / (2 * target.zoom),
        Math.max(view.height / (2 * target.zoom), corner.y),
      ),
    );
  });

  it('leaves a hero away from the edges exactly at the safe-rect centre', () => {
    const state = gameFor('camera-centre-safe');
    const centre = state.board.spaces.reduce((best, space) =>
      Math.hypot(space.x - WORLD.width / 2, space.y - WORLD.height / 2) <
      Math.hypot(best.x - WORLD.width / 2, best.y - WORLD.height / 2)
        ? space
        : best,
    );
    state.players[state.turnSeat]!.pos = centre.id;
    const target = cameraTarget(state, false, { width: 1088, height: 602 });
    expect(target.x).toBe(centre.x);
    expect(target.y).toBe(centre.y);
  });

  it('zooms so about seven spaces span the 1280 px logical canvas', () => {
    const target = cameraTarget(gameFor('camera-zoom'));
    // Mean authored edge length across ALL undirected edges (Review 7c: the
    // old zoom loop averaged only a third of them).
    let total = 0;
    let count = 0;
    const seen = new Set<string>();
    for (const node of MAP.nodes)
      for (const next of node.next) {
        const other = MAP.nodes[next]!;
        const key = node.id < other.id ? `${node.id}-${other.id}` : `${other.id}-${node.id}`;
        if (node.id !== other.id && seen.has(key)) continue;
        if (node.id !== other.id) seen.add(key);
        total += Math.hypot(other.x - node.x, other.y - node.y);
        count += 1;
      }
    const mean = total / count;
    expect(count).toBe(42);
    expect(target.zoom).toBeCloseTo(1280 / (mean * 7), 2);
    expect(target.zoom).toBeGreaterThan(0);
  });

  it('keeps 96 px tiles at ≥ 48 CSS px on a 915x412 viewport (Review 7c)', async () => {
    const { tilePxAt } = await import('../../src/scenes/board/camera');
    expect(tilePxAt(915, 412)).toBeGreaterThanOrEqual(48);
    expect(tilePxAt(1280, 720)).toBeGreaterThanOrEqual(48);
  });

  it('whole-map zoom fits the full 3200x1800 world', () => {
    const target = cameraTarget(gameFor('camera-whole'), true);
    expect(target.x).toBe(WORLD.width / 2);
    expect(target.y).toBe(WORLD.height / 2);
    expect(target.zoom).toBeCloseTo(zoomForSpan(WORLD.width, WORLD.height), 6);
    expect(target.zoom).toBeLessThan(cameraTarget(gameFor('camera-whole')).zoom);
  });

  it.each([
    { width: 1599, height: 720 }, // EXPAND at 915x412
    { width: 1729, height: 720 }, // EXPAND at 932x388
    { width: 1280, height: 720 },
  ])('fits the complete world without cropping gameplay at $width logical px', (view) => {
    const target = cameraTarget(gameFor('camera-wide'), true, view);
    expect(view.width / target.zoom).toBeGreaterThanOrEqual(WORLD.width - 1e-8);
    expect(view.height / target.zoom).toBeGreaterThanOrEqual(WORLD.height - 1e-8);
    expect(target.zoom).toBeLessThan(cameraTarget(gameFor('camera-wide'), false, view).zoom);
  });

  it('returns duration 0 at speed 0', () => {
    window.diceBanditsSpeed = 0;
    expect(cameraTarget(gameFor('camera-speed')).duration).toBe(0);
  });

  it('returns duration 0 under prefers-reduced-motion', () => {
    reducedMotion.mockReturnValue(true);
    expect(cameraTarget(gameFor('camera-reduced')).duration).toBe(0);
  });

  it('eases at the configured speed otherwise', () => {
    window.diceBanditsSpeed = 0.5;
    const target = cameraTarget(gameFor('camera-ease'));
    expect(target.duration).toBeGreaterThan(0);
    expect(target.duration).toBe(Math.round(600 * 0.5));
  });
});

describe('paintedBounds', () => {
  it('covers the authored world plus a full canvas of mirrored gutters', () => {
    const view = { width: 1280, height: 720 };
    const zoom = cameraTarget(gameFor('painted-envelope'), true, { width: 1088, height: 602 }).zoom;
    const bounds = paintedBounds(view, zoom);
    expect(bounds.width).toBeGreaterThanOrEqual(WORLD.width + view.width / zoom - 1e-6);
    expect(bounds.height).toBeGreaterThanOrEqual(WORLD.height + view.height / zoom - 1e-6);
    expect(bounds.x).toBeCloseTo((WORLD.width - bounds.width) / 2, 6);
    expect(bounds.y).toBeCloseTo((WORLD.height - bounds.height) / 2, 6);
  });

  it('covers a follow view clamped to the western edge', () => {
    const view = { width: 1088, height: 602 };
    const zoom = cameraTarget(gameFor('painted-follow')).zoom;
    const bounds = paintedBounds(view, zoom);
    const centre = followCentre({ x: 0, y: WORLD.height / 2 }, view, zoom);
    expect(centre.x - view.width / (2 * zoom)).toBeGreaterThanOrEqual(bounds.x - 1e-6);
    expect(bounds.x).toBeLessThanOrEqual(0);
  });
});
