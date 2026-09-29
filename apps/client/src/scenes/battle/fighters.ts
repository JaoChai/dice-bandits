import type Phaser from 'phaser';
import type { Combatant, GameState } from '@dice-bandits/engine';
import { hasAnim } from '../../art/atlas';
import { reducedMotion } from '../../art/motion';
import { MONSTER_SHEETS } from '../../art/tables';
import type { BattleLayout } from './layout';

export function fighterKey(
  state: GameState,
  fighter: Pick<Combatant, 'kind' | 'seat' | 'monsterId'>,
): string {
  if (fighter.kind === 'player') return `hero-${state.players[fighter.seat!]?.classId ?? 'knight'}`;
  return MONSTER_SHEETS[fighter.monsterId ?? ''] ?? 'icons';
}

export type BattleFighters = { a: Phaser.GameObjects.Sprite; b: Phaser.GameObjects.Sprite };

export function drawFighters(
  scene: Phaser.Scene,
  state: GameState,
  layout: BattleLayout,
): BattleFighters {
  if (state.phase.kind !== 'battle') throw new Error('drawFighters requires battle phase');
  const fighters = state.phase.battle;
  const make = (combatant: Combatant, side: 'a' | 'b') => {
    const key = fighterKey(state, combatant);
    const pos = side === 'a' ? layout.left : layout.right;
    const atlas = scene.textures.get(key).has('0');
    const sprite = scene.add
      .sprite(pos.x, pos.y, key, atlas ? 0 : undefined)
      .setOrigin(0.5, 1)
      .setScale(2)
      .setFlipX(side === 'b')
      .setDepth(5);
    if (hasAnim(scene, key, 'idle') && !reducedMotion()) sprite.play(`${key}:idle`);
    if (combatant.secretUsed) {
      scene.add
        .text(pos.x, 70, '★', { fontFamily: 'Chakra Petch', fontSize: '18px', color: '#ffd477' })
        .setOrigin(0.5)
        .setDepth(6);
    }
    return sprite;
  };
  return { a: make(fighters.a, 'a'), b: make(fighters.b, 'b') };
}

export function drawDicePools(scene: Phaser.Scene, state: GameState, layout: BattleLayout): void {
  if (state.phase.kind !== 'battle') return;
  const { dice } = layout;
  scene.add
    .rectangle(
      dice.x + dice.width / 2,
      dice.y + dice.height / 2,
      dice.width,
      dice.height,
      0x1b2140,
      0.87,
    )
    .setStrokeStyle(2, 0xe8a53c)
    .setDepth(7);
  const stats = [state.phase.battle.a.stats.atk, state.phase.battle.b.stats.atk];
  for (let side = 0; side < 2; side++) {
    const pool = Math.max(1, Math.min(5, Math.ceil(stats[side]! / 4)));
    const startX = dice.x + 18 + side * (dice.width / 2);
    for (let die = 0; die < pool; die++) {
      const x = startX + die * 30;
      // Maximum of five 20px dice fits in each 230px half of the reserved row.
      scene.add
        .rectangle(x + 10, dice.y + 20, 20, 20, 0xfff4dc)
        .setStrokeStyle(2, 0x263449)
        .setDepth(8);
      scene.add.circle(x + 10, dice.y + 20, 2, 0x263449).setDepth(9);
    }
  }
}
