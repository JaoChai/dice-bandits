import type Phaser from 'phaser';
import type { GameEvent } from '@dice-bandits/engine';
import { WORLD } from './camera';

/** Called by local playback only AFTER main's centre dice result settles.
 * One owner for both pop and fade; no timer, additional awaited work or RNG. */
export function createDiePop(
  scene: Phaser.Scene,
  token: Phaser.GameObjects.Image,
  tag: () => Phaser.GameObjects.Text | undefined,
  event: GameEvent,
  speed: number,
): { follow(): void; destroy(): void } | undefined {
  if (speed <= 0 || !scene.textures.exists('art:icons')) return;
  const { value, dice } = event.params;
  const frame =
    dice === 1 && typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6
      ? `dieFace${value}`
      : 'die';
  if (!scene.textures.get('art:icons').has(frame)) return;
  const icon = scene.add
    .image(token.x, token.y - token.displayHeight, 'art:icons', frame)
    .setDisplaySize(40, 40)
    .setDepth(60)
    .setName('roll-die')
    .setAlpha(0);
  const baseX = icon.scaleX,
    baseY = icon.scaleY;
  const pop = { growth: 0 };
  let alive = true;
  const follow = (): void => {
    if (!alive) return;
    const label = tag();
    const top = label ? label.y - label.displayHeight : token.y - token.displayHeight;
    // 26px inset includes Back.easeOut's scale overshoot, just like full-name
    // packing uses the whole rendered label rather than its anchor point.
    const view = scene.cameras.main.worldView;
    const left = Math.max(0, view?.x ?? 0) + 26;
    const right = Math.min(WORLD.width, view ? view.x + view.width : WORLD.width) - 26;
    const upper = Math.max(0, view?.y ?? 0) + 26;
    const lower = Math.min(WORLD.height, view ? view.y + view.height : WORLD.height) - 26;
    const k = pop.growth;
    const from = token.y - token.displayHeight;
    icon.setPosition(
      Math.max(left, Math.min(right, token.x)),
      Math.max(upper, Math.min(lower, from + (top - 26 - from) * k)),
    );
  };
  const destroy = (): void => {
    if (!alive) return;
    alive = false;
    rise?.remove();
    fade?.remove();
    icon.destroy();
  };
  icon.scaleX = baseX * 0.05;
  icon.scaleY = baseY * 0.05;
  follow();
  const rise = scene.tweens.add({
    targets: pop,
    growth: 1,
    duration: 220 * speed,
    ease: 'Back.easeOut',
    onUpdate: () => {
      if (!alive) return;
      icon.scaleX = baseX * (0.05 + 0.95 * pop.growth);
      icon.scaleY = baseY * (0.05 + 0.95 * pop.growth);
      icon.setAlpha(Math.min(1, pop.growth));
      follow();
    },
  });
  const fade = scene.tweens.add({
    targets: icon,
    alpha: 0,
    delay: 900 * speed,
    duration: 250 * speed,
    onComplete: destroy,
  });
  return { follow, destroy };
}
