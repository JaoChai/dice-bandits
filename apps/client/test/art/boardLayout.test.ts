import { createGame, type GameState, type Space } from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import { boardLayout, HUD_RECTS } from '../../src/scenes/board/layout';

const CANVAS = { width: 640, height: 360 };

function gameFor(seed: string): GameState {
  return createGame({
    seed,
    rounds: 12,
    seats: [
      { name: 'P1', classId: 'knight', control: 'human', personality: null },
      { name: 'P2', classId: 'thief', control: 'human', personality: null },
      { name: 'P3', classId: 'mage', control: 'human', personality: null },
      { name: 'P4', classId: 'cleric', control: 'human', personality: null },
    ],
  });
}

const seeds = ['a', 'b', 'c', 'desert-4', 'snow-7', 'volcano-3'] as const;

// Whole-map fit is interim until Task 6's follow camera (which owns HUD
// avoidance via the camera viewport); the M4 tile-vs-HUD geometry helpers
// were deleted with the integer grid fit.

describe('HUD_RECTS', () => {
  it('covers every DOM overlay measured at 1280x720 and 915x412', () => {
    const kinds = HUD_RECTS.map((rect) => rect.kind).sort();
    expect(kinds).toEqual(['banner', 'bl', 'br', 'tl', 'topline', 'tr', 'tray']);
    // The language/back row under the banner reaches y=83 at 915x412 and the
    // Roll tray starts at y=302 there; both covered tiles in the first cut.
    const topline = HUD_RECTS.find((rect) => rect.kind === 'topline')!;
    expect(topline.y + topline.height).toBeGreaterThanOrEqual(83);
    const tray = HUD_RECTS.find((rect) => rect.kind === 'tray')!;
    expect(tray.y).toBeLessThanOrEqual(302);
  });
});

describe('boardLayout', () => {
  // M5a: Space.x/y are authored map pixels and the whole-map view is an interim
  // linear fit until Task 6 replaces it with the follow camera. The old M4
  // integer-grid + HUD-avoidance passes only made sense for grid-unit
  // coordinates (the map's hand-tuned jitter breaks them), so they are gone.
  it('keeps every tile centre inside the canvas at integer coordinates', () => {
    for (const seed of seeds) {
      const { board } = gameFor(seed);
      const layout = boardLayout(board.spaces, CANVAS);
      for (const space of board.spaces) {
        const point = layout.toScreen(space.x, space.y);
        expect(Number.isInteger(point.x)).toBe(true);
        expect(Number.isInteger(point.y)).toBe(true);
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(CANVAS.width);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(CANVAS.height);
      }
    }
  });

  it('keeps every whole tile box inside the canvas', () => {
    for (const seed of seeds) {
      const { board } = gameFor(seed);
      const layout = boardLayout(board.spaces, CANVAS);
      const half = Math.min(8, layout.scale / 2);
      for (const space of board.spaces) {
        const point = layout.toScreen(space.x, space.y);
        expect(point.x - half).toBeGreaterThanOrEqual(0);
        expect(point.x + half).toBeLessThanOrEqual(CANVAS.width);
        expect(point.y - half).toBeGreaterThanOrEqual(0);
        expect(point.y + half).toBeLessThanOrEqual(CANVAS.height);
      }
    }
  });

  it('never stacks tiles: centre distance >= min clear radius', () => {
    for (const seed of seeds) {
      const { board } = gameFor(seed);
      const layout = boardLayout(board.spaces, CANVAS);
      const points: { x: number; y: number }[] = board.spaces.map((space) =>
        layout.toScreen(space.x, space.y),
      );
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const distance = Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y);
          // The tile fallback marker is 14 px wide; centres must not merge.
          expect(distance).toBeGreaterThanOrEqual(14);
        }
      }
    }
  });

  it('handles an empty space list without crashing', () => {
    const layout = boardLayout([], CANVAS);
    expect(layout.toScreen(0, 0)).toEqual({ x: 320, y: 180 });
  });
});

export type { Space };
