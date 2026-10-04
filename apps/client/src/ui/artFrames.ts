import type { ClassId } from '@dice-bandits/engine';

/**
 * M5a Task 11a: frame tables for the DOM consumers of the cartoon sheets in
 * `public/art/`. Values are copied from the generated `hero-<class>.json` /
 * `icons.json`; `test/ui/artFrames.test.ts` re-reads those files so these
 * copies cannot drift.
 */

export type ArtFrame = {
  x: number;
  y: number;
  w: number;
  h: number;
  anchorX: number;
  anchorY: number;
};

/** `hero-<class>.webp` is 1920×300; frame `portrait` per `hero-<class>.json`. */
export const PORTRAIT_FRAMES: Record<ClassId, ArtFrame> = {
  knight: { x: 1659, y: 89, w: 201, h: 211, anchorX: 100, anchorY: 211 },
  thief: { x: 1662, y: 76, w: 195, h: 224, anchorX: 97, anchorY: 224 },
  mage: { x: 1658, y: 91, w: 204, h: 209, anchorX: 102, anchorY: 209 },
  cleric: { x: 1669, y: 113, w: 182, h: 187, anchorX: 91, anchorY: 187 },
};

/** `icons.webp` is 512×512; frames the UI uses. */
export const ICON_FRAMES = {
  sword: { x: 271, y: 9, w: 97, h: 119, anchorX: 48, anchorY: 119 },
  shield: { x: 398, y: 13, w: 99, h: 115, anchorX: 49, anchorY: 115 },
  scroll: { x: 137, y: 136, w: 110, h: 120, anchorX: 55, anchorY: 120 },
  star: { x: 7, y: 275, w: 113, h: 109, anchorX: 56, anchorY: 109 },
  skull: { x: 140, y: 278, w: 103, h: 106, anchorX: 51, anchorY: 106 },
  piggy: { x: 256, y: 142, w: 127, h: 114, anchorX: 63, anchorY: 114 },
  coin: { x: 141, y: 24, w: 102, h: 104, anchorX: 51, anchorY: 104 },
} as const satisfies Record<string, ArtFrame>;

export type IconName = keyof typeof ICON_FRAMES;

/** Battle pick → card icon (Lead decision, shown to the owner at checkpoint 3). */
export const CARD_ICON: Record<
  'attack' | 'strike' | 'secret' | 'defend' | 'counter' | 'item',
  IconName
> = {
  attack: 'sword',
  strike: 'star',
  secret: 'scroll',
  defend: 'shield',
  counter: 'skull',
  item: 'piggy',
};

const HERO_SHEET = { w: 1920, h: 300 } as const;
const ICON_SHEET = { w: 512, h: 512 } as const;

/**
 * Inline CSS that shows `frame` of `/art/<image>` fitted into a square box of
 * `boxPx`: the whole sheet is scaled so the frame fills the box, then shifted
 * so the frame lands on the box origin. Pair with
 * `background-repeat: no-repeat` (styles.css) — the rest of the sheet is
 * cropped by the box.
 */
export function artBackground(
  image: string,
  frame: ArtFrame,
  sheetW: number,
  sheetH: number,
  boxPx: number,
): string {
  const scale = boxPx / Math.max(frame.w, frame.h);
  const width = Math.round(sheetW * scale);
  const height = Math.round(sheetH * scale);
  const left = Math.round(frame.x * scale);
  const top = Math.round(frame.y * scale);
  return (
    `background-image:url('/art/${image}.webp');` +
    `background-size:${width}px ${height}px;` +
    `background-position:${-left}px ${-top}px`
  );
}

/** Portrait of `classId` fitted into a square `boxPx` box (HUD, setup, pass). */
export function portraitStyle(classId: ClassId, boxPx: number): string {
  return artBackground(
    `hero-${classId}`,
    PORTRAIT_FRAMES[classId],
    HERO_SHEET.w,
    HERO_SHEET.h,
    boxPx,
  );
}

/** Card icon `name` fitted into a square `boxPx` box (battle command cards). */
export function iconStyle(name: IconName, boxPx: number): string {
  return artBackground('icons', ICON_FRAMES[name], ICON_SHEET.w, ICON_SHEET.h, boxPx);
}
