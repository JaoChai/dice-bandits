import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { playCoinBurst, playHit } from '../../src/scenes/battle/effects';
import { BATTLE_FIGHTER_HEIGHT } from '../../src/scenes/battle/layout';

/**
 * Task 8 reviewer item 3 RED: playHit must drive the cartoon puppet poses —
 * attacker plays `attack`, the target plays `hurt`, both return to `idle`
 * through the fixed playMotion conversion — and skip everything at speed 0.
 * The `art:` atlases expose named frames, not Phaser anims, so the old
 * hasAnim/play(path) calls never fired.
 */

type Spec = Record<string, unknown>;

type EffectSprite = Phaser.GameObjects.Sprite &
  Record<string, unknown> & { destroy: ReturnType<typeof vi.fn> };

function effectSprite(textureKey: string, present: boolean): EffectSprite {
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
    destroy: vi.fn(),
    x: 340,
    y: 660,
    angle: 0,
    flipX: false,
    scaleX: 1,
    scaleY: 1,
    scale: 1,
    texture: { key: textureKey, has: () => present, get: () => ({ realHeight: 280, height: 280 }) },
  } as unknown as EffectSprite;
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
}

function hitScene(textures: string[], iconFrames: string[] | null = ['sword', 'star', 'coin']) {
  const sprites: Array<Phaser.GameObjects.Sprite & Record<string, unknown>> = [];
  const tweens: Spec[] = [];
  const frames: Array<{ key: string; pose: string }> = [];
  const delayed: Array<{ delay: number; fire: () => void }> = [];
  const textObjects: Array<Record<string, unknown>> = [];
  const scene = {
    textures: {
      exists: (key: string) =>
        textures.includes(key) || (key === 'art:icons' && iconFrames !== null),
      get: (key: string) => ({
        has: (frame: string) =>
          key === 'art:icons' ? (iconFrames?.includes(frame) ?? false) : textures.includes(key),
      }),
    },
    anims: { exists: () => false },
    time: {
      delayedCall: vi.fn((delay: number, fire: () => void) => {
        delayed.push({ delay, fire });
        return { remove: vi.fn() };
      }),
    },
    tweens: {
      add: vi.fn((spec: Spec) => {
        tweens.push(spec);
        return spec;
      }),
    },
    cameras: { main: { flash: vi.fn(), shake: vi.fn() } },
    add: {
      image: vi.fn((x: number, y: number, key: string, frame?: string | number) => {
        const sprite = effectSprite(key, true);
        sprite.x = x;
        sprite.y = y;
        frames.push({ key, pose: String(frame) });
        sprites.push(sprite);
        return sprite;
      }),
      text: vi.fn((x: number, y: number, value: string) => {
        const text = {
          x,
          y,
          value,
          setOrigin: vi.fn().mockReturnThis(),
          setDepth: vi.fn().mockReturnThis(),
          destroy: vi.fn(),
        };
        textObjects.push(text);
        return text;
      }),
    },
  };
  return { scene, sprites, tweens, frames, delayed, textObjects };
}

const FIGHTERS = () => {
  const attacker = effectSprite('art:hero-knight', true);
  const target = effectSprite('art:monster-jellyBun', true);
  return { a: attacker, b: target };
};

const LAYOUT = {
  left: { x: 340, y: 660 },
  right: { x: 940, y: 660 },
  hpLeft: { x: 40, y: 36, width: 420, height: 96 },
  hpRight: { x: 820, y: 36, width: 420, height: 96 },
  dice: { x: 300, y: 678, width: 680, height: 42 },
  cards: { x: 540, y: 430, width: 180, height: 240 },
};

const EVENT = { attacker: 0, defender: 'jellyBun', toAttacker: 0, toDefender: 7 };

/** Flush every delayedCall and chained onComplete until playHit settles. */
async function settle(
  running: Promise<void>,
  tweens: Spec[],
  delayed: Array<{ delay: number; fire: () => void }>,
): Promise<void> {
  for (let round = 0; round < 40; round += 1) {
    const current = tweens[tweens.length - 1];
    const complete = current?.onComplete as (() => void) | undefined;
    complete?.();
    for (const timer of delayed) timer.fire();
    await Promise.resolve();
  }
  await running;
}

describe('playHit drives the cartoon puppet poses (reviewer item 3)', () => {
  it('plays attack on the attacker and hurt then idle on the target', async () => {
    const { scene, tweens, delayed } = hitScene(['art:hero-knight', 'art:monster-jellyBun']);
    const fighters = FIGHTERS();
    const running = playHit(
      scene as unknown as Phaser.Scene,
      fighters as never,
      LAYOUT as never,
      EVENT,
      0,
      'jellyBun',
      1,
    );
    // The pre-impact pause holds the chain; fire it and let the tween chain
    // mount the attack motion for the attacker.
    await Promise.resolve();
    await settle(running, tweens, delayed);
    const attackPose = (fighters.a as unknown as { setFrame: ReturnType<typeof vi.fn> }).setFrame;
    expect(attackPose).toHaveBeenCalledWith('attack');
    const targetPose = (fighters.b as unknown as { setFrame: ReturnType<typeof vi.fn> }).setFrame;
    expect(targetPose).toHaveBeenCalledWith('hurt');
    expect(targetPose).toHaveBeenCalledWith('idle');
    // The motions must mount real puppet tween steps, not only swap frames.
    expect(tweens.length).toBeGreaterThan(0);
  });

  it('places hit fx and damage numbers from the fighter height, not 640x360 constants', async () => {
    const { scene, sprites, frames, tweens, delayed, textObjects } = hitScene([
      'art:hero-knight',
      'art:monster-jellyBun',
    ]);
    const fighters = FIGHTERS();
    const running = playHit(
      scene as unknown as Phaser.Scene,
      fighters as never,
      LAYOUT as never,
      EVENT,
      0,
      'jellyBun',
      1,
    );
    await Promise.resolve();
    await settle(running, tweens, delayed);
    expect(frames).toEqual([
      { key: 'art:icons', pose: 'sword' },
      { key: 'art:icons', pose: 'star' },
    ]);
    for (const image of sprites) {
      expect(image.setDisplaySize).toHaveBeenCalledWith(48, 48);
      expect(image.setDepth).toHaveBeenCalledWith(12);
      expect(image.destroy).toHaveBeenCalledOnce();
    }
    const ground = LAYOUT.left.y;
    // Round 2, reviewer item 2: hit fx must land in the fighter's UPPER half
    // (between pos.y-H and pos.y-H/2), the damage number above the head
    // (y < pos.y-H) — the old offsets (H/4, H/2+8) hit shin / mid-body.
    const fxY = (y: number): number => ground - y;
    // Band [H/2 - 4, H]: chest .. head (spark sits 2 px below chest).
    expect(fxY(sprites[0]!.y)).toBeGreaterThanOrEqual(BATTLE_FIGHTER_HEIGHT / 2 - 4);
    expect(fxY(sprites[0]!.y)).toBeLessThanOrEqual(BATTLE_FIGHTER_HEIGHT);
    expect(fxY(sprites[1]!.y)).toBeGreaterThanOrEqual(BATTLE_FIGHTER_HEIGHT / 2 - 4);
    expect(fxY(sprites[1]!.y)).toBeLessThanOrEqual(BATTLE_FIGHTER_HEIGHT);
    expect(textObjects[0]!.y).toBeLessThan(ground - BATTLE_FIGHTER_HEIGHT);
    // ...and they stay derived from the fighter height, not magic numbers.
    expect(sprites[0]!.y).toBe(ground - BATTLE_FIGHTER_HEIGHT / 2);
    expect(sprites[1]!.y).toBe(ground - BATTLE_FIGHTER_HEIGHT / 2 + 2);
    expect(textObjects[0]!.y).toBe(ground - BATTLE_FIGHTER_HEIGHT - 36);
  });

  it('fans five cartoon coins and destroys each after its tween', async () => {
    const { scene, sprites, frames, tweens } = hitScene([]);
    const running = playCoinBurst(scene as unknown as Phaser.Scene, LAYOUT, 'b', 1);
    expect(frames).toEqual(Array.from({ length: 5 }, () => ({ key: 'art:icons', pose: 'coin' })));
    expect(sprites.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 904, y: 605 },
      { x: 922, y: 605 },
      { x: 940, y: 605 },
      { x: 958, y: 605 },
      { x: 976, y: 605 },
    ]);
    expect(tweens).toHaveLength(5);
    for (const [index, tween] of tweens.entries()) {
      expect(tween.targets).toBe(sprites[index]);
      expect(tween.alpha).toBe(0);
      expect(tween.duration).toBe(320);
      (tween.onComplete as () => void)();
    }
    await running;
    for (const image of sprites) {
      expect(image.setDisplaySize).toHaveBeenCalledWith(48, 48);
      expect(image.destroy).toHaveBeenCalledOnce();
    }
  });

  it.each([null, []])(
    'skips missing icon atlas or frames (%j) without stopping hit feedback',
    async (icons) => {
      const { scene, sprites, tweens, delayed, textObjects } = hitScene(
        ['art:hero-knight', 'art:monster-jellyBun'],
        icons,
      );
      const running = playHit(
        scene as unknown as Phaser.Scene,
        FIGHTERS() as never,
        LAYOUT,
        EVENT,
        0,
        'jellyBun',
        1,
      );
      await settle(running, tweens, delayed);
      await playCoinBurst(scene as unknown as Phaser.Scene, LAYOUT, 'a', 1);
      expect(sprites).toHaveLength(0);
      expect(textObjects).toHaveLength(1);
    },
  );

  it('skips every pose and pause at speed 0', async () => {
    const { scene, tweens, delayed } = hitScene(['art:hero-knight', 'art:monster-jellyBun']);
    const fighters = FIGHTERS();
    await playHit(
      scene as unknown as Phaser.Scene,
      fighters as never,
      LAYOUT as never,
      EVENT,
      0,
      'jellyBun',
      0,
    );
    expect(delayed.length).toBe(0);
    expect(tweens.length).toBe(0);
    expect(
      (fighters.b as unknown as { setFrame: ReturnType<typeof vi.fn> }).setFrame,
    ).not.toHaveBeenCalled();
  });
});
