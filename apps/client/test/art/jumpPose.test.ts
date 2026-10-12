import type Phaser from 'phaser';
import { describe, expect, it } from 'vitest';
import { createHopPose, createRollPose } from '../../src/scenes/board/tokens';

// Real atlas dimensions; setFrame mirrors Phaser: changes intrinsic size,
// not scale. A fixed width or raw scale reused across frames distorts the art.
const heroes = [
  ['knight', 206, 280, 217, 278],
  ['thief', 168, 280, 178, 271],
  ['mage', 197, 260, 212, 280],
  ['cleric', 187, 234, 199, 280],
] as const;
function image(iw: number, ih: number, hw: number, hh: number, active = 1) {
  const frames = {
    idle: { name: 'idle', width: iw, height: ih },
    happy: { name: 'happy', width: hw, height: hh },
  };
  const token = {
    x: 200,
    y: 300,
    angle: 0,
    flipX: false,
    originX: 0.5,
    originY: 1,
    frame: frames.idle,
    texture: { has: (name: string) => name in frames },
    scaleX: (72 * active) / ih,
    scaleY: (72 * active) / ih,
    get displayHeight() {
      return this.frame.height * this.scaleY;
    },
    get displayWidth() {
      return this.frame.width * this.scaleX;
    },
    setFrame(name: 'idle' | 'happy') {
      this.frame = frames[name];
      return this;
    },
    setDisplaySize(w: number, h: number) {
      this.scaleX = w / this.frame.width;
      this.scaleY = h / this.frame.height;
      return this;
    },
    setFlipX(flip: boolean) {
      this.flipX = flip;
      return this;
    },
    setPosition(x: number, y: number) {
      this.x = x;
      this.y = y;
      return this;
    },
  };
  return token;
}

describe('frame-aware board poses', () => {
  it.each(heroes)(
    '%s keeps its feet, facing, height and each airborne frame aspect',
    (_hero, iw, ih, hw, hh) => {
      const token = image(iw, ih, hw, hh);
      const pose = createHopPose(token as unknown as Phaser.GameObjects.Image, 300, 560);
      for (const [k, frame] of [
        [0, 'idle'],
        [0.22, 'idle'],
        [0.23, 'happy'],
        [0.5, 'happy'],
        [0.81, 'happy'],
        [0.82, 'idle'],
        [1, 'idle'],
      ] as const) {
        pose.update(k);
        expect(token.frame.name).toBe(frame);
        expect(token.displayHeight).toBeCloseTo(72);
        expect(token.displayWidth).toBeCloseTo(72 * (frame === 'happy' ? hw / hh : iw / ih));
        expect(token).toMatchObject({ x: 200, y: 300, flipX: false, originX: 0.5, originY: 1 });
        expect(Math.abs(token.angle)).toBeLessThanOrEqual(15);
      }
      pose.update(0.5);
      pose.reset();
      expect(token.frame.name).toBe('idle');
      expect(token.displayHeight).toBeCloseTo(72);
      expect(token.angle).toBe(0);
    },
  );
  it('preserves active-seat enlargement and squeeze-turn across differently sized frames', () => {
    const token = image(187, 234, 199, 280, 1.18);
    const pose = createHopPose(token as unknown as Phaser.GameObjects.Image, 100, 400);
    pose.update(90 / 400);
    expect(token.flipX).toBe(true);
    expect(token.displayWidth).toBeCloseTo(((72 * 1.18 * 199) / 280) * 0.05);
    pose.update(0.5);
    expect(token.displayHeight).toBeCloseTo(72 * 1.18);
    pose.reset();
    expect(token.frame.name).toBe('idle');
    expect(token.displayWidth).toBeCloseTo((72 * 1.18 * 187) / 234);
  });
  it('crouches, springs happy, and lands idle in the original 350ms with no rotation', () => {
    const token = image(206, 280, 217, 278, 1.18);
    const pose = createRollPose(token as unknown as Phaser.GameObjects.Image);
    pose.update(0);
    expect(token.frame.name).toBe('idle');
    pose.update(110 / 350);
    expect(token.displayHeight).toBeCloseTo(72 * 1.18 * 0.82);
    expect(token.displayWidth).toBeCloseTo(((72 * 1.18 * 217) / 278) * 1.1);
    expect(token.frame.name).toBe('happy');
    pose.update(240 / 350);
    expect(token.y).toBe(282);
    expect(token.displayHeight).toBeCloseTo(72 * 1.18 * 1.08);
    for (let ms = 0; ms <= 350; ms++) {
      pose.update(ms / 350);
      expect(token.angle).toBe(0);
    }
    expect(token.frame.name).toBe('idle');
    expect(token.y).toBe(300);
    expect(token.displayHeight).toBeCloseTo(72 * 1.18);
    pose.update(0.5);
    pose.reset();
    expect(token).toMatchObject({ y: 300, angle: 0, frame: { name: 'idle' } });
  });
});
