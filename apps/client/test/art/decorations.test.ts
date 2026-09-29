import { createGame, type GameState } from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import {
  placeAmbients,
  placeDecorations,
  roadSegmentsFor,
  segmentDistance,
} from '../../src/art/decorations';
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

function viewFor(state: GameState) {
  const layout = boardLayout(state.board.spaces, CANVAS);
  return { width: CANVAS.width, height: CANVAS.height, toScreen: layout.toScreen };
}

const seeds = ['a', 'b', 'c'] as const;
const games = Object.fromEntries(seeds.map((seed) => [seed, gameFor(seed)]));

describe('placeDecorations', () => {
  it('is deterministic for a given seed', () => {
    for (const seed of seeds) {
      const state = games[seed]!;
      const view = viewFor(state);
      expect(placeDecorations(state.board.spaces, seed, view)).toEqual(
        placeDecorations(state.board.spaces, seed, view),
      );
    }
  });

  it('differs between seeds', () => {
    const state = games.a!;
    const view = viewFor(state);
    expect(placeDecorations(state.board.spaces, 'a', view)).not.toEqual(
      placeDecorations(state.board.spaces, 'zz', view),
    );
  });

  it('keeps every prop at least 14 px from space centres and road segments', () => {
    for (const seed of seeds) {
      const state = games[seed]!;
      const view = viewFor(state);
      const centres = state.board.spaces.map((space) => view.toScreen(space.x, space.y));
      const segments = roadSegmentsFor(state.board.spaces, view);
      for (const prop of placeDecorations(state.board.spaces, seed, view)) {
        for (const centre of centres) {
          expect(Math.hypot(prop.x - centre.x, prop.y - centre.y)).toBeGreaterThanOrEqual(14);
        }
        for (const segment of segments) {
          expect(segmentDistance(prop, segment.a, segment.b)).toBeGreaterThanOrEqual(14);
        }
      }
    }
  });

  it('keeps each bottom-anchored 32x32 prop sprite off every space tile', () => {
    for (const seed of seeds) {
      const state = games[seed]!;
      const view = viewFor(state);
      const centres = state.board.spaces.map((space) => view.toScreen(space.x, space.y));
      for (const prop of placeDecorations(state.board.spaces, seed, view)) {
        for (const centre of centres) {
          const coversTile =
            centre.x > prop.x - 16 - 12 &&
            centre.x < prop.x + 16 + 12 &&
            centre.y > prop.y - 32 - 12 &&
            centre.y < prop.y + 12;
          expect(coversTile).toBe(false);
        }
      }
    }
  });

  it('places props inside the 640x360 canvas', () => {
    for (const seed of seeds) {
      const state = games[seed]!;
      const view = viewFor(state);
      for (const prop of placeDecorations(state.board.spaces, seed, view)) {
        expect(prop.x).toBeGreaterThanOrEqual(0);
        expect(prop.x).toBeLessThanOrEqual(CANVAS.width);
        expect(prop.y).toBeGreaterThanOrEqual(0);
        expect(prop.y).toBeLessThanOrEqual(CANVAS.height);
      }
    }
  });

  it('places between 12 and 60 props on real boards', () => {
    for (const seed of seeds) {
      const state = games[seed]!;
      const view = viewFor(state);
      const placed = placeDecorations(state.board.spaces, seed, view);
      expect(placed.length).toBeGreaterThanOrEqual(12);
      expect(placed.length).toBeLessThanOrEqual(60);
    }
  });

  it('assigns each prop the region of the nearest space', () => {
    const state = games.a!;
    const view = viewFor(state);
    const centres = state.board.spaces.map((space) => ({
      point: view.toScreen(space.x, space.y),
      region: space.region,
    }));
    for (const prop of placeDecorations(state.board.spaces, 'a', view)) {
      const nearest = centres.reduce((best, candidate) =>
        Math.hypot(candidate.point.x - prop.x, candidate.point.y - prop.y) <
        Math.hypot(best.point.x - prop.x, best.point.y - prop.y)
          ? candidate
          : best,
      );
      expect(prop.region).toBe(nearest.region);
    }
  });

  it('keeps props and ambients out of excluded HUD rectangles', () => {
    const insideHud = (point: { x: number; y: number }): boolean =>
      HUD_RECTS.some(
        (rect) =>
          point.x >= rect.x &&
          point.x <= rect.x + rect.width &&
          point.y >= rect.y &&
          point.y <= rect.y + rect.height,
      );
    for (const seed of seeds) {
      const state = games[seed]!;
      const view = { ...viewFor(state), avoid: HUD_RECTS };
      for (const prop of placeDecorations(state.board.spaces, seed, view)) {
        expect(insideHud(prop)).toBe(false);
      }
      for (const ambient of placeAmbients(state.board.spaces, seed, view)) {
        expect(insideHud(ambient)).toBe(false);
      }
    }
  });
});

describe('roadSegmentsFor', () => {
  it('draws every next edge once, including edges that point back to a lower id', () => {
    const identity = { width: 640, height: 360, toScreen: (x: number, y: number) => ({ x, y }) };
    const spaces = [
      { id: 0, x: 0, y: 0, region: 'meadow' as const, next: [1] },
      { id: 1, x: 10, y: 0, region: 'meadow' as const, next: [2] },
      { id: 2, x: 10, y: 10, region: 'meadow' as const, next: [0, 1] },
    ];
    const keys = roadSegmentsFor(spaces, identity)
      .map(({ a, b }) => [`${a.x},${a.y}`, `${b.x},${b.y}`].sort().join('-'))
      .sort();
    expect(keys).toEqual(['0,0-10,0', '0,0-10,10', '10,0-10,10']);
  });

  it('connects every space of a real board to the road', () => {
    for (const seed of seeds) {
      const state = games[seed]!;
      const view = viewFor(state);
      const segments = roadSegmentsFor(state.board.spaces, view);
      for (const space of state.board.spaces) {
        const point = view.toScreen(space.x, space.y);
        const touches = segments.some(
          ({ a, b }) =>
            (a.x === point.x && a.y === point.y) || (b.x === point.x && b.y === point.y),
        );
        expect(touches).toBe(true);
      }
    }
  });
});

describe('placeAmbients', () => {
  it('is deterministic and covers each visible region with 1-3 sprites', () => {
    for (const seed of seeds) {
      const state = games[seed]!;
      const view = viewFor(state);
      const first = placeAmbients(state.board.spaces, seed, view);
      expect(first).toEqual(placeAmbients(state.board.spaces, seed, view));
      const regions = new Set(state.board.spaces.map((space) => space.region));
      const counts = new Map<string, number>();
      for (const ambient of first) {
        expect(regions.has(ambient.region)).toBe(true);
        counts.set(ambient.region, (counts.get(ambient.region) ?? 0) + 1);
      }
      for (const region of regions) {
        const count = counts.get(region) ?? 0;
        expect(count).toBeGreaterThanOrEqual(1);
        expect(count).toBeLessThanOrEqual(3);
      }
    }
  });

  it('keeps ambient sprites well clear of spaces, roads and each other', () => {
    for (const seed of seeds) {
      const state = games[seed]!;
      const view = viewFor(state);
      const centres = state.board.spaces.map((space) => view.toScreen(space.x, space.y));
      const segments = roadSegmentsFor(state.board.spaces, view);
      const placed = placeAmbients(state.board.spaces, seed, view);
      for (const ambient of placed) {
        for (const centre of centres) {
          expect(Math.hypot(ambient.x - centre.x, ambient.y - centre.y)).toBeGreaterThanOrEqual(20);
        }
        for (const segment of segments) {
          expect(segmentDistance(ambient, segment.a, segment.b)).toBeGreaterThanOrEqual(20);
        }
      }
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          expect(
            Math.hypot(placed[i]!.x - placed[j]!.x, placed[i]!.y - placed[j]!.y),
          ).toBeGreaterThanOrEqual(26);
        }
      }
    }
  });
});
