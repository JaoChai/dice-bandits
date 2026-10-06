import { createGame, MAP, type GameState } from '@dice-bandits/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { reducedMotion } = vi.hoisted(() => ({ reducedMotion: vi.fn(() => false) }));

vi.mock('phaser', () => ({ default: { Scene: class Scene {} } }));
vi.mock('../../src/art/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/art/motion')>()),
  reducedMotion: vi.fn(() => reducedMotion()),
}));

const { cameraTarget, WORLD, zoomForSpan } = await import('../../src/scenes/board/camera');

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
});

describe('cameraTarget', () => {
  it('centres on the active seat token position', () => {
    const state = gameFor('camera-centre');
    const player = state.players[state.turnSeat]!;
    const space = state.board.spaces.find((candidate) => candidate.id === player.pos)!;
    const target = cameraTarget(state);
    expect(target.x).toBe(space.x);
    expect(target.y).toBe(space.y);
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
