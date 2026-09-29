import Phaser from 'phaser';
import type { GameState } from '@dice-bandits/engine';
import { t } from '../i18n';
import { drawBackdrop } from './battle/backdrop';
import { drawDicePools, drawFighters, type BattleFighters } from './battle/fighters';
import { playCoinBurst, playHit } from './battle/effects';
import { BATTLE_EXCHANGE_Y, battleLayout } from './battle/layout';

const layout = battleLayout();

export default class BattleScene extends Phaser.Scene {
  private fighters: BattleFighters | undefined;
  private combatantIds: [string | number, string | number] | undefined;

  constructor() {
    super('BattleScene');
  }

  create(): void {
    this.game.events.on('game-state', this.renderBattle, this);
    this.events.once('shutdown', () => this.game.events.off('game-state', this.renderBattle, this));
    const initial = this.game.registry.get('state') as GameState | undefined;
    if (initial) this.renderBattle(initial);
  }

  async playEvents(
    events: Array<{ type: string; seat: number | null; params: Record<string, string | number> }>,
    speed: number,
  ): Promise<void> {
    for (const event of events) {
      if (event.type === 'BattlePick' && event.params.pick === 'secret') {
        const side = event.params.side === 'b' ? 'b' : 'a';
        const pos = layout[side === 'a' ? 'left' : 'right'];
        const card = this.add
          .text(pos.x, 180, '?', {
            fontFamily: 'Chakra Petch',
            fontSize: '24px',
            color: '#ffd477',
            backgroundColor: '#38264a',
            padding: { x: 10, y: 5 },
          })
          .setOrigin(0.5)
          .setDepth(15);
        await this.flipSecret(card, t('event.SecretUsed'), speed);
      } else if (event.type === 'DamageDealt' && this.fighters && this.combatantIds) {
        await playHit(
          this,
          this.fighters,
          layout,
          {
            attacker: event.params.attacker ?? -1,
            defender: event.params.defender ?? -1,
            toAttacker: Number(event.params.toAttacker),
            toDefender: Number(event.params.toDefender),
          },
          this.combatantIds[0],
          this.combatantIds[1],
          speed,
        );
      } else if (event.type === 'GoldStolen' && this.combatantIds) {
        const side = event.seat === this.combatantIds[1] ? 'b' : 'a';
        await playCoinBurst(this, layout, side, speed);
      }
    }
  }

  private async flipSecret(
    card: Phaser.GameObjects.Text,
    revealed: string,
    speed: number,
  ): Promise<void> {
    if (speed <= 0) {
      card.setText(revealed);
      card.destroy();
      return;
    }
    await new Promise<void>((resolve) =>
      this.tweens.add({
        targets: card,
        scaleX: 0,
        duration: 100 * speed,
        onComplete: () => {
          card.setText(revealed);
          this.tweens.add({
            targets: card,
            scaleX: 1,
            duration: 100 * speed,
            onComplete: () => resolve(),
          });
        },
      }),
    );
    await new Promise<void>((resolve) =>
      this.tweens.add({
        targets: card,
        alpha: 0,
        duration: 280 * speed,
        onComplete: () => {
          card.destroy();
          resolve();
        },
      }),
    );
  }

  private renderBattle(state: GameState): void {
    this.children.removeAll(true);
    this.fighters = undefined;
    if (state.phase.kind !== 'battle') return;
    const battle = state.phase.battle;
    drawBackdrop(this, state, battle.spaceId);
    this.fighters = drawFighters(this, state, layout);
    this.combatantIds = [
      battle.a.monsterId ?? battle.a.seat ?? -1,
      battle.b.monsterId ?? battle.b.seat ?? -1,
    ];
    drawDicePools(this, state, layout);
    this.add
      .text(320, BATTLE_EXCHANGE_Y, t('battle.exchange', { exchange: battle.exchange }), {
        fontFamily: 'Chakra Petch',
        fontSize: '18px',
        color: '#fff4dc',
        fontStyle: 'bold',
        stroke: '#1b2140',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(8);
  }
}
