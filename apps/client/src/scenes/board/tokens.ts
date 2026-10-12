import type Phaser from 'phaser';
import { ART } from '../../art/manifest';

/** Above every board layer (painted map -10, road -5, tiles 0, buildings -2);
 * only selection rings (40+) draw over tokens. */
export const TOKEN_DEPTH = 30;

/** Board token target height in map pixels (card T11b). */
const TOKEN_HEIGHT = 72;

/** Flat-shape fallback per Global Constraints: palette grey square. */
const FALLBACK_TINT = 0x8e8e93;

export function tokenOffsets(countAtSpace: number): { x: number; y: number }[] {
  if (countAtSpace <= 0) return [];
  if (countAtSpace === 1) return [{ x: 0, y: 0 }];
  // One baseline keeps silhouettes readable; the widest four-seat row reaches
  // 99 map pixels from the tile centre (the approved prototype).
  const row =
    countAtSpace === 2 ? [-36, 36] : countAtSpace === 3 ? [-66, 0, 66] : [-99, -33, 33, 99];
  return row.slice(0, countAtSpace).map((x) => ({ x, y: 0 }));
}

/** Ignore tiny horizontal deltas so vertical travel keeps the current facing. */
export function tokenFacing(token: Phaser.GameObjects.Image, destinationX: number): boolean {
  return destinationX < token.x - 6 ? true : destinationX > token.x + 6 ? false : token.flipX;
}

/** Cosmetic pose fitted inside the existing hop, never a new awaited tween.
 * Local turns take 90ms in + 90ms out; catch-up compresses to its hop budget. */
export function createHopPose(
  token: Phaser.GameObjects.Image,
  destinationX: number,
  hopMs: number,
): {
  update(progress: number): void;
  reset(): void;
} {
  const baseX = token.scaleX,
    baseY = token.scaleY;
  const facing = tokenFacing(token, destinationX);
  const turning = facing !== token.flipX;
  const turnMs = Math.min(180, hopMs);
  let flipped = !turning;
  return {
    update(k) {
      if (turning) {
        const turn = Math.min(1, (k * hopMs) / turnMs);
        const half = turn < 0.5 ? turn * 2 : (1 - turn) * 2;
        token.scaleX = baseX * (1 - 0.95 * Math.sin((Math.PI * half) / 2));
        if (!flipped && turn >= 0.5) {
          token.setFlipX(facing);
          flipped = true;
        }
      }
      token.scaleY =
        baseY *
        (k < 0.2
          ? 1 - 0.18 * Math.sin((Math.PI * k) / 0.2)
          : k >= 0.85
            ? 0.88 + (0.12 * (k - 0.85)) / 0.15
            : 1);
      token.angle = Math.sin(Math.PI * 2 * k) * 12 * (token.flipX ? -1 : 1);
    },
    reset() {
      token.scaleX = baseX;
      token.scaleY = baseY;
      token.angle = 0;
    },
  };
}

/** Offsets for tokens in seat order, spread by how many share each space. */
export function tokenLayout(positions: number[]): { x: number; y: number }[] {
  const totals = new Map<number, number>();
  for (const pos of positions) totals.set(pos, (totals.get(pos) ?? 0) + 1);
  const seen = new Map<number, number>();
  return positions.map((pos) => {
    const index = seen.get(pos) ?? 0;
    seen.set(pos, index + 1);
    return tokenOffsets(totals.get(pos)!)[index]!;
  });
}

/**
 * Hero token as the cartoon art: the class atlas' `idle` pose, feet anchored
 * on the space, 72 map px tall with the frame's aspect ratio. Missing art
 * degrades to the flat grey shape (Global Constraints) with the standard
 * `[art] fallback` warn — never a crash.
 */
export function createHeroToken(
  scene: Phaser.Scene,
  classId: string,
  x: number,
  y: number,
): Phaser.GameObjects.Image {
  const key = ART.heroes[classId as keyof typeof ART.heroes] ?? '';
  if (key && scene.textures.exists(key) && scene.textures.get(key).has('idle')) {
    const frame = scene.textures.get(key).get('idle');
    const height = frame.height || TOKEN_HEIGHT;
    const width = Math.round((frame.width / height) * TOKEN_HEIGHT);
    return scene.add
      .image(x, y, key, 'idle')
      .setOrigin(0.5, 1)
      .setDisplaySize(width, TOKEN_HEIGHT)
      .setDepth(TOKEN_DEPTH);
  }
  console.warn('[art] fallback', key);
  return scene.add
    .image(x, y, '__WHITE')
    .setDisplaySize(28, 28)
    .setTint(FALLBACK_TINT)
    .setDepth(TOKEN_DEPTH);
}
