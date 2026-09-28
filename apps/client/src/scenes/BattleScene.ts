import Phaser from 'phaser';
import type { GameState } from '@dice-bandits/engine';
import { t } from '../i18n';

export default class BattleScene extends Phaser.Scene {
  constructor() {
    super('BattleScene');
  }

  create(): void {
    this.game.events.on('game-state', (state: GameState) => this.renderBattle(state));
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
        const card = this.add
          .text(side === 'a' ? 175 : 465, 290, '?', {
            fontFamily: 'Chakra Petch',
            fontSize: '25px',
            color: '#ffd477',
            backgroundColor: '#38264a',
            padding: { x: 10, y: 5 },
          })
          .setOrigin(0.5);
        await this.flipSecret(card, t('event.SecretUsed'), speed);
      } else if (event.type === 'DamageDealt') {
        const damage = Number(event.params.toAttacker) + Number(event.params.toDefender);
        if (damage > 0) {
          const number = this.add
            .text(320, 145, t('battle.damage', { value: damage }), {
              fontFamily: 'Chakra Petch',
              fontSize: '24px',
              color: '#ff7068',
              fontStyle: 'bold',
            })
            .setOrigin(0.5);
          if (speed > 0) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 55 * speed));
            this.cameras.main.flash(90 * speed, 255, 235, 225);
            this.cameras.main.shake(110 * speed, 0.003);
            await new Promise<void>((resolve) => {
              this.tweens.add({
                targets: number,
                y: 112,
                alpha: 0,
                duration: 320 * speed,
                onComplete: () => {
                  number.destroy();
                  resolve();
                },
              });
            });
          } else number.destroy();
        }
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
    await new Promise<void>((resolve) => {
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
      });
    });
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: card,
        alpha: 0,
        duration: 280 * speed,
        onComplete: () => {
          card.destroy();
          resolve();
        },
      });
    });
  }

  private renderBattle(state: GameState): void {
    this.children.removeAll(true);
    if (state.phase.kind !== 'battle') return;
    const battle = state.phase.battle;
    const fighters = [battle.a, battle.b] as const;
    this.add.rectangle(320, 177, 550, 195, 0x181323, 0.93).setStrokeStyle(3, 0xe7aa57);
    this.add
      .text(320, 95, t('battle.exchange', { exchange: battle.exchange }), {
        fontFamily: 'Chakra Petch',
        fontSize: '22px',
        color: '#ffd477',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    fighters.forEach((fighter, index) => {
      const x = index === 0 ? 175 : 465;
      const player = fighter.kind === 'player' ? state.players[fighter.seat!] : undefined;
      const texture = player ? `hero-${player.classId}` : 'icons';
      this.add.image(x, 158, texture).setDisplaySize(64, 64);
      this.add
        .text(x, 205, player?.prank?.alias ?? player?.name ?? t('battle.opponent'), {
          fontFamily: 'Chakra Petch',
          fontSize: '17px',
          color: '#fff4dc',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      const hpRatio = Math.max(0, fighter.hp / fighter.stats.maxHp);
      this.add.rectangle(x, 232, 130, 14, 0x633e4a);
      this.add.rectangle(x - (130 * (1 - hpRatio)) / 2, 232, 130 * hpRatio, 12, 0x6acb72);
      this.add
        .text(x, 232, `${fighter.hp}/${fighter.stats.maxHp}`, {
          fontFamily: 'Chakra Petch',
          fontSize: '12px',
          color: '#ffffff',
        })
        .setOrigin(0.5);
      if (fighter.secretUsed) {
        this.add.text(x, 270, '★', { fontSize: '24px', color: '#ffd477' }).setOrigin(0.5);
      }
    });
    this.add.text(320, 270, '⚔', { fontSize: '28px', color: '#e7aa57' }).setOrigin(0.5);
  }
}
