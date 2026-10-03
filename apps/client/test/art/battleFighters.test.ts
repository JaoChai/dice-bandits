import { createGame } from '@dice-bandits/engine';
import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { ART } from '../../src/art/manifest';
import { poseFor, puppetTweens } from '../../src/art/puppet';
import { puppetOptions } from '../../src/art/motion';
import { drawFighters, fighterAtlas } from '../../src/scenes/battle/fighters';
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
    texture: { key: 'probe', has: (_pose: string) => false } as {
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

function fightersScene(textures: string[]) {
  const sprites: ReturnType<typeof spriteStub>[] = [];
  const tweens: object[] = [];
  const scene = {
    textures: {
      exists: (key: string) => textures.includes(key),
      get: (key: string) => ({ has: (frame: string) => textures.includes(key) }),
    },
    tweens: {
      add: vi.fn((spec: object) => {
        tweens.push(spec);
        return spec;
      }),
    },
    add: {
      sprite: vi.fn((_x: number, _y: number, key: string, frame?: string) => {
        const s = spriteStub();
        s.texture.key = key;
        s.texture = {
          key,
          has: (pose: string) => textures.includes(key) && (pose === 'idle' || !frame),
        };
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

  it('renders both fighters at 280 px tall on the 1280×720 canvas', () => {
    const { scene, sprites } = fightersScene([ART.heroes.knight, ART.monsters.jellyBun]);
    drawFighters(
      scene as unknown as Phaser.Scene,
      battlePhaseState('jellyBun'),
      battleLayout(1280, 720),
    );
    expect(sprites[0]!.setDisplaySize).toHaveBeenCalledWith(expect.any(Number), 280);
    expect(sprites[1]!.setDisplaySize).toHaveBeenCalledWith(expect.any(Number), 280);
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
