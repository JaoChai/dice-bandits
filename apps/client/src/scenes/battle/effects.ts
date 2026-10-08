import type Phaser from 'phaser';
import type { BattleFighters } from './fighters';
import type { BattleLayout } from './layout';
import { BATTLE_FIGHTER_HEIGHT } from './layout';
import { playMotion } from './fighters';
import { ART } from '../../art/manifest';
import { reducedMotion } from '../../art/motion';
import { t } from '../../i18n';

/** Legacy 720p offset retained for callers; playback uses viewport coordinates. */
export const HIT_TORSO_Y = BATTLE_FIGHTER_HEIGHT / 2;

type Side = 'a' | 'b';
type DamageEvent = {
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
