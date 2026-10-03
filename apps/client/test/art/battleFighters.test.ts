import { createGame } from '@dice-bandits/engine';
import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { ART } from '../../src/art/manifest';
import { poseFor, puppetTweens } from '../../src/art/puppet';
import { puppetOptions } from '../../src/art/motion';
import { drawFighters, fighterAtlas, playMotionForTest } from '../../src/scenes/battle/fighters';
import { battleLayout } from '../../src/scenes/battle/layout';

/**
 * Task 8 RED: cartoon fighters. Player faces right, opponent faces left,
 * fighters render named poses from the cartoon `art:` atlases through the
 * Task 7 puppet interface, at 280 px tall on the 1280×720 canvas.
 */

const state = createGame({
  seed: 'battle-fighters',
  rounds: 12,
  seats: [
    { name: 'Hero', classId: 'knight', control: 'human', personality: null },
    { name: 'Other', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
});

function battlePhaseState(monsterId: string) {
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
        level: 1,
        hp: player.hp,
        stats: player.stats,
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
      b: {
        kind: 'monster',
        seat: null,
        monsterId,
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

function spriteStub() {
  const sprite = {
    setOrigin: vi.fn(),
    setScale: vi.fn(),
    setFlipX: vi.fn(),
    setDepth: vi.fn(),
    setDisplaySize: vi.fn(),
    setFrame: vi.fn(),
    setAlpha: vi.fn(),
    setTint: vi.fn(),
    clearTint: vi.fn(),
    texture: { key: 'probe', has: () => false } as {
      key: string;
      has: (pose: string) => boolean;
    },
  };
  for (const key of [
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
    sprite[key].mockReturnValue(sprite);
  return sprite;
}

/**
 * Fake texture entry: `has` answers pose presence (both the test fakes and
 * real Phaser satisfy this contract), `get` returns the frame's real pixel
 * size so the uniform-scale math can be pinned against real atlas data.
 */
function fakeTexture(key: string, present: boolean) {
  return {
    key,
    has: () => present,
    get: (pose: string) => ({
      // Thief idle cell is 168×280, its hurt cell 265 px tall in
      // public/art/hero-thief.json; mushroomBonk idle is 330×274.
      realHeight: pose === 'idle' ? 280 : 265,
      height: pose === 'idle' ? 280 : 265,
    }),
  };
}

function fightersScene(textures: string[]) {
  const sprites: ReturnType<typeof spriteStub>[] = [];
  const tweens: object[] = [];
  const scene = {
    textures: {
      exists: (key: string) => textures.includes(key),
      get: (key: string) => fakeTexture(key, textures.includes(key)),
    },
    tweens: {
      add: vi.fn((spec: object) => {
        tweens.push(spec);
        return spec;
      }),
    },
    add: {
      sprite: vi.fn((_x: number, _y: number, key: string) => {
        const s = spriteStub();
        s.texture = fakeTexture(key, textures.includes(key));
        sprites.push(s);
        return s;
      }),
      text: vi.fn(() => ({
        setOrigin: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(),
      })),
    },
  };
  return { scene, sprites, tweens };
}

describe('cartoon battle fighters (Task 8)', () => {
  it('resolves the player hero to its cartoon atlas key', () => {
    expect(fighterAtlas(state, { kind: 'player', seat: 0, monsterId: null })).toBe(
      ART.heroes.knight,
    );
  });

  it('resolves each engine monster to its own cartoon atlas key', () => {
    expect(fighterAtlas(state, { kind: 'monster', seat: null, monsterId: 'jellyBun' })).toBe(
      ART.monsters.jellyBun,
    );
    expect(fighterAtlas(state, { kind: 'monster', seat: null, monsterId: 'lavaImp' })).toBe(
      ART.monsters.lavaImp,
    );
  });

  it('draws the hero facing right (no flip) and the monster facing left (flipX)', () => {
    const { scene, sprites } = fightersScene([ART.heroes.knight, ART.monsters.jellyBun]);
    drawFighters(scene as unknown as Phaser.Scene, battlePhaseState('jellyBun'), battleLayout());
    expect(sprites[0]!.setFlipX).toHaveBeenCalledWith(false);
    expect(sprites[1]!.setFlipX).toHaveBeenCalledWith(true);
  });

  it('renders both fighters 280 px tall via one uniform scale per atlas aspect', () => {
    const { scene, sprites } = fightersScene([ART.heroes.thief, ART.monsters.mushroomBonk]);
    drawFighters(
      scene as unknown as Phaser.Scene,
      battlePhaseState('mushroomBonk'),
      battleLayout(1280, 720),
    );
    // One uniform scale per fighter from the idle cell's real pixel height
    // (reviewer item 1): the fake thief idle cell is 280 px tall → scale 1;
    // a 274 px cell would get 280/274. Widths keep the cell's own aspect
    // instead of a forced 210×280 box.
    expect(sprites[0]!.setScale).toHaveBeenCalledWith(1);
    expect(sprites[1]!.setScale).toHaveBeenCalledWith(1);
    expect(sprites[0]!.setDisplaySize).not.toHaveBeenCalled();
    expect(sprites[1]!.setDisplaySize).not.toHaveBeenCalled();
  });

  it('writes puppet tween scales as absolute base*relative values (reviewer item 2)', () => {
    // Base scale 280/274 for a 274 px idle cell; the idle breathe spec is
    // scaleY 1.03 / scaleX 0.99 RELATIVE to that base (puppet.ts header).
    // Phaser gets absolute numbers: scaleY ≈ base*1.03, never the raw 1.03.
    const fakeTexture = (key: string, present: boolean) => ({
      key,
      has: () => present,
      get: (pose: string) => ({ realHeight: pose === 'idle' ? 274 : 265, height: 274 }),
    });
    const spriteStub = () => {
      const sprite = {
        setOrigin: vi.fn(),
        setScale: vi.fn(),
        setFlipX: vi.fn(),
        setDepth: vi.fn(),
        setDisplaySize: vi.fn(),
        setFrame: vi.fn(),
        setAlpha: vi.fn(),
        setTint: vi.fn(),
        clearTint: vi.fn(),
        // Real-sprite fields the tween conversion reads:
        x: 340,
        y: 660,
        angle: 0,
        flipX: false,
        scaleX: 280 / 274,
        scaleY: 280 / 274,
        scale: 280 / 274,
        texture: fakeTexture('k', true),
      } as unknown as Phaser.GameObjects.Sprite & Record<string, unknown>;
      for (const key of [
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
        (sprite as never as Record<string, ReturnType<typeof vi.fn>>)[key]!.mockReturnValue(sprite);
      return sprite;
    };
    const tweens: Array<Record<string, unknown>> = [];
    const scene = {
      textures: { exists: () => true, get: (key: string) => fakeTexture(key, true) },
      tweens: {
        add: vi.fn((spec: Record<string, unknown>) => {
          tweens.push(spec);
          return spec;
        }),
      },
      add: {
        sprite: vi.fn(() => spriteStub()),
        text: vi.fn(() => ({
          setOrigin: vi.fn().mockReturnThis(),
          setDepth: vi.fn().mockReturnThis(),
        })),
      },
    } as unknown as Phaser.Scene;
    drawFighters(
      scene as unknown as Phaser.Scene,
      battlePhaseState('mushroomBonk'),
      battleLayout(1280, 720),
    );
    const base = 280 / 274;
    const idle = tweens.find((spec) => typeof spec.scaleY === 'number');
    expect(idle, 'idle breathe tween mounted').toBeDefined();
    expect(idle!.scaleY).toBeCloseTo(base * 1.03, 5);
    expect(idle!.scaleX).toBeCloseTo(base * 0.99, 5);
    expect(idle!.scaleY).not.toBe(1.03);
  });

  it('mirrors x offsets and adds them to the home pose for the flipped side', () => {
    // hurt's first x step is -10 relative; playMotion must convert it to an
    // absolute x = home + offset (mirrored for the flipped side), never the
    // raw offset (which would teleport the sprite to x≈-10).
    const fakeTexture = (key: string, present: boolean) => ({
      key,
      has: () => present,
      get: () => ({ realHeight: 280, height: 280 }),
    });
    const makeSprite = (homeX: number, flip: boolean) => {
      const sprite = {
        setOrigin: vi.fn(),
        setScale: vi.fn(),
        setFlipX: vi.fn(),
        setDepth: vi.fn(),
        setDisplaySize: vi.fn(),
        setFrame: vi.fn(),
        setAlpha: vi.fn(),
        setTint: vi.fn(),
        clearTint: vi.fn(),
        x: homeX,
        y: 660,
        angle: 0,
        flipX: flip,
        scaleX: 1,
        scaleY: 1,
        scale: 1,
        texture: fakeTexture('k', true),
      } as unknown as Phaser.GameObjects.Sprite & Record<string, unknown>;
      for (const key of [
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
        (sprite as never as Record<string, ReturnType<typeof vi.fn>>)[key]!.mockReturnValue(sprite);
      return sprite;
    };
    const tweens: Array<Record<string, unknown>> = [];
    const scene = {
      textures: { exists: () => true, get: (key: string) => fakeTexture(key, true) },
      tweens: {
        add: vi.fn((spec: Record<string, unknown>) => {
          tweens.push(spec);
          return spec;
        }),
      },
      add: { sprite: vi.fn(), text: vi.fn() },
    } as unknown as Phaser.Scene;
    // Left side (facing right): -10 offset from home x=340 → tween to 330.
    // The chain mounts step 0 (the tint flash) first; x steps appear only
    // after its onComplete fires, so drive the chain forward by hand.
    playMotionForTest(
      scene,
      makeSprite(340, false) as unknown as Phaser.GameObjects.Sprite,
      'hurt',
    );
    for (let step = 0; step < 5; step += 1) {
      const current = tweens[tweens.length - 1];
      const complete = current?.onComplete as (() => void) | undefined;
      complete?.();
    }
    const leftHurt = tweens.find((spec) => typeof spec.x === 'number');
    expect(leftHurt, 'hurt tween mounts an x step on the left fighter').toBeDefined();
    expect(leftHurt!.x).toBe(330);
    // Right side (flipped): the same -10 offset mirrors to +10 from home
    // x=940 → tween to 950, lunging away from the centre like the spec says.
    tweens.length = 0;
    playMotionForTest(scene, makeSprite(940, true) as unknown as Phaser.GameObjects.Sprite, 'hurt');
    for (let step = 0; step < 5; step += 1) {
      const current = tweens[tweens.length - 1];
      const complete = current?.onComplete as (() => void) | undefined;
      complete?.();
    }
    const rightHurt = tweens.find((spec) => typeof spec.x === 'number');
    expect(rightHurt, 'hurt tween mounts an x step on the flipped fighter').toBeDefined();
    expect(rightHurt!.x).toBe(950);
  });

  it('stands fighters on their idle pose from the named-frame atlas', () => {
    const { scene, sprites } = fightersScene([ART.heroes.knight, ART.monsters.jellyBun]);
    drawFighters(scene as unknown as Phaser.Scene, battlePhaseState('jellyBun'), battleLayout());
    expect(sprites[0]!.setFrame).toHaveBeenCalledWith('idle');
    expect(sprites[1]!.setFrame).toHaveBeenCalledWith('idle');
  });

  it('falls back to a flat colour sprite without a crash when the atlas is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { scene, sprites } = fightersScene([]);
    expect(() =>
      drawFighters(scene as unknown as Phaser.Scene, battlePhaseState('jellyBun'), battleLayout()),
    ).not.toThrow();
    expect(sprites.length).toBe(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('puppet motion consumed by the battle fighters (Task 7 interface)', () => {
  it('maps the battle motions onto atlas poses through poseFor', () => {
    expect(poseFor('idle')).toBe('idle');
    expect(poseFor('attack')).toBe('attack');
    expect(poseFor('hurt')).toBe('hurt');
  });

  it('speed 0 collapses every tween to duration 0 (instant motion)', () => {
    for (const motion of ['attack', 'hurt', 'idle'] as const) {
      for (const step of puppetTweens(motion, { speed: 0, reduced: false })) {
        expect(step.duration).toBe(0);
      }
    }
  });

  it('puppetOptions mirrors the ?speed=0 / reduced-motion policy', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(puppetOptions().reduced).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('motion restart safety (review round 2, item 3)', () => {
  /**
   * Battle motions chain back-to-back on one sprite (attack → hurt → idle).
   * Two hazards are pinned here:
   * - base scale must be the drawFighters mount scale (WeakMap), NOT the
   *   mid-tween `sprite.scale` — a running idle breathe tween drags
   *   sprite.scale to base*1.03 and the old baseScale() read compounds it;
   * - every new motion must killTweensOf(sprite) first so stale chains
   *   cannot fight the fresh one.
   */

  /** Sprite fields as playMotion's conversion reads them. */
  type Body = Phaser.GameObjects.Sprite & {
    scaleX: number;
    scaleY: number;
    scale: number;
    setFrame: ReturnType<typeof vi.fn>;
  };

  type TweenSpec = Record<string, unknown> & { scaleX?: number; scaleY?: number };

  function makeSprite(base: number, flip: boolean) {
    const texture = {
      key: 'k',
      has: () => true,
      get: () => ({ realHeight: 280, height: 280 }),
    };
    const sprite = {
      setOrigin: vi.fn(),
      setScale: vi.fn(),
      setFlipX: vi.fn(),
      setDepth: vi.fn(),
      setDisplaySize: vi.fn(),
      setFrame: vi.fn(),
      setAlpha: vi.fn(),
      setTint: vi.fn(),
      clearTint: vi.fn(),
      x: 340,
      y: 660,
      angle: 0,
      flipX: flip,
      scaleX: base,
      scaleY: base,
      scale: base,
      texture,
    } as unknown as Body;
    for (const key of [
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
      (sprite as unknown as Record<string, ReturnType<typeof vi.fn>>)[key]!.mockReturnValue(sprite);
    return sprite;
  }

  function killScene() {
    const tweens: Array<Record<string, unknown>> = [];
    const killed: unknown[] = [];
    const scene = {
      textures: {
        exists: () => true,
        get: () => ({ has: () => true, get: () => ({ realHeight: 280, height: 280 }) }),
      },
      tweens: {
        add: vi.fn((spec: Record<string, unknown>) => {
          tweens.push(spec);
          return spec;
        }),
        killTweensOf: vi.fn((target: unknown) => {
          killed.push(target);
        }),
      },
      add: { sprite: vi.fn(), text: vi.fn() },
    } as unknown as Phaser.Scene;
    return { scene, tweens, killed };
  }

  it('base scale comes from the mount scale, not a mid-tween sprite.scale', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { scene, sprites, tweens } = fightersScene([
      ART.heroes.thief,
      ART.monsters.mushroomBonk,
    ]);
    drawFighters(
      scene as unknown as Phaser.Scene,
      battlePhaseState('mushroomBonk'),
      battleLayout(1280, 720),
    );
    const fighter = sprites[0] as unknown as Body;
    // The fightersScene fake's idle cell is 280 px → mount scale 1.
    const mount = 1;
    expect(fighter.setScale).toHaveBeenCalledWith(mount);
    // Mid-flight idle breathe: sprite.scale no longer equals the mount scale.
    fighter.scaleX = mount * 1.03;
    fighter.scaleY = mount * 1.03;
    fighter.scale = mount * 1.03;
    const before = tweens.length;
    playMotionForTest(scene as unknown as Phaser.Scene, fighter, 'attack');
    // attack step 0 carries both scales; only look at freshly mounted specs
    // (the pre-existing idle breathe tween also has scale numbers).
    const attack = (tweens as unknown as TweenSpec[])
      .slice(before)
      .find((spec) => typeof spec.scaleX === 'number' && typeof spec.scaleY === 'number');
    // attack's wind-up squash must multiply the MOUNT scale (1), not the
    // mid-tween sprite.scale (1.03): scaleY ≈ 1.06, never 1.03*1.06.
    expect(attack, 'attack mounts its scale step').toBeDefined();
    expect(attack!.scaleY).toBeCloseTo(mount * 1.06, 5);
    expect(attack!.scaleY).not.toBeCloseTo(mount * 1.03 * 1.06, 5);
    expect(attack!.scaleX).toBeCloseTo(mount * 0.94, 5);
    vi.unstubAllGlobals();
  });

  it('restarts a motion with killTweensOf before mounting the fresh chain', () => {
    const { scene, tweens, killed } = killScene();
    const sprite = makeSprite(1, false);
    playMotionForTest(scene, sprite, 'hurt');
    expect(killed.length, 'stale tweens killed before the new chain').toBeGreaterThan(0);
    expect(killed).toContain(sprite);
    expect(tweens.length, 'fresh chain still mounts').toBeGreaterThan(0);
    // Every chain step re-kills before adding, so a mid-chain restart cannot
    // leave both chains running.
    const adds = (scene.tweens as unknown as { add: ReturnType<typeof vi.fn> }).add;
    expect(adds.mock.calls.length).toBe(killed.length);
  });
});
