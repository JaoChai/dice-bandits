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
  /** Compact 72px cartoon footprint: 56px horizontal and 52px vertical
   * separation leaves <=28% overlap even for a square token. Feet remain
   * within one tile's 48px radius; single tokens still sit at its centre. */
  if (countAtSpace === 2)
    return [
      { x: -28, y: 0 },
      { x: 28, y: 0 },
    ];
  return [
    { x: -28, y: -26 },
    { x: 28, y: -26 },
    { x: -28, y: 26 },
    { x: 28, y: 26 },
  ].slice(0, countAtSpace);
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
