import type Phaser from 'phaser';

export type AnimName = 'idle' | 'hop' | 'attack' | 'hurt';
export type Atlas = {
  image: string;
  cell: { width: number; height: number };
  frames: { x: number; y: number; w: number; h: number }[];
  anchor: { x: number; y: number };
  animations: Record<string, { frames: number[]; fps: number; loop: boolean }>;
};

export function sheetKey(
  kind: 'hero' | 'token' | 'portrait' | 'monster' | 'fx' | 'board',
  id: string,
): string {
  return `${kind}-${id}`;
}

function validAtlas(value: unknown, width: number, height: number): value is Atlas {
  if (
    !value ||
    typeof value !== 'object' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    return false;
  const atlas = value as Partial<Atlas>;
  const positive = (n: unknown): n is number =>
    typeof n === 'number' && Number.isInteger(n) && n > 0;
  const nonnegative = (n: unknown): n is number =>
    typeof n === 'number' && Number.isInteger(n) && n >= 0;
  if (
    typeof atlas.image !== 'string' ||
    !atlas.image ||
    !atlas.cell ||
    !positive(atlas.cell.width) ||
    !positive(atlas.cell.height) ||
    !atlas.anchor ||
    !nonnegative(atlas.anchor.x) ||
    !nonnegative(atlas.anchor.y) ||
    !Array.isArray(atlas.frames) ||
    atlas.frames.length === 0 ||
    !atlas.animations ||
    typeof atlas.animations !== 'object' ||
    Array.isArray(atlas.animations)
  )
    return false;
  if (
    !atlas.frames.every(
      (frame) =>
        frame &&
        nonnegative(frame.x) &&
        nonnegative(frame.y) &&
        positive(frame.w) &&
        positive(frame.h) &&
        frame.x + frame.w <= width &&
        frame.y + frame.h <= height,
    )
  )
    return false;
  return Object.entries(atlas.animations).every(
    ([name, animation]) =>
      name.length > 0 &&
      animation &&
      Array.isArray(animation.frames) &&
      animation.frames.length > 0 &&
      animation.frames.every((frame) => nonnegative(frame) && frame < atlas.frames!.length) &&
      positive(animation.fps) &&
      typeof animation.loop === 'boolean',
  );
}

/** Validate before removing a legacy image; failures must never abort BootScene. */
export function registerAtlas(scene: Phaser.Scene, key: string, atlas: unknown): boolean {
  let legacy: HTMLImageElement | undefined;
  let replaced = false;
  try {
    const sourceTexture = scene.textures.get(`${key}-atlas-image`);
    if (sourceTexture.key === '__MISSING') throw new Error('atlas image missing');
    const source = sourceTexture.getSourceImage() as HTMLImageElement;
    if (!validAtlas(atlas, source.width, source.height)) throw new Error('invalid atlas data');
    if (scene.textures.exists(key)) {
      legacy = scene.textures.get(key).getSourceImage() as HTMLImageElement;
      scene.textures.remove(key);
    }
    replaced = true;
    // A Texture passed to addSpriteSheet retains source.key rather than key.
    const texture = scene.textures.addImage(key, source);
    if (!texture) throw new Error('could not add atlas image');
    atlas.frames.forEach((frame, index) => {
      if (texture.add(index, 0, frame.x, frame.y, frame.w, frame.h) === null)
        throw new Error(`could not add frame ${index}`);
    });
    for (const [name, animation] of Object.entries(atlas.animations)) {
      scene.anims.create({
        key: `${key}:${name}`,
        frames: animation.frames.map((frame) => ({ key, frame })),
        frameRate: animation.fps,
        repeat: animation.loop ? -1 : 0,
      });
    }
    return true;
  } catch {
    if (replaced) {
      if (scene.textures.exists(key)) scene.textures.remove(key);
      if (legacy) scene.textures.addImage(key, legacy);
    }
    console.warn('[art] fallback', key);
    return false;
  }
}

export function hasAnim(scene: Phaser.Scene, key: string, anim: string): boolean {
  return scene.anims.exists(`${key}:${anim}`);
}
