export type BattleRect = { x: number; y: number; width: number; height: number };
/** M5a logical canvas is 1280×720; battle layout is authored at that size. */
export const BATTLE_FRAME = { width: 1280, height: 720 } as const;
export const BATTLE_FIGHTER_HEIGHT = 280;
/** Approved readable target; legacy exported metrics remain for unmigrated callers. */
const VIEWPORT_FIGHTER_HEIGHT = 330;
export const BATTLE_CARD = { width: 180, height: 240 } as const;
export const BATTLE_EXCHANGE_Y = 176;
/** Ground line the fighters stand on (their origin is feet-centred). */
export const BATTLE_GROUND_Y = (BATTLE_FRAME.height * 11) / 12;
export type BattleLayout = {
  /** Uniform viewport metrics shared by sprites, labels and hit effects. */
  fighterHeight: number;
  groundY: number;
  exchangeY: number;
  left: { x: number; y: number };
  right: { x: number; y: number };
  hpLeft: BattleRect;
  hpRight: BattleRect;
  dice: BattleRect;
  cards: BattleRect;
};

/**
 * Cartoon battle composition: 330 px puppets on the 720p stage, uniformly
 * sized at the real expanded viewport (never stretched with its width).
 * Raised feet reserve the bottom command lane; HP and exchange stay above.
 */
export function battleLayout(
  width: number = BATTLE_FRAME.width,
  height: number = BATTLE_FRAME.height,
): BattleLayout {
  const x = width / BATTLE_FRAME.width;
  const y = height / BATTLE_FRAME.height;
  const rect = (left: number, top: number, w: number, h: number): BattleRect => ({
    x: left * x,
    y: top * y,
    width: w * x,
    height: h * y,
  });
  const scale = Math.min(x, y);
  const groundY = 528 * y;
  return {
    // Wide EXPAND stages render at phone CSS scale. Leave breathing room for
    // the existing 3% idle pose without oversizing the approved phone target.
    fighterHeight: (width / height > 1.9 ? 320 : VIEWPORT_FIGHTER_HEIGHT) * scale,
    groundY,
    exchangeY: BATTLE_EXCHANGE_Y * scale,
    left: { x: ((BATTLE_FRAME.width * 17) / 64) * x, y: groundY },
    right: { x: ((BATTLE_FRAME.width * 47) / 64) * x, y: groundY },
    hpLeft: rect(40, 36, 420, 96),
    hpRight: rect(820, 36, 420, 96),
    // Leave room for the dice strip's centred 3px stroke at the canvas edge.
    dice: rect(300, 674, 680, 42),
    cards: rect(540, 430, BATTLE_CARD.width, BATTLE_CARD.height),
  };
}
