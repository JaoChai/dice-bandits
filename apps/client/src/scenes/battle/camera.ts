import type Phaser from 'phaser';
import type { BattleLayout } from './layout';
import type { BattleFighters } from './fighters';

export type BattlePicker = {
  side: 'a' | 'b';
  role: 'attack' | 'defense';
  ownership: 'local-human' | 'remote-human' | 'bot' | 'ghost' | 'none';
};
export type PickerSnapshot = BattlePicker & { battleId: string; halfKey: string };
const pickers = new WeakMap<
  HTMLElement,
  { value: PickerSnapshot | null; listeners: Set<(value: PickerSnapshot | null) => void> }
>();
function channel(root: HTMLElement) {
  let entry = pickers.get(root);
  if (!entry) {
    entry = { value: null, listeners: new Set() };
    pickers.set(root, entry);
  }
  return entry;
}
/** Typed, root-scoped ownership. Never infers a local seat from DOM attributes. */
export function publishBattlePicker(root: HTMLElement, value: PickerSnapshot | null): void {
  const entry = channel(root);
  entry.value = value;
  entry.listeners.forEach((listener) => listener(value));
}
export function observeBattlePicker(
  root: HTMLElement,
  listener: (value: PickerSnapshot | null) => void,
): () => void {
  const entry = channel(root);
  entry.listeners.add(listener);
  listener(entry.value);
  return () => entry.listeners.delete(listener);
}

export function pickerAppearance(picker: BattlePicker, layout: BattleLayout) {
  const human = picker.ownership === 'local-human' || picker.ownership === 'remote-human';
  return {
    ring: human
      ? {
          x: layout[picker.side === 'a' ? 'left' : 'right'].x,
          y: layout.groundY,
          colour: picker.role === 'attack' ? 0xf5c51c : 0x8fd7df,
        }
      : null,
    tints: {
      a: human && picker.side !== 'a' ? 0xaaaaaa : 0xffffff,
      b: human && picker.side !== 'b' ? 0xaaaaaa : 0xffffff,
    },
    thinking: picker.ownership === 'remote-human' ? picker.side : null,
    dimBackdrop: picker.ownership === 'local-human',
  };
}

/** Owns exactly one camera tween. All cosmetics run inside existing beat waits. */
export function createBattleCamera(scene: Phaser.Scene) {
  let tween: Phaser.Tweens.Tween | undefined;
  const stop = () => {
    tween?.stop();
    tween = undefined;
  };
  const reset = () => {
    stop();
    // CameraManager may already have disposed main before Scene.shutdown.
    scene.cameras.main?.setZoom(1).setScroll(0, 0);
  };
  return {
    reset,
    pick(picker: BattlePicker, reduced: boolean): void {
      if (reduced || picker.ownership !== 'local-human') {
        reset();
        return;
      }
      stop();
      tween = scene.tweens.add({
        targets: scene.cameras.main,
        zoom: 1.12,
        scrollX: scene.cameras.main.width * 0.015 * (picker.side === 'a' ? -1 : 1),
        scrollY: 0,
        duration: 330,
        ease: 'Sine.easeInOut',
      });
    },
    reveal(reduced: boolean): void {
      if (reduced) {
        reset();
        return;
      }
      stop();
      tween = scene.tweens.add({
        targets: scene.cameras.main,
        zoom: 1,
        scrollX: 0,
        scrollY: 0,
        duration: 180,
        ease: 'Sine.easeInOut',
      });
    },
    impact(mode: 'human' | 'bot' | 'online', reduced: boolean): void {
      reset();
      if (mode !== 'human' || reduced) return;
      tween = scene.tweens.add({
        targets: scene.cameras.main,
        zoom: 1.075,
        duration: 50,
        yoyo: true,
        ease: 'Quad.easeOut',
      });
    },
  };
}

/** CANVAS ignores Sprite.tint. A black alpha silhouette follows the original
 * sprite on both renderers without replacing its atlas, frame or mount scale. */
function shadeFighter(scene: Phaser.Scene, sprite: Phaser.GameObjects.Sprite, tint: number) {
  if (tint === 0xffffff) return () => {};
  const original = sprite.texture;
  const key = `battle-shade:${original.key}`;
  if (!scene.textures.exists(key)) {
    const image = original.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const shade = scene.textures.addCanvas(key, canvas)!;
    for (const name of original.getFrameNames()) {
      const frame = original.get(name);
      shade.add(name, 0, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight);
    }
  }
  const overlay = scene.add.image(sprite.x, sprite.y, key, sprite.frame.name);
  const sync = () => {
    if (!sprite.scene || !overlay.scene) return;
    overlay
      .setFrame(sprite.frame.name)
      .setPosition(sprite.x, sprite.y)
      .setOrigin(sprite.originX, sprite.originY)
      .setScale(sprite.scaleX, sprite.scaleY)
      .setRotation(sprite.rotation)
      .setFlip(sprite.flipX, sprite.flipY)
      .setAlpha(sprite.alpha / 3)
      .setVisible(sprite.visible)
      .setDepth(sprite.depth + 0.1);
  };
  sync();
  scene.events.on('prerender', sync);
  return () => {
    scene.events.off('prerender', sync);
    overlay.destroy();
  };
}

/** Ring is on the ground, not a translucent silhouette that hides the artwork. */
export function drawPickerAppearance(
  scene: Phaser.Scene,
  fighters: BattleFighters,
  layout: BattleLayout,
  picker: BattlePicker,
) {
  const appearance = pickerAppearance(picker, layout);
  const objects: Array<Phaser.GameObjects.Graphics | Phaser.GameObjects.Text> = [];
  const clearA = shadeFighter(scene, fighters.a, appearance.tints.a);
  const clearB = shadeFighter(scene, fighters.b, appearance.tints.b);
  if (appearance.dimBackdrop) {
    const shade = scene.add.graphics().setDepth(1).setName('battle-picker-shade');
    shade
      .fillStyle(0x5c3317, 0.22)
      .fillRect(0, 0, scene.cameras.main.width, scene.cameras.main.height);
    objects.push(shade);
  }
  if (appearance.ring) {
    const { x, y, colour } = appearance.ring;
    const ring = scene.add.graphics().setDepth(4).setName('battle-picker-ring');
    ring
      .fillStyle(colour, 0.25)
      .fillEllipse(x, y, layout.fighterHeight * 0.9, layout.fighterHeight * 0.14);
    ring
      .lineStyle(5, colour, 1)
      .strokeEllipse(x, y, layout.fighterHeight * 0.9, layout.fighterHeight * 0.14);
    objects.push(ring);
  }
  if (appearance.thinking) {
    const home = layout[appearance.thinking === 'a' ? 'left' : 'right'];
    objects.push(
      scene.add
        .text(home.x, home.y - layout.fighterHeight - 16, '…', {
          fontFamily: 'Mitr, sans-serif',
          fontSize: '24px',
          color: '#5c3317',
          backgroundColor: '#fffdf5',
          padding: { x: 10, y: 2 },
        })
        .setOrigin(0.5, 1)
        .setDepth(6)
        .setName('battle-picker-thinking'),
    );
  }
  return () => {
    objects.forEach((object) => object.destroy());
    clearA();
    clearB();
  };
}
