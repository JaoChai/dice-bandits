import { createGame, type GameState } from '@dice-bandits/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { battleRegion } from '../../src/scenes/battle/backdrop';
import { drawFighters, fighterAtlas } from '../../src/scenes/battle/fighters';
import { ART } from '../../src/art/manifest';
import { battleLayout } from '../../src/scenes/battle/layout';

const state = createGame({
  seed: 'battle-art',
  rounds: 12,
  seats: [
    { name: 'Hero', classId: 'knight', control: 'human', personality: null },
    { name: 'Other', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
});

function battleState(): GameState {
  const battle = structuredClone(state);
  const player = battle.players[0]!;
  battle.phase = {
    kind: 'battle',
    battle: {
      context: 'monster',
      spaceId: player.pos,
      exchange: 1,
      half: 1,
      attackerSide: 'a',
      pending: { attack: null, defense: null },
      a: {
        kind: 'player',
        seat: 0,
        monsterId: null,
        level: player.level,
        hp: player.hp,
        stats: player.stats,
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
      b: {
        kind: 'monster',
        seat: null,
        monsterId: 'jellyBun',
        level: 1,
        hp: 20,
        stats: { atk: 3, def: 2, spd: 3, mag: 2, maxHp: 20 },
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
    },
  };
  return battle;
}

describe('battle art selection', () => {
  it('uses the battle space region rather than the current turn position', () => {
    const space = state.board.spaces.find((item) => item.region === 'desert')!;
    expect(battleRegion(state, space.id)).toBe('desert');
  });
  it('selects cartoon class and monster atlases for opposing fighters', () => {
    expect(fighterAtlas(state, { kind: 'player', seat: 0, monsterId: null })).toBe(
      ART.heroes.knight,
    );
    expect(fighterAtlas(state, { kind: 'monster', seat: null, monsterId: 'cactusPunch' })).toBe(
      ART.monsters.cactusPunch,
    );
  });
});

/**
 * Minimal fake scene for drawFighters: every fighter texture answers `idle`,
 * cells are 280 px tall (uniform scale 1), and `tweens.add` records each
 * mounted tween so the motion-policy tests can inspect what Phaser receives.
 */
function fightersScene() {
  const tweens: Array<Record<string, unknown>> = [];
  const fakeTexture = (key: string, present: boolean) => ({
    key,
    has: () => present,
    get: () => ({ realHeight: 280, height: 280 }),
  });
  const makeSprite = () => {
    const sprite = {
      x: 340,
      y: 660,
      angle: 0,
      flipX: false,
      scaleX: 1,
      scaleY: 1,
      scale: 1,
      texture: fakeTexture('k', true),
    } as unknown as Phaser.GameObjects.Sprite & Record<string, unknown>;
    for (const method of [
      'setOrigin',
      'setScale',
      'setFlipX',
      'setDepth',
      'setDisplaySize',
      'setFrame',
      'setAlpha',
      'setTint',
      'clearTint',
    ] as const)
      (sprite as never as Record<string, ReturnType<typeof vi.fn>>)[method] = vi
        .fn()
        .mockReturnValue(sprite);
    return sprite;
  };
  const scene = {
    textures: { exists: () => true, get: (key: string) => fakeTexture(key, true) },
    tweens: {
      add: vi.fn((spec: Record<string, unknown>) => {
        tweens.push(spec);
        return spec;
      }),
    },
    add: {
      sprite: vi.fn(() => makeSprite()),
      text: vi.fn(() => ({
        setOrigin: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(),
      })),
    },
  } as unknown as Phaser.Scene;
  return { scene, tweens };
}

describe('battle fighter motion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.diceBanditsSpeed = 1;
  });

  it('mounts idle tweens that never loop (repeat 0) under reduced motion', () => {
    // Reviewer item 5: the scene-side guard is `puppetOptions()` — drawFighters
    // must consult prefers-reduced-motion, collapsing the idle breathe loop to
    // repeat 0 instead of Phaser's infinite -1.
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { scene, tweens } = fightersScene();
    drawFighters(scene, battleState(), battleLayout());
    expect(tweens.length, 'idle breathe tweens mounted for both fighters').toBeGreaterThan(0);
    for (const tween of tweens) expect(tween.repeat).toBe(0);
  });

  it('collapses idle tweens to duration 0 at ?speed=0', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    window.diceBanditsSpeed = 0;
    const { scene, tweens } = fightersScene();
    drawFighters(scene, battleState(), battleLayout());
    expect(tweens.length, 'idle breathe tweens mounted for both fighters').toBeGreaterThan(0);
    for (const tween of tweens) expect(tween.duration).toBe(0);
  });
});
