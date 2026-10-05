import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { data, type ClassId, type Region } from '@dice-bandits/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fakeConfig } = vi.hoisted(() => ({ fakeConfig: vi.fn() }));

vi.mock('phaser', () => ({
  default: {
    Game: class {
      constructor(config: unknown) {
        fakeConfig(config);
      }
    },
    AUTO: 0,
    CANVAS: 1,
    Scale: { FIT: 0, CENTER_BOTH: 0 },
  },
}));
vi.mock('../../src/scenes/BootScene', () => ({ default: class BootScene {} }));
vi.mock('../../src/scenes/BoardScene', () => ({ default: class BoardScene {} }));
vi.mock('../../src/scenes/BattleScene', () => ({ default: class BattleScene {} }));

const { ART, ART_ATLASES, HERO_POSES, MONSTER_POSES } = await import('../../src/art/manifest');
const { createGame } = await import('../../src/game');

const CLASSES: ClassId[] = ['knight', 'thief', 'mage', 'cleric'];
const REGIONS: Region[] = ['meadow', 'desert', 'snow', 'volcano'];

/** Pose names declared in a cartoon atlas JSON (named-frame format). */
function atlasPoses(name: string): string[] {
  const raw = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../public/art', `${name}.json`), 'utf8'),
  ) as { frames?: Record<string, unknown> };
  if (!raw.frames || typeof raw.frames !== 'object' || Array.isArray(raw.frames)) return [];
  return Object.keys(raw.frames);
}

describe('ART manifest', () => {
  it('maps every engine class to a hero atlas', () => {
    const classes = Object.keys(data.CLASSES) as ClassId[];
    expect(classes).toEqual(CLASSES);
    for (const classId of classes) {
      expect(ART.heroes[classId], `hero atlas for ${classId}`).toBe(`art:hero-${classId}`);
    }
  });

  it('maps every engine monster to its own cartoon atlas', () => {
    const monsters: Record<string, string> = ART.monsters;
    for (const monsterId of Object.keys(data.MONSTERS)) {
      expect(monsters[monsterId], `monster atlas for ${monsterId}`).toBe(
        `art:monster-${monsterId}`,
      );
    }
  });

  it('exposes tiles, buildings, icons and ui atlas keys', () => {
    expect(ART.tiles).toBe('art:tiles');
    expect(ART.buildings).toBe('art:buildings');
    expect(ART.icons).toBe('art:icons');
    expect(ART.ui).toBe('art:ui');
  });

  it('maps every region to a backdrop atlas key', () => {
    for (const region of REGIONS) {
      expect(ART.backdrops[region]).toBe(`art:backdrop-${region}`);
    }
  });

  it('describes the 5x3 map-tile grid of 640x600 tiles', () => {
    expect(ART.mapTiles).toEqual({ cols: 5, rows: 3, tile: [640, 600] });
  });

  it('declares every hero pose in the hero atlas JSONs', () => {
    expect([...HERO_POSES]).toEqual(['idle', 'attack', 'hurt', 'happy', 'sad', 'portrait']);
    for (const classId of CLASSES) {
      const poses = atlasPoses(`hero-${classId}`);
      for (const pose of HERO_POSES) {
        expect(poses, `hero-${classId} declares pose ${pose}`).toContain(pose);
      }
    }
  });

  it('declares every monster pose in the monster atlas JSONs', () => {
    expect([...MONSTER_POSES]).toEqual(['idle', 'attack', 'hurt']);
    for (const monsterId of Object.keys(data.MONSTERS)) {
      const poses = atlasPoses(`monster-${monsterId}`);
      for (const pose of MONSTER_POSES) {
        expect(poses, `monster-${monsterId} declares pose ${pose}`).toContain(pose);
      }
    }
  });

  it('lists every shipped public/art atlas in its loader set', () => {
    const shipped = readdirSync(resolve(import.meta.dirname, '../../public/art'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/, ''))
      .sort();
    expect([...ART_ATLASES].sort()).toEqual(shipped);
    const loaded = new Set(ART_ATLASES);
    for (const key of [
      ...Object.values(ART.heroes),
      ...Object.values(ART.monsters),
      ART.tiles,
      ART.buildings,
      ART.icons,
      ART.ui,
      ...Object.values(ART.backdrops),
    ]) {
      expect(loaded, `ART key ${key} is scheduled for loading`).toContain(key.replace(/^art:/, ''));
    }
  });
});

describe('createGame', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    fakeConfig.mockClear();
    document.body.innerHTML = '<div id="app"><div id="phaser-board"></div></div>';
    createGame('phaser-board');
  });

  it('configures a 1280x720 smooth-rendered FIT canvas in the requested parent', () => {
    const config = capturedConfig();
    expect(config.width).toBe(1280);
    expect(config.height).toBe(720);
    expect(config.pixelArt).toBe(false);
    expect(config.roundPixels).toBe(false);
    // Smooth texture sampling is independent of expensive framebuffer MSAA.
    expect(config.render).toEqual({ antialias: true, antialiasGL: false });
    expect(config.parent).toBe('phaser-board');
    expect(config.scale).toEqual({ mode: 0, autoCenter: 0 });
  });

  it('falls back to Canvas instead of software WebGL when hardware contexts are refused', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    createGame('phaser-board');
    expect(capturedConfig().type).toBe(1);
    expect(getContext).toHaveBeenCalledWith('webgl2', { failIfMajorPerformanceCaveat: true });
    expect(getContext).toHaveBeenCalledWith('webgl', { failIfMajorPerformanceCaveat: true });
  });

  it('retains AUTO on hardware WebGL2 and releases the capability probe context', () => {
    const loseContext = vi.fn();
    const getExtension = vi.fn((name: string) =>
      name === 'WEBGL_lose_context' ? { loseContext } : null,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ getExtension } as never);
    createGame('phaser-board');
    expect(capturedConfig().type).toBe(0);
    expect(getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('keeps hardware WebGL1 available when WebGL2 is unsupported', () => {
    const loseContext = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
        getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null),
      } as never);
    createGame('phaser-board');
    expect(capturedConfig().type).toBe(0);
    expect(getContext).toHaveBeenCalledWith('webgl', { failIfMajorPerformanceCaveat: true });
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('falls back safely when context creation throws', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('WebGL unavailable');
    });
    expect(() => createGame('phaser-board')).not.toThrow();
    expect(capturedConfig().type).toBe(1);
  });

  it('rejects SwiftShader even when Chromium accepts the major-performance-caveat probe', () => {
    const loseContext = vi.fn();
    const getParameter = vi.fn(() => 'SwiftShader Device (Subzero)');
    const getExtension = vi.fn((name: string) =>
      name === 'WEBGL_debug_renderer_info'
        ? { UNMASKED_RENDERER_WEBGL: 37446 }
        : name === 'WEBGL_lose_context'
          ? { loseContext }
          : null,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension,
      getParameter,
    } as never);
    createGame('phaser-board');
    expect(capturedConfig().type).toBe(1);
    expect(getParameter).toHaveBeenCalledWith(37446);
    expect(loseContext).toHaveBeenCalledOnce();
  });
});

function capturedConfig(): Record<string, unknown> {
  const config = fakeConfig.mock.calls.at(-1)?.[0];
  if (!config) throw new Error('createGame did not construct a Phaser.Game');
  return config as Record<string, unknown>;
}
