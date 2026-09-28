import type Phaser from 'phaser';

export function hop(scene: Phaser.Scene, object: Phaser.GameObjects.Image, speed: number): void {
  if (speed <= 0) return;
  const sprite = object as Phaser.GameObjects.Sprite;
  scene.tweens.add({ targets: sprite, y: sprite.y - 8, duration: 100 * speed, yoyo: true });
}

export function dice(scene: Phaser.Scene, object: Phaser.GameObjects.Image, speed: number): void {
  if (speed <= 0) return;
  scene.tweens.add({ targets: object, angle: object.angle + 360, duration: 350 * speed });
}

export function coinBurst(
  scene: Phaser.Scene,
  object: Phaser.GameObjects.Image,
  speed: number,
): void {
  if (speed <= 0) return;
  const burst = scene.add.graphics().setDepth(7);
  burst.fillStyle(0xffd447, 1);
  burst.fillCircle(object.x, object.y, 5);
  scene.tweens.add({
    targets: burst,
    x: object.x + 4,
    y: object.y - 8,
    scale: 1.7,
    alpha: 0,
    duration: 360 * speed,
    onComplete: () => burst.destroy(),
  });
}

export function shake(scene: Phaser.Scene, speed: number): void {
  if (speed <= 0) return;
  scene.cameras.main.shake(220 * speed, 0.008);
}
