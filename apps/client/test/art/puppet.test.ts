import { describe, expect, it } from 'vitest';
import { poseFor, puppetTweens, type Motion, type TweenStep } from '../../src/art/puppet';

const MOTIONS: Motion[] = ['idle', 'hop', 'attack', 'hurt', 'happy', 'sad', 'ko'];

function stepAt(steps: TweenStep[], index: number): TweenStep {
  const step = steps[index];
  if (!step) throw new Error(`expected at least ${index + 1} tween steps`);
  return step;
}

function last(steps: TweenStep[]): TweenStep {
  return stepAt(steps, steps.length - 1);
}

function colorSteps(motion: Motion): TweenStep[] {
  return puppetTweens(motion, { speed: 1, reduced: false }).filter(
    (step) => step.props.tint !== undefined,
  );
}

function shakeLikeSteps(steps: TweenStep[]): TweenStep[] {
  return steps.filter(
    (step) =>
      (step.props.x !== undefined && step.props.x !== 0) ||
      (step.props.angle !== undefined && step.props.angle !== 0),
  );
}

describe('paper-puppet motion specs', () => {
  it('produces tween steps for every motion', () => {
    for (const motion of MOTIONS) {
      const steps = puppetTweens(motion, { speed: 1, reduced: false });
      expect(steps.length).toBeGreaterThan(0);
    }
  });

  it('idle: scaleY oscillates 1.00↔1.03 and repeats forever (repeat -1)', () => {
    const steps = puppetTweens('idle', { speed: 1, reduced: false });
    const breath = steps.find((step) => step.props.scaleY !== undefined);
    expect(breath).toBeDefined();
    expect(breath?.props.scaleY).toBe(1.03);
    expect(breath?.yoyo).toBe(true);
    expect(breath?.repeat).toBe(-1);
  });

  it('hop: ends with a squash step (scaleY < 1, scaleX > 1)', () => {
    const steps = puppetTweens('hop', { speed: 1, reduced: false });
    const squash = last(steps);
    expect(squash.props.scaleY).toBeLessThan(1);
    expect(squash.props.scaleX).toBeGreaterThan(1);
  });

  it('attack: contains a lunge (x offset > 0) and a tilt', () => {
    const steps = puppetTweens('attack', { speed: 1, reduced: false });
    const lunge = steps.find((step) => (step.props.x ?? 0) > 0);
    expect(lunge).toBeDefined();
    const tilt = steps.find((step) => step.props.angle !== undefined && step.props.angle !== 0);
    expect(tilt).toBeDefined();
  });

  it('hurt: contains a white tint step and at least 2 shake steps', () => {
    const steps = puppetTweens('hurt', { speed: 1, reduced: false });
    const white = colorSteps('hurt');
    expect(white.length).toBeGreaterThan(0);
    for (const step of white) expect(step.props.tint).toBe(0xffffff);
    expect(shakeLikeSteps(steps).length).toBeGreaterThanOrEqual(2);
  });

  it('happy and sad run without infinite loops', () => {
    for (const motion of ['happy', 'sad'] as const) {
      const steps = puppetTweens(motion, { speed: 1, reduced: false });
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.every((step) => !step.repeat || step.repeat >= 0)).toBe(true);
    }
  });

  it('ko: ends with alpha 0', () => {
    const steps = puppetTweens('ko', { speed: 1, reduced: false });
    expect(last(steps).props.alpha).toBe(0);
  });

  it('speed 0 zeroes every duration', () => {
    for (const motion of MOTIONS) {
      const steps = puppetTweens(motion, { speed: 0, reduced: false });
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) expect(step.duration).toBe(0);
    }
  });

  it('reduced motion: no shake steps, no tint, idle repeat 0', () => {
    for (const motion of MOTIONS) {
      const steps = puppetTweens(motion, { speed: 1, reduced: true });
      expect(shakeLikeSteps(steps).length).toBe(0);
      expect(steps.filter((step) => step.props.tint !== undefined).length).toBe(0);
    }
    const idle = puppetTweens('idle', { speed: 1, reduced: true });
    expect(idle.at(0)?.repeat).toBe(0);
  });

  it('speed scales durations proportionally', () => {
    const normal = puppetTweens('hop', { speed: 1, reduced: false });
    const fast = puppetTweens('hop', { speed: 0.5, reduced: false });
    expect(fast.length).toBe(normal.length);
    for (let i = 0; i < normal.length; i += 1) {
      expect(fast.at(i)?.duration).toBe(Math.round(normal.at(i)!.duration * 0.5));
    }
  });

  it('poseFor maps hop to idle', () => {
    expect(poseFor('hop')).toBe('idle');
  });

  it('poseFor maps every motion into the atlas pose set', () => {
    expect(poseFor('idle')).toBe('idle');
    expect(poseFor('attack')).toBe('attack');
    expect(poseFor('hurt')).toBe('hurt');
    expect(poseFor('happy')).toBe('happy');
    expect(poseFor('sad')).toBe('sad');
    expect(poseFor('ko')).toBe('sad');
  });
});
