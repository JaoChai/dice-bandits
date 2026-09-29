export type BattleRect = { x: number; y: number; width: number; height: number };
export const BATTLE_EXCHANGE_Y = 112;
export type BattleLayout = {
  left: { x: number; y: number };
  right: { x: number; y: number };
  hpLeft: BattleRect;
  hpRight: BattleRect;
  dice: BattleRect;
  cards: BattleRect;
};

export function battleLayout(width = 640, height = 360): BattleLayout {
  const x = width / 640;
  const y = height / 360;
  const rect = (left: number, top: number, w: number, h: number): BattleRect => ({
    x: left * x,
    y: top * y,
    width: w * x,
    height: h * y,
  });
  return {
    left: { x: 198 * x, y: 234 * y },
    right: { x: 442 * x, y: 234 * y },
    hpLeft: rect(10, 8, 202, 49),
    hpRight: rect(428, 8, 202, 49),
    dice: rect(90, 244, 460, 40),
    cards: rect(92, 292, 456, 64),
  };
}
