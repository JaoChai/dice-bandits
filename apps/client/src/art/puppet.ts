/**
 * Paper-puppet motion specs (plan M5a Task 7).
 *
 * Pure data: no Phaser import, no window access. Conventions for consumers
 * (BoardScene tokens, battle fighters):
 * - `x`, `y`, `angle` are RELATIVE offsets from the token's current pose.
 * - `scaleX`/`scaleY`/`alpha`/`tint` are ABSOLUTE targets (1 = base scale,
 *   0xffffff = no tint).
 * - Steps play back to back; combine with Phaser tween chains/queue.
 * - `tint: 0xffffff` on `hurt` means "flash the fill white" (paper flash);
 *   the consumer restores its own base tint afterwards.
 * - Pass `{ speed: motionScale(), reduced: reducedMotion() }` (from
 *   `./motion`) so ?speed=0 and prefers-reduced-motion apply.
 */

export type Motion = 'idle' | 'hop' | 'attack' | 'hurt' | 'happy' | 'sad' | 'ko';

export type Pose = 'idle' | 'attack' | 'hurt' | 'happy' | 'sad';

export interface TweenStep {
  props: Partial<{
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    angle: number;
    alpha: number;
    tint: number;
  }>;
  duration: number;
  ease: string;
  yoyo?: boolean;
  repeat?: number;
}

/** Specs at speed 1 with reduced motion off. */
const SPECS: Record<Motion, TweenStep[]> = {
  idle: [
    {
      props: { scaleY: 1.03, scaleX: 0.99 },
      duration: 900,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    },
  ],
  hop: [
    { props: { y: -26 }, duration: 180, ease: 'Quad.easeOut' },
    { props: { y: 0 }, duration: 160, ease: 'Quad.easeIn' },
    {
      props: { scaleX: 1.12, scaleY: 0.88 },
      duration: 90,
      ease: 'Quad.easeOut',
      yoyo: true,
      repeat: 1,
    },
  ],
  attack: [
    { props: { scaleX: 0.94, scaleY: 1.06 }, duration: 90, ease: 'Quad.easeOut' },
    { props: { x: 34 }, duration: 100, ease: 'Quad.easeOut' },
    { props: { angle: -10 }, duration: 80, ease: 'Quad.easeOut' },
    {
      props: { x: 0, angle: 0, scaleX: 1, scaleY: 1 },
      duration: 140,
      ease: 'Quad.easeIn',
    },
  ],
  hurt: [
    { props: { tint: 0xffffff }, duration: 70, ease: 'Quad.easeOut' },
    { props: { x: -10 }, duration: 55, ease: 'Quad.easeInOut' },
    { props: { x: 8 }, duration: 55, ease: 'Quad.easeInOut' },
    { props: { x: -4 }, duration: 45, ease: 'Quad.easeInOut' },
    { props: { x: 0 }, duration: 60, ease: 'Quad.easeOut' },
  ],
  happy: [
    { props: { y: -18 }, duration: 160, ease: 'Quad.easeOut' },
    { props: { y: 0 }, duration: 160, ease: 'Quad.easeIn' },
    { props: { y: -10, scaleX: 1.06, scaleY: 1.06 }, duration: 130, ease: 'Quad.easeOut' },
    { props: { y: 0, scaleX: 1, scaleY: 1 }, duration: 130, ease: 'Quad.easeIn' },
  ],
  sad: [
    { props: { scaleY: 0.88, scaleX: 1.06 }, duration: 240, ease: 'Quad.easeOut' },
    { props: { y: 3 }, duration: 180, ease: 'Quad.easeIn' },
  ],
  ko: [
    { props: { scaleY: 0.7, scaleX: 1.15 }, duration: 180, ease: 'Quad.easeOut' },
    { props: { angle: 12, y: 6 }, duration: 200, ease: 'Quad.easeIn' },
    { props: { alpha: 0 }, duration: 260, ease: 'Quad.easeIn' },
  ],
};

/** x/angle offsets are the shake-like props suppressed by reduced motion. */
function isShakeStep(step: TweenStep): boolean {
  const { x, angle } = step.props;
  return (x !== undefined && x !== 0) || (angle !== undefined && angle !== 0);
}

function applyPolicy(steps: TweenStep[], opts: { speed: number; reduced: boolean }): TweenStep[] {
  const filtered = opts.reduced
    ? steps.filter((step) => !isShakeStep(step) && step.props.tint === undefined)
    : steps;
  return filtered.map((step) => ({
    ...step,
    props: { ...step.props },
    duration: Math.round(step.duration * opts.speed),
  }));
}

export function puppetTweens(
  motion: Motion,
  opts: { speed: number; reduced: boolean },
): TweenStep[] {
  const steps = applyPolicy(SPECS[motion], opts);
  if (opts.reduced && motion === 'idle') {
    return steps.map((step) => ({ ...step, repeat: 0 }));
  }
  return steps;
}

const POSES: Record<Motion, Pose> = {
  idle: 'idle',
  hop: 'idle',
  attack: 'attack',
  hurt: 'hurt',
  happy: 'happy',
  sad: 'sad',
  ko: 'sad',
};

export function poseFor(motion: Motion): Pose {
  return POSES[motion];
}
