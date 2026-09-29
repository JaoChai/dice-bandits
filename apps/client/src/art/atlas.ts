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

export function registerAtlas(scene: Phaser.Scene, key: string, atlas: Atlas): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  // Passing a Texture to addSpriteSheet makes Phaser keep source.key, so `key`
  // would never exist. Register the raw image under `key` and add frames.
  const source = scene.textures.get(`${key}-atlas-image`).getSourceImage() as HTMLImageElement;
  const texture = scene.textures.addImage(key, source);
  if (!texture) throw new Error(`Could not register atlas: ${key}`);

  atlas.frames.forEach((frame, index) => {
    texture.add(index, 0, frame.x, frame.y, frame.w, frame.h);
  });

  for (const [name, animation] of Object.entries(atlas.animations)) {
    scene.anims.create({
      key: `${key}:${name}`,
      frames: animation.frames.map((frame) => ({ key, frame })),
      frameRate: animation.fps,
      repeat: animation.loop ? -1 : 0,
    });
  }
}

export function hasAnim(scene: Phaser.Scene, key: string, anim: string): boolean {
  return scene.anims.exists(`${key}:${anim}`);
}
