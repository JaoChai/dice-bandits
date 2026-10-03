export type BattleRect = { x: number; y: number; width: number; height: number };
/** M5a logical canvas is 1280×720; battle layout is authored at that size. */
export const BATTLE_FRAME = { width: 1280, height: 720 } as const;
export const BATTLE_FIGHTER_HEIGHT = 280;
export const BATTLE_CARD = { width: 180, height: 240 } as const;
export const BATTLE_EXCHANGE_Y = 176;
/** Ground line the fighters stand on (their origin is feet-centred). */
export const BATTLE_GROUND_Y = (BATTLE_FRAME.height * 11) / 12;
export type BattleLayout = {
  left: { x: number; y: number };
  right: { x: number; y: number };
  hpLeft: BattleRect;
  hpRight: BattleRect;
  dice: BattleRect;
  cards: BattleRect;
};

/**
 * Cartoon battle composition on the 1280×720 stage: 280 px puppets standing
 * on the ground line, dice strip below their feet, command cards stacked
 * bottom-centre, HP strips along the top corners.
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
  const groundY = BATTLE_GROUND_Y * y;
  return {
    left: { x: ((BATTLE_FRAME.width * 17) / 64) * x, y: groundY },
    right: { x: ((BATTLE_FRAME.width * 47) / 64) * x, y: groundY },
    hpLeft: rect(40, 36, 420, 96),
    hpRight: rect(820, 36, 420, 96),
    dice: rect(300, 678, 680, 42),
    cards: rect(540, 430, BATTLE_CARD.width, BATTLE_CARD.height),
  };
}
