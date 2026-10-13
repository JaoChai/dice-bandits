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
  const persistentTweens = new Set<Phaser.Tweens.Tween>();
  // Long-lived fields/coin paths survive lunge -> impact -> damage. They are
  // still owned by this generation and are removed at drain or cancellation.
  const persistent = new Set<object>();
  const bases = Object.fromEntries(
    (['a', 'b'] as const).map((side) => [
      side,
      {
        x: sprites[side].x,
        y: sprites[side].y,
        scaleX: sprites[side].scaleX,
        scaleY: sprites[side].scaleY,
        angle: sprites[side].angle,
        alpha: sprites[side].alpha,
      },
    ]),
  ) as Record<
    Side,
    { x: number; y: number; scaleX: number; scaleY: number; angle: number; alpha: number }
  >;
  // Canvas effects consume the same palette tokens as the HUD. Literal fallback
  // values are the approved theme, for headless/asset-error rendering only.
  const css = getComputedStyle(document.documentElement);
  const color = (token: string, fallback: string): number =>
    Number.parseInt((css.getPropertyValue(token).trim() || fallback).replace('#', ''), 16);
  const blue = color('--c-blue', '#2e7fe0'),
    gold = color('--c-gold', '#f5c51c');
  const orange = color('--c-orange', '#f07818'),
    cocoa = color('--c-cocoa', '#5c3317');
  const cream = color('--c-cream', '#f5eedc');
  let destroyed = false;
  for (const sprite of Object.values(sprites)) scene.tweens.killTweensOf(sprite);
  const defeated = new Set<Side>();
  const pose = (side: Side, frame: string): void => {
    const held = defeated.has(side) ? 'hurt' : frame;
    if (sprites[side].texture.has(held)) sprites[side].setFrame(held);
  };
  const clear = (preserve = false): void => {
    for (const handle of tweens.splice(0)) {
      if (preserve && persistentTweens.has(handle)) tweens.push(handle);
      else {
        handle.remove();
        persistentTweens.delete(handle);
      }
    }
    for (const object of objects.splice(0)) {
      if (preserve && persistent.has(object)) objects.push(object);
      else object.destroy();
    }
    if (!preserve) persistent.clear();
  };
  const tween = (config: Phaser.Types.Tweens.TweenBuilderConfig): void => {
    const handle = scene.tweens.add(config);
    tweens.push(handle);
    // Capture ownership before Phaser destroys a completed tween's targets.
    const targets = Array.isArray(config.targets) ? config.targets : [config.targets];
    if (targets.some((target) => target && persistent.has(target))) persistentTweens.add(handle);
  };
  const graphic = (name: string, side: Side, target = side): Phaser.GameObjects.Graphics => {
    const pos = layout[target === 'a' ? 'left' : 'right'];
    const shape = scene.add
      .graphics()
      .setPosition(pos.x, pos.y - layout.fighterHeight / 2)
      .setDepth(12)
      .setName(`battle-effect-${name}-${side}`);
    objects.push(shape);
    return shape;
  };
  const shield = (name: string, side: Side, duration: number): void => {
    const shape = graphic(name, side),
      h = layout.fighterHeight;
    shape
      .fillStyle(blue, 0.55)
      .lineStyle(5, gold, 1)
      .beginPath()
      .moveTo(-h * 0.25, -h * 0.35)
      .lineTo(h * 0.25, -h * 0.35)
      .lineTo(h * 0.22, h * 0.1)
      .lineTo(0, h * 0.35)
      .lineTo(-h * 0.22, h * 0.1)
      .closePath()
      .fillPath()
      .strokePath();
    tween({
      targets: shape,
      scaleX: { from: 0.5, to: 1 },
      scaleY: { from: 0.5, to: 1 },
      duration: duration / 2,
    });
  };
  const arc = (command: 'attack' | 'strike', side: Side, duration: number): void => {
    const shape = graphic(`${command}-arc`, side),
      h = layout.fighterHeight;
    const width = command === 'strike' ? 18 : 10;
    // Three concentric strokes preserve the 150-degree/.75H silhouette on
    // the light meadow: cocoa outline, class-coloured edge, solid white core.
    for (const [thickness, ink] of [
      [width + 12, cocoa],
      [width + 6, command === 'strike' ? gold : blue],
      [width, 0xffffff],
    ] as const)
      shape
        .lineStyle(thickness, ink, 1)
        .beginPath()
        .arc(0, 0, h * 0.75, (-Math.PI * 5) / 12, (Math.PI * 5) / 12, false)
        .strokePath();
    if (side === 'b') shape.setScale(-1, 1);
    tween({ targets: shape, angle: { from: side === 'a' ? -30 : 30, to: 0 }, duration });
  };
  const commandCues = (beat: BattleBeat, persistentOnly = false): void => {
    for (const side of ['a', 'b'] as const) {
      const command = persistentOnly ? undefined : beat.commands?.[side],
        skill = beat.skills?.[side];
      if (persistentOnly && skill !== 'firestorm' && skill !== 'sanctuary') continue;
      const hasField = (name: string): boolean =>
        objects.some(
          (object) => persistent.has(object) && object.name === `battle-effect-${name}-${side}`,
        );
      const direction = side === 'a' ? 1 : -1,
        h = layout.fighterHeight;
      if (command === 'attack' || command === 'strike') {
        pose(side, 'attack');
        tween({
          targets: sprites[side],
          x: bases[side].x + direction * h * (command === 'strike' ? 0.4 : 0.28),
          duration: beat.duration / 2,
          yoyo: true,
          ease: 'Cubic.easeOut',
        });
        arc(command, side, beat.duration);
      } else if (command === 'defend' || skill === 'bulwark') {
        shield(skill === 'bulwark' ? 'bulwark' : 'defend', side, beat.duration);
        tween({
          targets: sprites[side],
          x: bases[side].x - direction * h * 0.07,
          duration: beat.duration / 2,
          yoyo: true,
        });
      } else if (command === 'counter' && beat.outcome === 'countered' && side !== beat.attacker) {
        const cue = graphic('counter', side);
        cue
          .lineStyle(5, blue, 1)
          .beginPath()
          .moveTo(-h * 0.35, 0)
          .lineTo(h * 0.35, 0)
          .lineTo(h * 0.15, -h * 0.15)
          .strokePath();
        tween({
          targets: sprites[side],
          x: bases[side].x - direction * h * 0.2,
          duration: beat.duration / 2,
          yoyo: true,
        });
      } else if (skill === 'pickpocket') {
        const cue = graphic('pickpocket', side);
        cue
          .lineStyle(4, blue, 0.85)
          .beginPath()
          .moveTo(-h * 0.3, -h * 0.15)
          .lineTo(h * 0.3, h * 0.15)
          .strokePath();
        tween({
          targets: sprites[side],
          x: bases[side].x + direction * h * 0.3,
          y: bases[side].y - h * 0.12,
          duration: beat.duration / 2,
          yoyo: true,
        });
        if ((beat.stolenGold?.[side] ?? 0) > 0 && !hasField('transfer')) {
          const origin = layout[side === 'a' ? 'right' : 'left'];
          const size = Math.max(24, h * 0.15);
          const factor = Math.min(1, beat.duration / 180);
          for (let index = 0; index < 5; index++) {
            const y = origin.y - h * (0.4 + index * 0.04);
            // Existing atlas coin, with a procedural fallback when the atlas
            // failed to load. Never allocate either for resolved stolen=0.
            const coin =
              scene.textures.exists(ART.icons) && scene.textures.get(ART.icons).has('coin')
                ? scene.add.image(origin.x, y, ART.icons, 'coin').setDisplaySize(size, size)
                : scene.add
                    .graphics()
                    .setPosition(origin.x, y)
                    .fillStyle(gold, 1)
                    .lineStyle(3, cocoa, 1)
                    .fillEllipse(0, 0, size, size)
                    .strokeEllipse(0, 0, size, size);
            coin.setDepth(15).setName(`battle-effect-transfer-${side}`);
            objects.push(coin);
            persistent.add(coin);
            tween({
              targets: coin,
              x: bases[side].x,
              delay: index * 18 * factor,
              duration: 340 * factor,
              ease: 'Sine.easeInOut',
              onUpdate: (handle: Phaser.Tweens.Tween) =>
                coin.setY(y - Math.sin(handle.progress * Math.PI) * h * 0.35),
            });
          }
        }
      } else if (skill === 'firestorm') {
        if (hasField('firestorm')) continue;
        const cue = graphic('firestorm', side, side === 'a' ? 'b' : 'a');
        persistent.add(cue);
        const width = h * 0.24,
          height = h * 1.25,
          bottom = h * 0.5;
        for (let index = 0; index < 3; index++) {
          const x = (index - 1) * h * 0.31 - width / 2;
          cue.fillStyle(orange, 1).fillRect(x, bottom - height, width, height);
          cue.lineStyle(4, cocoa, 1).strokeRect(x, bottom - height, width, height);
          cue.fillStyle(gold, 1).fillRect(x + width * 0.16, bottom - height, width * 0.68, height);
          cue
            .fillStyle(0xffffff, 1)
            .fillRect(x + width * 0.36, bottom - height * 0.96, width * 0.28, height * 0.96);
        }
        // Bright initial rise flash followed by a solid readable field; it
        // persists through impact/damage rather than restarting at each beat.
        tween({
          targets: cue,
          scaleY: { from: 0.4, to: 1 },
          alpha: { from: 1, to: 0.9 },
          duration: Math.min(150, beat.duration),
        });
      } else if (skill === 'sanctuary') {
        if (hasField('sanctuary')) continue;
        const cue = graphic('sanctuary', side);
        persistent.add(cue);
        cue
          .fillStyle(gold, 0.7)
          .fillEllipse(0, h * 0.35, h * 0.95, h * 0.35)
          .lineStyle(14, cocoa, 1)
          .strokeCircle(0, 0, h * 0.48)
          .strokeEllipse(0, h * 0.35, h * 0.95, h * 0.35)
          .lineStyle(8, gold, 1)
          .strokeCircle(0, 0, h * 0.48)
          .strokeEllipse(0, h * 0.35, h * 0.95, h * 0.35);
      }
    }
  };
  return {
    showBeat(beat) {
      if (destroyed) return;
      const staticOnly = beat.duration <= 0 || reducedMotion();
      clear(!staticOnly && (beat.kind === 'impact' || beat.kind === 'damage'));
      // Restore transforms at beat boundaries: cancelled yoyo tweens must not
      // leave a half-dash as the base for the next hit or cast.
      for (const side of ['a', 'b'] as const) {
        const base = bases[side];
        sprites[side]
          .setPosition(base.x, base.y)
          .setScale(base.scaleX, base.scaleY)
          .setAngle(base.angle)
          .clearTint();
        pose(side, 'idle');
      }
      if (staticOnly) return;
      if (beat.kind === 'anticipation') {
        for (const side of ['a', 'b'] as const) {
          if (beat.commands?.[side] !== 'strike') continue;
          pose(side, 'attack');
          tween({
            targets: sprites[side],
            x: bases[side].x - (side === 'a' ? 1 : -1) * layout.fighterHeight * 0.15,
            angle: side === 'a' ? -12 : 12,
            duration: beat.duration,
            ease: 'Sine.easeIn',
          });
        }
      }
      if (beat.kind === 'lunge' || beat.kind === 'impact') commandCues(beat);
      // Keep the two stationary caster fields readable through damage, without
      // repeating dashes/coins or adding any wait to the existing beat clock.
      if (beat.kind === 'damage') commandCues(beat, true);
      if (beat.kind === 'impact' || beat.kind === 'damage') {
        const hitTargets = beat.targets.filter((target) => target.amount > 0);
        for (const target of hitTargets) {
          const pos = layout[target.side === 'a' ? 'left' : 'right'];
          if (target.toHp <= 0) defeated.add(target.side);
          pose(target.side, 'hurt');
          if (beat.kind === 'impact') {
            // Cosmetic hold only: the existing scene beat remains the sole clock.
            // Scale the 50/40 split with bot/online/speed-scaled impacts.
            const factor = Math.min(1, beat.duration / 90);
            scene.tweens.killTweensOf(sprites[target.side]);
            tween({
              targets: sprites[target.side],
              delay: 50 * factor,
              duration: 40 * factor,
              x:
                bases[target.side].x + (target.side === 'a' ? -1 : 1) * layout.fighterHeight * 0.08,
              ease: 'Cubic.easeOut',
            });
            // Keep atlas transparency intact: FILL tint exposes near-transparent
            // texels as a rectangular backdrop. The owned burst and camera flash
            // below provide the impact flash without recolouring the sprite cell.
            const spark = graphic('impact', target.side);
            const heavy = beat.commands?.[beat.attacker ?? 'a'] === 'strike';
            const radius = layout.fighterHeight * (heavy ? 0.42 : 0.3);
            spark.fillStyle(0xffffff, 1).lineStyle(5, cocoa, 1).beginPath();
            for (let index = 0; index < 16; index++) {
              const angle = (index * Math.PI) / 8;
              const r = index % 2 ? radius * 0.4 : radius;
              if (index === 0) spark.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
              else spark.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
            }
            spark.closePath().fillPath().strokePath();
            spark.lineStyle(5, gold, 1).strokeCircle(0, 0, radius * 0.7);
          } else {
            const number = scene.add
              .text(
                pos.x,
                pos.y - layout.fighterHeight - 36,
                t('battle.damage', { value: target.amount }),
                {
                  fontFamily: 'Mitr, sans-serif',
                  fontSize: '24px',
                  color: `#${cream.toString(16).padStart(6, '0')}`,
                  stroke: `#${cocoa.toString(16).padStart(6, '0')}`,
                  strokeThickness: 4,
                },
              )
              .setOrigin(0.5)
              .setDepth(14)
              .setName('battle-effect-damage');
            objects.push(number);
          }
        }
        // Bot/online impacts are <=27ms before the existing .9 scaling;
        // only a full human-speed impact owns a camera flash/shake.
        if (beat.kind === 'impact' && hitTargets.length && !detached && beat.duration >= 60) {
          scene.cameras.main.flash(Math.min(120, beat.duration), 255, 235, 225);
          const heavy = beat.commands?.[beat.attacker ?? 'a'] === 'strike';
          scene.cameras.main.shake(Math.min(120, beat.duration), heavy ? 0.016 : 0.01);
        }
      }
      if (beat.kind === 'result')
        for (const side of ['a', 'b'] as const) pose(side, side === beat.winner ? 'happy' : 'idle');
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clear();
      if (detached) for (const sprite of Object.values(sprites)) sprite.destroy();
      else
        for (const side of ['a', 'b'] as const) {
          const base = bases[side];
          sprites[side]
            .setPosition(base.x, base.y)
            .setScale(base.scaleX, base.scaleY)
            .setAngle(base.angle)
            .setAlpha(base.alpha)
            .clearTint();
          pose(side, 'idle');
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
