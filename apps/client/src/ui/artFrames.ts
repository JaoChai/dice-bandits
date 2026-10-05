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
 * Inline CSS that shows `frame` of `/art/<image>` fitted into whatever square
 * box its element has. `background-size` scales the sheet so the frame's
 * larger side fills 100% of the box; `background-position` shifts the sheet so
 * the frame sits centred in it. Both are percentages of the element, so ONE
 * inline style is correct for every CSS size the element gets — the 40px
 * corner/setup portraits, the 32px ≤700px variant, the 72px pass screen and
 * any future media query (a px crop is pinned to one box size and clips the
 * rest). The centred window also keeps neighbouring frames of the sheet out
 * of the crop. Pair with `background-repeat: no-repeat` (styles.css) — the
 * rest of the sheet is cropped by the box.
 */
export function artBackground(
  image: string,
  frame: ArtFrame,
  sheetW: number,
  sheetH: number,
): string {
  const fmax = Math.max(frame.w, frame.h);
  const padX = (fmax - frame.w) / 2;
  const padY = (fmax - frame.h) / 2;
  const pct = (value: number): number => Math.round(value * 1000) / 1000;
  return (
    `background-image:url('/art/${image}.webp');` +
    `background-size:${pct((sheetW / fmax) * 100)}% ${pct((sheetH / fmax) * 100)}%;` +
    `background-position:${pct(((frame.x - padX) / (sheetW - fmax)) * 100)}% ${pct(((frame.y - padY) / (sheetH - fmax)) * 100)}%`
  );
}

/** Portrait of `classId` fitted to its element's box (HUD, setup, pass). */
export function portraitStyle(classId: ClassId): string {
  return artBackground(`hero-${classId}`, PORTRAIT_FRAMES[classId], HERO_SHEET.w, HERO_SHEET.h);
}

/** Card icon `name` fitted to its element's box (battle command cards). */
export function iconStyle(name: IconName): string {
  return artBackground('icons', ICON_FRAMES[name], ICON_SHEET.w, ICON_SHEET.h);
}
