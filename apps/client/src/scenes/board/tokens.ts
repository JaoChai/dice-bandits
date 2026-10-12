import type Phaser from 'phaser';
import { ART } from '../../art/manifest';

/** Above every board layer (painted map -10, road -5, tiles 0, buildings -2)
 * and seat ovals (29); full-name tags (44+) draw over tokens. */
export const TOKEN_DEPTH = 30;

/** Board token target height in map pixels (card T11b). */
export const TOKEN_HEIGHT = 72;

/** Flat-shape fallback per Global Constraints: palette grey square. */
const FALLBACK_TINT = 0x8e8e93;

export function tokenOffsets(countAtSpace: number): { x: number; y: number }[] {
  if (countAtSpace <= 0) return [];
  if (countAtSpace === 1) return [{ x: 0, y: 0 }];
  // Count-only hints retained for compatibility. Board rendering instead
  // uses crowdLayout's measured widths and whole-foreground clearance.
  const row =
    countAtSpace === 2 ? [-26, 26] : countAtSpace === 3 ? [-36, 0, 36] : [-52.5, -17.5, 17.5, 52.5];
  return row.slice(0, countAtSpace).map((x) => ({ x, y: 0 }));
}

export type CrowdPlacement = { x: number; y: number; scale: number; depth: number };

/** Measured idle widths at normal TOKEN_HEIGHT, in seat order. Prefer the
 * original left-to-right depth. If that cannot fit, climb towards the active
 * seat instead (Lead decision #2); never shrink below the approved 0.85 here.
 * Each back sprite owns ONE total occlusion budget, not a budget per pair. */
export function crowdLayout(widths: number[], active: number): CrowdPlacement[] {
  if (widths.length < 2) return widths.map(() => ({ x: 0, y: 0, scale: 1, depth: TOKEN_DEPTH }));
  const scale = 0.85;
  const sizes = widths.map((w) => w * scale);
  const pack = (depths: number[]) => {
    const owners = sizes.slice(1).map((_, i) => (depths[i]! < depths[i + 1]! ? i : i + 1));
    const caps = owners.map((back, i) =>
      Math.min(sizes[back]! * 0.299, Math.min(sizes[i]!, sizes[i + 1]!) * 0.349),
    );
    const totals = sizes.map((_, i) =>
      caps.reduce((sum, cap, edge) => sum + (owners[edge] === i ? cap : 0), 0),
    );
    const overlaps = caps.map(
      (cap, edge) => cap * Math.min(1, (sizes[owners[edge]!]! * 0.299) / totals[owners[edge]!]!),
    );
    const minimum = sizes.reduce((sum, w) => sum + w, 0) - overlaps.reduce((sum, w) => sum + w, 0);
    return { depths, overlaps, minimum };
  };
  let packed = pack(sizes.map((_, i) => (i === active ? 36 : TOKEN_DEPTH + i)));
  if (packed.minimum > 155)
    packed = pack(
      sizes.map((_, i) => (i === active ? 36 : TOKEN_DEPTH + (i < active ? i : sizes.length - i))),
    );
  const preferredSpan = widths.length === 2 ? 52 : widths.length === 3 ? 72 : 105;
  const wanted = Math.min(
    155,
    Math.max(packed.minimum, preferredSpan + (sizes[0]! + sizes.at(-1)!) / 2),
  );
  const gap = (wanted - packed.minimum) / (sizes.length - 1);
  let left = -wanted / 2;
  return sizes.map((w, i) => {
    const x = left + w / 2;
    left += w + gap - (packed.overlaps[i] ?? 0);
    return { x, y: 0, scale, depth: packed.depths[i]! };
  });
}

/** Full measured tags, kept in hero order. One baseline except when the
 * complete row exceeds the map; then choose the narrowest two-row split. */
export function crowdTagLayout(
  widths: number[],
  rowHeight: number,
  centreX: number,
  heroTop: number,
  mapWidth: number,
): { x: number; y: number }[] {
  const gap = 8;
  const width = (row: number[]) => row.reduce((sum, w) => sum + w, 0) + gap * (row.length - 1);
  let rows = [widths];
  if (width(widths) > mapWidth) {
    const splits = widths.slice(1).map((_, i) => [widths.slice(0, i + 1), widths.slice(i + 1)]);
    rows = splits.sort((a, b) => Math.max(...a.map(width)) - Math.max(...b.map(width)))[0]!;
  }
  return rows.flatMap((row, index) => {
    let left = Math.max(0, Math.min(mapWidth - width(row), centreX - width(row) / 2));
    const y = heroTop - 10 - (rows.length - index - 1) * (rowHeight + gap);
    return row.map((w) => {
      const x = left + w / 2;
      left += w + gap;
      return { x, y };
    });
  });
}

/** Ignore tiny horizontal deltas so vertical travel keeps the current facing. */
export function tokenFacing(token: Phaser.GameObjects.Image, destinationX: number): boolean {
  return destinationX < token.x - 6 ? true : destinationX > token.x + 6 ? false : token.flipX;
}

/** Frames share handedness in all four shipped atlases (weapon, hair and
 * costume asymmetries were compared, not the happy pose's closed eyes).
 * Size from the new frame's aspect, retaining the seat's baseline height and
 * the current pose deformation. Never reuse an idle width for a happy frame. */
function createFramePose(token: Phaser.GameObjects.Image) {
  const baseX = token.scaleX,
    baseY = token.scaleY;
  const height = token.displayHeight;
  return (frame: 'idle' | 'happy', x = 1, y = 1): void => {
    if (token.texture?.has('idle')) {
      const wanted = token.texture.has(frame) ? frame : 'idle';
      if (token.frame.name !== wanted) token.setFrame(wanted);
      token.setDisplaySize((height * token.frame.width) / token.frame.height, height);
      token.scaleX *= x;
      token.scaleY *= y;
    } else {
      token.scaleX = baseX * x;
      token.scaleY = baseY * y;
    }
  };
}

/** One progress clock, inside the existing 350ms roll pause. No frame timers
 * or detached hero tweens survive cancellation. */
export function createRollPose(token: Phaser.GameObjects.Image) {
  const frame = createFramePose(token);
  const baseY = token.y;
  const out = (k: number): number => 1 - (1 - k) ** 2;
  const bounce = (k: number): number => {
    if (k < 1 / 2.75) return 7.5625 * k * k;
    if (k < 2 / 2.75) return 7.5625 * (k - 1.5 / 2.75) ** 2 + 0.75;
    if (k < 2.5 / 2.75) return 7.5625 * (k - 2.25 / 2.75) ** 2 + 0.9375;
    return 7.5625 * (k - 2.625 / 2.75) ** 2 + 0.984375;
  };
  return {
    update(k: number): void {
      const ms = Math.max(0, Math.min(1, k)) * 350;
      let x: number,
        y: number,
        lift = 0;
      if (ms < 110) {
        const t = out(ms / 110);
        x = 1 + 0.1 * t;
        y = 1 - 0.18 * t;
      } else if (ms < 240) {
        const t = out((ms - 110) / 130);
        x = 1.1 - 0.15 * t;
        y = 0.82 + 0.26 * t;
        lift = 18 * t;
      } else {
        const t = bounce((ms - 240) / 110);
        x = 0.95 + 0.05 * t;
        y = 1.08 - 0.08 * t;
        lift = 18 * (1 - t);
      }
      frame(ms >= 110 && ms < 330 ? 'happy' : 'idle', x, y);
      token.y = baseY - lift;
      token.angle = 0;
    },
    reset(): void {
      frame('idle');
      token.y = baseY;
      token.angle = 0;
    },
  };
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
  const frame = createFramePose(token);
  const facing = tokenFacing(token, destinationX);
  const turning = facing !== token.flipX;
  const turnMs = Math.min(180, hopMs);
  let flipped = !turning;
  return {
    update(k) {
      let squeeze = 1;
      if (turning) {
        const turn = Math.min(1, (k * hopMs) / turnMs);
        const half = turn < 0.5 ? turn * 2 : (1 - turn) * 2;
        squeeze = 1 - 0.95 * Math.sin((Math.PI * half) / 2);
        if (!flipped && turn >= 0.5) {
          token.setFlipX(facing);
          flipped = true;
        }
      }
      const squash =
        k < 0.2
          ? 1 - 0.18 * Math.sin((Math.PI * k) / 0.2)
          : k >= 0.85
            ? 0.88 + (0.12 * (k - 0.85)) / 0.15
            : 1;
      frame(k > 0.22 && k < 0.82 ? 'happy' : 'idle', squeeze, squash);
      token.angle = Math.sin(Math.PI * 2 * k) * 12 * (token.flipX ? -1 : 1);
    },
    reset() {
      frame('idle');
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
