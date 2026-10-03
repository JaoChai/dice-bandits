import type Phaser from 'phaser';
import type { Combatant, GameState } from '@dice-bandits/engine';
import { ART } from '../../art/manifest';
import { poseFor, puppetTweens, type Motion, type Pose } from '../../art/puppet';
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

function playMotion(scene: Phaser.Scene, sprite: Phaser.GameObjects.Sprite, motion: Motion): void {
  const pose: Pose = poseFor(motion);
  if (textured(sprite, pose)) sprite.setFrame(pose);
  const steps = puppetTweens(motion, puppetOptions());
  if (!steps.length) return;
  const chain = (index: number): void => {
    const step = steps[index];
    if (!step) return;
    scene.tweens.add({
      targets: sprite,
      ...step.props,
      duration: step.duration,
      ease: step.ease,
      yoyo: step.yoyo,
      repeat: step.repeat,
      onComplete: () => chain(index + 1),
    });
  };
  chain(0);
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
    const sprite = scene.add
      .sprite(pos.x, pos.y, atlas, textured ? 'idle' : undefined)
      .setOrigin(0.5, 1)
      // 280 px puppets on the 1280×720 stage (plan Task 8); the pose cell's
      // own aspect sets the width (atlas cells are 512 px source, 280 ship).
      .setDisplaySize(BATTLE_FIGHTER_HEIGHT * 0.75, BATTLE_FIGHTER_HEIGHT)
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
