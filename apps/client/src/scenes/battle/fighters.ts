import type Phaser from 'phaser';
import type { Combatant, GameState } from '@dice-bandits/engine';
import { ART } from '../../art/manifest';
import { poseFor, puppetTweens, type Motion } from '../../art/puppet';
import { puppetOptions } from '../../art/motion';
import type { BattleLayout } from './layout';
import { BATTLE_FIGHTER_HEIGHT } from './layout';

/** Cartoon atlas + pose for a combatant; falls back to a flat colour key. */
export function fighterAtlas(
  state: GameState,
  fighter: Pick<Combatant, 'kind' | 'seat' | 'monsterId'>,
): string {
  if (fighter.kind === 'player')
    return ART.heroes[state.players[fighter.seat!]?.classId ?? 'knight'];
  const monsterId = fighter.monsterId ?? '';
  return monsterId in ART.monsters
    ? ART.monsters[monsterId as keyof typeof ART.monsters]
    : ART.icons;
}

export type BattleFighters = {
  a: Phaser.GameObjects.Sprite;
  b: Phaser.GameObjects.Sprite;
};

/**
 * Paper-puppet playback on a sprite: switch to the motion's pose frame, then
 * chain the tween steps. `?speed=0` (duration 0) and reduced motion are
 * handled inside `puppetTweens`.
 */
/**
 * A sprite is "textured" when its texture manager entry carries the pose —
 * the fake scenes in tests only provide `texture.has`, real Phaser provides
 * `frame.name`; `has` is the contract both satisfy.
 */
function textured(sprite: Phaser.GameObjects.Sprite, pose: string): boolean {
  try {
    return sprite.texture.has(pose);
  } catch {
    return false;
  }
}

/** Source pixel height of a pose frame; fakes without frame data yield undefined. */
function frameHeight(
  texture: Phaser.Textures.Texture | undefined,
  pose: string,
): number | undefined {
  try {
    if (!texture) return undefined;
    const frame = texture.get(pose) as Phaser.Textures.Frame | undefined;
    const height = frame?.realHeight ?? frame?.height ?? 0;
    return height > 0 ? height : undefined;
  } catch {
    return undefined;
  }
}

type PuppetProps = Partial<{
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  alpha: number;
  tint: number;
}>;

/**
 * Puppet specs are RELATIVE (puppet.ts header): x/y/angle offset from the
 * sprite's home pose, scaleX/scaleY relative to its base scale. Phaser
 * tweens interpolate absolute values, so convert once here (reviewer item
 * 2): the home pose is captured on first play, x offsets mirror for the
 * flipped (b) side, and scales multiply the base scale.
 */
function absoluteProps(sprite: Phaser.GameObjects.Sprite, props: PuppetProps): PuppetProps {
  const home = homePose(sprite);
  const flip = sprite.flipX === true ? -1 : 1;
  const out: PuppetProps = {};
  if (props.x !== undefined) out.x = home.x + props.x * flip;
  if (props.y !== undefined) out.y = home.y + props.y;
  if (props.angle !== undefined) out.angle = home.angle + props.angle * flip;
  if (props.scaleX !== undefined) out.scaleX = baseScale(sprite) * props.scaleX;
  if (props.scaleY !== undefined) out.scaleY = baseScale(sprite) * props.scaleY;
  if (props.alpha !== undefined) out.alpha = props.alpha;
  if (props.tint !== undefined) out.tint = props.tint;
  return out;
}

const HOMES = new WeakMap<object, { x: number; y: number; angle: number }>();

function homePose(sprite: Phaser.GameObjects.Sprite): { x: number; y: number; angle: number } {
  let home = HOMES.get(sprite);
  if (!home) {
    home = { x: sprite.x, y: sprite.y, angle: sprite.angle };
    HOMES.set(sprite, home);
  }
  return home;
}

/**
 * Base scale = the uniform scale drawFighters applied from the idle frame's
 * height. A tween mid-flight changes scaleX/scaleY away from the base, so
 * read it from `scale` when that is available and otherwise from scaleY.
 */
function baseScale(sprite: Phaser.GameObjects.Sprite): number {
  const candidate = (sprite as unknown as { scale?: number }).scale;
  if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0)
    return candidate;
  return typeof sprite.scaleY === 'number' && sprite.scaleY > 0 ? sprite.scaleY : 1;
}

function playMotion(scene: Phaser.Scene, sprite: Phaser.GameObjects.Sprite, motion: Motion): void {
  const pose = poseFor(motion);
  if (textured(sprite, pose)) sprite.setFrame(pose);
  const steps = puppetTweens(motion, puppetOptions());
  if (!steps.length) return;
  const chain = (index: number): void => {
    const step = steps[index];
    if (!step) return;
    scene.tweens.add({
      targets: sprite,
      ...absoluteProps(sprite, step.props),
      duration: step.duration,
      ease: step.ease,
      yoyo: step.yoyo,
      repeat: step.repeat,
      onComplete: () => chain(index + 1),
    });
  };
  chain(0);
}

/** Test hook: run a named motion's tween chain on a standalone sprite. */
export function playMotionForTest(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Sprite,
  motion: Motion,
): void {
  playMotion(scene, sprite, motion);
}

export function drawFighters(
  scene: Phaser.Scene,
  state: GameState,
  layout: BattleLayout,
): BattleFighters {
  if (state.phase.kind !== 'battle') throw new Error('drawFighters requires battle phase');
  const fighters = state.phase.battle;
  const make = (combatant: Combatant, side: 'a' | 'b') => {
    const atlas = fighterAtlas(state, combatant);
    const texture = scene.textures.exists(atlas) ? scene.textures.get(atlas) : undefined;
    const textured = !!texture && texture.has('idle');
    const pos = side === 'a' ? layout.left : layout.right;
    const probe = texture as Phaser.Textures.Texture | undefined;
    // One uniform scale per atlas: the pose cell's own aspect sets the width
    // (plan Task 8; reviewer item 1). 280 px target height ÷ the idle frame's
    // real pixel height; without frame data fall back to scale 1.
    const idleHeight = textured
      ? (frameHeight(probe, 'idle') ?? BATTLE_FIGHTER_HEIGHT)
      : BATTLE_FIGHTER_HEIGHT;
    const scale = BATTLE_FIGHTER_HEIGHT / idleHeight;
    const sprite = scene.add
      .sprite(pos.x, pos.y, atlas, textured ? 'idle' : undefined)
      .setOrigin(0.5, 1)
      .setScale(scale)
      .setFlipX(side === 'b')
      .setDepth(5);
    if (!textured) console.warn('[art] fallback', atlas);
    else playMotion(scene, sprite, 'idle');
    if (combatant.secretUsed) {
      scene.add
        .text(pos.x, pos.y - BATTLE_FIGHTER_HEIGHT - 24, '★', {
          fontFamily: 'Mitr, Chakra Petch, sans-serif',
          fontSize: '28px',
          color: '#F5C51C',
        })
        .setOrigin(0.5)
        .setDepth(6);
    }
    return sprite;
  };
  return { a: make(fighters.a, 'a'), b: make(fighters.b, 'b') };
}

export function drawDicePools(scene: Phaser.Scene, state: GameState, layout: BattleLayout): void {
  if (state.phase.kind !== 'battle') return;
  const { dice } = layout;
  scene.add
    .rectangle(
      dice.x + dice.width / 2,
      dice.y + dice.height / 2,
      dice.width,
      dice.height,
      0x5c3317,
      0.85,
    )
    .setStrokeStyle(3, 0xf5c51c)
    .setDepth(7);
  const stats = [state.phase.battle.a.stats.atk, state.phase.battle.b.stats.atk];
  for (let side = 0; side < 2; side++) {
    const pool = Math.max(1, Math.min(5, Math.ceil(stats[side]! / 4)));
    const half = dice.width / 2;
    const startX = dice.x + side * half + half / 2 - (pool - 1) * 30;
    for (let die = 0; die < pool; die++) {
      const x = startX + die * 30;
      // Maximum of five 36px dice fits in each 340px half of the strip.
      scene.add
        .rectangle(x, dice.y + dice.height / 2, 36, 36, 0xf5eedc)
        .setStrokeStyle(3, 0x5c3317)
        .setDepth(8);
      scene.add.circle(x, dice.y + dice.height / 2, 3, 0x5c3317).setDepth(9);
    }
  }
}
