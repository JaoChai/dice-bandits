import { createGame, type GameState, type Space } from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import { boardLayout, HUD_RECTS, type HudRect } from '../../src/scenes/board/layout';

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

function tileHitsRect(point: { x: number; y: number }, half: number, rect: HudRect): boolean {
  return (
    point.x + half > rect.x &&
    point.x - half < rect.x + rect.width &&
    point.y + half > rect.y &&
    point.y - half < rect.y + rect.height
  );
}

/** Some integer vertical offset keeps every whole tile box clear of the HUD. */
function tileFits(spaces: Space[], tile: number): boolean {
  const xs = spaces.map((space) => space.x);
  const ys = spaces.map((space) => space.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const offsetX = Math.round((CANVAS.width - (Math.max(...xs) - minX) * tile) / 2);
  const spanY = (Math.max(...ys) - minY) * tile;
  for (let offsetY = 0; offsetY + spanY <= CANVAS.height; offsetY++) {
    const clear = spaces.every((space) => {
      const point = {
        x: offsetX + (space.x - minX) * tile,
        y: offsetY + (space.y - minY) * tile,
      };
      return (
        point.x - tile / 2 >= 0 &&
        point.x + tile / 2 <= CANVAS.width &&
        point.y - tile / 2 >= 0 &&
        point.y + tile / 2 <= CANVAS.height &&
        HUD_RECTS.every((rect) => !tileHitsRect(point, tile / 2, rect))
      );
    });
    if (clear) return true;
  }
  return false;
}

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
  it('returns an integer scale and keeps every whole tile inside the canvas', () => {
    for (const seed of seeds) {
      const { board } = gameFor(seed);
      const layout = boardLayout(board.spaces, CANVAS);
      expect(Number.isInteger(layout.scale)).toBe(true);
      expect(layout.scale).toBeGreaterThanOrEqual(16);
      for (const space of board.spaces) {
        const point = layout.toScreen(space.x, space.y);
        expect(Number.isInteger(point.x)).toBe(true);
        expect(Number.isInteger(point.y)).toBe(true);
        expect(point.x - layout.scale / 2).toBeGreaterThanOrEqual(0);
        expect(point.x + layout.scale / 2).toBeLessThanOrEqual(CANVAS.width);
        expect(point.y - layout.scale / 2).toBeGreaterThanOrEqual(0);
        expect(point.y + layout.scale / 2).toBeLessThanOrEqual(CANVAS.height);
      }
    }
  });

  it('keeps every whole tile box clear of every HUD rectangle', () => {
    for (const seed of seeds) {
      const { board } = gameFor(seed);
      const layout = boardLayout(board.spaces, CANVAS);
      for (const space of board.spaces) {
        const point = layout.toScreen(space.x, space.y);
        for (const rect of HUD_RECTS) {
          expect(tileHitsRect(point, layout.scale / 2, rect)).toBe(false);
        }
      }
    }
  });

  it('never stacks tiles: centre distance >= achieved scale', () => {
    for (const seed of seeds) {
      const { board } = gameFor(seed);
      const layout = boardLayout(board.spaces, CANVAS);
      const points: { x: number; y: number }[] = board.spaces.map((space) =>
        layout.toScreen(space.x, space.y),
      );
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const distance = Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y);
          expect(distance).toBeGreaterThanOrEqual(layout.scale);
        }
      }
    }
  });

  it('uses the largest tile size that still clears the HUD', () => {
    for (const seed of seeds) {
      const { board } = gameFor(seed);
      const chosen = boardLayout(board.spaces, CANVAS).scale;
      expect(tileFits(board.spaces, chosen)).toBe(true);
      for (let bigger = chosen + 1; bigger <= 24; bigger++) {
        expect(tileFits(board.spaces, bigger)).toBe(false);
      }
    }
  });

  it('handles an empty space list without crashing', () => {
    const layout = boardLayout([], CANVAS);
    expect(layout.toScreen(0, 0)).toEqual({ x: 320, y: 180 });
  });
});
