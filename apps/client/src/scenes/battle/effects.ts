import type Phaser from 'phaser';
import type { BattleFighters } from './fighters';
import type { BattleLayout } from './layout';
import { BATTLE_FIGHTER_HEIGHT } from './layout';
import { playMotion } from './fighters';
import { ART } from '../../art/manifest';
import { reducedMotion } from '../../art/motion';
import type { BattleBeat } from './presentation';
import { t } from '../../i18n';

/** One generation of cosmetic effects. No waits inside: the scene's seven
 * beats are the only clock, including simultaneous counter/mutual hits. */
export function createBattleEffects(
  scene: Phaser.Scene,
  source: BattleFighters,
  layout: BattleLayout,
  detached = false,
): { showBeat(beat: BattleBeat): void; destroy(): void } {
  const sprites: BattleFighters = detached
    ? (Object.fromEntries(
        (['a', 'b'] as const).map((side) => {
          const fighter = source[side];
          return [
            side,
            scene.add
              .sprite(fighter.x, fighter.y, fighter.texture.key, fighter.frame.name)
              .setOrigin(0.5, 1)
              .setScale(fighter.scaleX, fighter.scaleY)
              .setFlipX(fighter.flipX)
              .setAlpha(0.65)
              .setDepth(10)
              .setName(`battle-effect-ghost-${side}`),
          ];
        }),
      ) as BattleFighters)
    : source;
  const objects: Phaser.GameObjects.GameObject[] = [];
  const tweens: Phaser.Tweens.Tween[] = [];
  const bases = {
    a: { x: sprites.a.x, scale: sprites.a.scaleX },
    b: { x: sprites.b.x, scale: sprites.b.scaleX },
  };
  for (const sprite of Object.values(sprites)) scene.tweens.killTweensOf(sprite);
  const pose = (side: Side, frame: string): void => {
    if (sprites[side].texture.has(frame)) sprites[side].setFrame(frame);
  };
  const clearObjects = (): void => {
    for (const object of objects.splice(0)) object.destroy();
  };
  return {
    showBeat(beat) {
      clearObjects();
      if (beat.duration <= 0) return;
      const attacker = beat.attacker;
      if ((beat.kind === 'anticipation' || beat.kind === 'lunge') && attacker) {
        pose(attacker, 'attack');
        if (beat.kind === 'lunge')
          tweens.push(
            scene.tweens.add({
              targets: sprites[attacker],
              x: bases[attacker].x + (attacker === 'a' ? 1 : -1) * layout.fighterHeight * 0.2,
              duration: beat.duration / 2,
              yoyo: true,
              ease: 'Sine.easeInOut',
            }),
          );
      }
      if (beat.kind === 'impact' || beat.kind === 'damage' || beat.kind === 'drain') {
        for (const target of beat.targets) {
          if (target.amount <= 0) continue;
          const pos = layout[target.side === 'a' ? 'left' : 'right'];
          pose(target.side, 'hurt');
          if (beat.kind === 'impact') {
            const spark = effect(scene, 'spark', pos.x, pos.y - layout.fighterHeight / 2);
            if (spark) objects.push(spark.setName('battle-effect-impact'));
            if (!detached && !reducedMotion()) {
              scene.cameras.main.flash(beat.duration, 255, 235, 225);
              scene.cameras.main.shake(beat.duration, 0.003);
            }
          } else if (beat.kind === 'damage') {
            const number = scene.add
              .text(
                pos.x,
                pos.y - layout.fighterHeight - 36,
                t('battle.damage', { value: target.amount }),
                {
                  fontFamily: 'Mitr, sans-serif',
                  fontSize: '24px',
                  color: '#fff4dc',
                  stroke: '#5c3317',
                  strokeThickness: 4,
                },
              )
              .setOrigin(0.5)
              .setDepth(14)
              .setName('battle-effect-damage');
            objects.push(number);
          }
        }
      }
      if (beat.kind === 'result')
        for (const side of ['a', 'b'] as const) pose(side, side === beat.winner ? 'happy' : 'idle');
    },
    destroy() {
      for (const tween of tweens) tween.remove();
      clearObjects();
      if (detached) for (const sprite of Object.values(sprites)) sprite.destroy();
      else
        for (const side of ['a', 'b'] as const) {
          sprites[side].setX(bases[side].x).setScale(bases[side].scale).clearTint();
          pose(side, 'idle');
          if (!reducedMotion()) playMotion(scene, sprites[side], 'idle');
        }
    },
  };
}

/** Legacy 720p offset retained for callers; playback uses viewport coordinates. */
export const HIT_TORSO_Y = BATTLE_FIGHTER_HEIGHT / 2;

type Side = 'a' | 'b';
export type DamageEvent = {
  attacker: string | number;
  defender: string | number;
  toAttacker: number;
  toDefender: number;
};

export function damageTargets(
  event: DamageEvent,
  left: string | number,
  right: string | number,
): { side: Side; amount: number }[] {
  const sideOf = (id: string | number): Side | null =>
    String(id) === String(left) ? 'a' : String(id) === String(right) ? 'b' : null;
  const targets: { side: Side; amount: number }[] = [];
  const add = (side: Side | null, amount: number) => {
    if (side && Number.isFinite(amount) && amount > 0) targets.push({ side, amount });
  };
  add(sideOf(event.attacker), Number(event.toAttacker));
  add(sideOf(event.defender), Number(event.toDefender));
  return targets;
}

function pause(scene: Phaser.Scene, duration: number): Promise<void> {
  return new Promise((resolve) => scene.time.delayedCall(duration, resolve));
}

function effect(
  scene: Phaser.Scene,
  name: 'slash' | 'spark' | 'coin',
  x: number,
  y: number,
): Phaser.GameObjects.Image | undefined {
  const frame = { slash: 'sword', spark: 'star', coin: 'coin' }[name];
  if (!scene.textures.exists(ART.icons) || !scene.textures.get(ART.icons).has(frame)) return;
  return scene.add.image(x, y, ART.icons, frame).setDisplaySize(48, 48).setDepth(12);
}

export async function playHit(
  scene: Phaser.Scene,
  fighters: BattleFighters,
  layout: BattleLayout,
  event: DamageEvent,
  leftId: string | number,
  rightId: string | number,
  speed: number,
): Promise<void> {
  if (speed <= 0) return;
  const attackerSide = String(event.attacker) === String(rightId) ? 'b' : 'a';
  const attacker = fighters[attackerSide];
  playMotion(scene, attacker, 'attack');
  await pause(scene, 125 * speed);
  for (const { side, amount } of damageTargets(event, leftId, rightId)) {
    const pos = layout[side === 'a' ? 'left' : 'right'];
    const target = fighters[side];
    const slash = effect(scene, 'slash', pos.x, pos.y - layout.fighterHeight / 2);
    await pause(scene, 90 * speed);
    slash?.destroy();
    const spark = effect(scene, 'spark', pos.x, pos.y - layout.fighterHeight / 2 + 2);
    playMotion(scene, target, 'hurt');
    if (!reducedMotion()) {
      target.setTint(0xffffff);
      scene.cameras.main.flash(90 * speed, 255, 235, 225);
      scene.cameras.main.shake(110 * speed, 0.003);
    }
    const number = scene.add
      .text(pos.x, pos.y - layout.fighterHeight - 36, t('battle.damage', { value: amount }), {
        fontFamily: 'Chakra Petch',
        fontSize: '20px',
        color: '#fff4dc',
        fontStyle: 'bold',
        stroke: '#291c32',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(14);
    await new Promise<void>((resolve) =>
      scene.tweens.add({
        targets: number,
        y: number.y - 24,
        alpha: 0,
        duration: 260 * speed,
        onComplete: () => {
          number.destroy();
          resolve();
        },
      }),
    );
    spark?.destroy();
    target.clearTint();
    if (!reducedMotion()) playMotion(scene, target, 'idle');
  }
  if (!reducedMotion()) playMotion(scene, attacker, 'idle');
}

export async function playCoinBurst(
  scene: Phaser.Scene,
  layout: BattleLayout,
  side: Side,
  speed: number,
): Promise<void> {
  if (speed <= 0) return;
  const pos = layout[side === 'a' ? 'left' : 'right'];
  const coins = Array.from({ length: 5 }, (_, index) =>
    effect(scene, 'coin', pos.x + (index - 2) * 18, pos.y - 55),
  );
  await Promise.all(
    coins.map((coin, index) =>
      coin
        ? new Promise<void>((resolve) =>
            scene.tweens.add({
              targets: coin,
              y: coin.y - 30 - (index % 2) * 16,
              alpha: 0,
              duration: 320 * speed,
              onComplete: () => {
                coin.destroy();
                resolve();
              },
            }),
          )
        : Promise.resolve(),
    ),
  );
}
