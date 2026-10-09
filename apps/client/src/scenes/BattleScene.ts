import Phaser from 'phaser';
import type { GameState } from '@dice-bandits/engine';
import { t, onLangChange } from '../i18n';
import { drawBackdrop } from './battle/backdrop';
import { drawDicePools, drawFighters, type BattleFighters } from './battle/fighters';
import { createBattleEffects, playHit } from './battle/effects';
import { planBattle, type BattleBeat } from './battle/presentation';
import { reducedMotion } from '../art/motion';
import { battleLayout } from './battle/layout';

export default class BattleScene extends Phaser.Scene {
  private layout = battleLayout();
  private latestState: GameState | undefined;
  private fighters: BattleFighters | undefined;
  private combatantIds: [string | number, string | number] | undefined;
  private exchangeLabel: Phaser.GameObjects.Text | undefined;
  private exchange = 0;
  private presentationRevision = 0;
  private cancelPresentation: (() => void) | undefined;

  /** Every owner boundary settles the pending wait before killing effects. */
  cancelBattlePresentation(): void {
    this.presentationRevision = (this.presentationRevision ?? 0) + 1;
    this.cancelPresentation?.();
    this.cancelPresentation = undefined;
  }

  constructor() {
    super('BattleScene');
  }

  create(): void {
    this.layout = battleLayout(this.cameras.main.width, this.cameras.main.height);
    const onResize = (): void => {
      if (this.latestState) this.renderBattle(this.latestState);
    };
    this.scale.on('resize', onResize);
    this.game.events.on('game-state', this.renderBattle, this);
    const offLang = onLangChange(() => {
      this.cancelBattlePresentation();
      this.exchangeLabel?.setText(t('battle.exchange', { exchange: this.exchange }));
    });
    this.events.once('shutdown', () => {
      this.cancelBattlePresentation();
      this.scale.off('resize', onResize);
      this.game.events.off('game-state', this.renderBattle, this);
      offLang();
    });
    const initial = this.game.registry.get('state') as GameState | undefined;
    if (initial) this.renderBattle(initial);
  }

  async playEvents(
    events: Array<{ type: string; seat: number | null; params: Record<string, string | number> }>,
    speed: number,
    options?: {
      previous: GameState;
      next: GameState;
      mode: 'human' | 'bot' | 'online';
      onBeat?: (beat: BattleBeat) => void;
      onCancel?: () => void;
    },
  ): Promise<void> {
    if (options) {
      this.cancelBattlePresentation();
      const revision = this.presentationRevision;
      const staticOnly = speed <= 0 || reducedMotion();
      // Reserve two 30-FPS frames from the 600ms cosmetic budget. Phaser
      // timers settle on frames; seven independently rounded waits overshoot.
      const cosmeticScale = options.mode === 'human' ? 1 : 0.9;
      const beats = planBattle(
        options.previous,
        options.next,
        events,
        options.mode,
        staticOnly,
      ).map((beat) => ({
        ...beat,
        duration: beat.duration * Math.min(1, Math.max(0, speed)) * cosmeticScale,
      }));
      if (!beats.length) {
        options.onCancel?.();
        return;
      }
      const effects =
        !staticOnly && this.fighters
          ? createBattleEffects(this, this.fighters, this.layout, options.mode === 'online')
          : undefined;
      let timer: Phaser.Time.TimerEvent | undefined;
      let finishWait: (() => void) | undefined;
      let cleaned = false;
      const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        timer?.remove(false);
        finishWait?.();
        effects?.destroy();
      };
      this.cancelPresentation = () => {
        cleanup();
        options.onCancel?.();
      };
      let deadline = performance.now();
      try {
        for (const beat of beats) {
          deadline += beat.duration;
          if (revision !== this.presentationRevision) break;
          options.onBeat?.(beat);
          effects?.showBeat(
            beat.kind === 'impact'
              ? { ...beat, targets: beats.find((entry) => entry.kind === 'damage')?.targets ?? [] }
              : beat,
          );
          if (beat.duration > 0)
            await new Promise<void>((resolve) => {
              finishWait = resolve;
              const wait =
                options.mode === 'human'
                  ? beat.duration
                  : Math.max(0, deadline - performance.now());
              timer = this.time.delayedCall(wait, () => {
                timer = undefined;
                finishWait = undefined;
                resolve();
              });
            });
        }
      } finally {
        cleanup();
        if (revision === this.presentationRevision) this.cancelPresentation = undefined;
      }
      return;
    }
    // Source-compatible legacy callers; application playback always supplies
    // previous/next and never reads a pending pick to label its reveal.
    for (const event of events) {
      if (event.type === 'BattlePick' && event.params.pick === 'secret') {
        const side = event.params.side === 'b' ? 'b' : 'a';
        const pos = this.layout[side === 'a' ? 'left' : 'right'];
        const card = this.add
          .text(pos.x, this.layout.groundY - this.layout.fighterHeight - 24, '?', {
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
          this.layout,
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
    this.cancelBattlePresentation();
    this.latestState = state;
    const view = this.cameras.main;
    this.layout = battleLayout(view.width, view.height);
    this.children.removeAll(true);
    this.fighters = undefined;
    this.exchangeLabel = undefined;
    if (state.phase.kind !== 'battle') return;
    const battle = state.phase.battle;
    this.exchange = battle.exchange;
    drawBackdrop(this, state, battle.spaceId, view);
    this.fighters = drawFighters(this, state, this.layout);
    this.combatantIds = [
      battle.a.monsterId ?? battle.a.seat ?? -1,
      battle.b.monsterId ?? battle.b.seat ?? -1,
    ];
    drawDicePools(this, state, this.layout);
    this.exchangeLabel = this.add
      .text(
        view.width / 2,
        this.layout.exchangeY,
        t('battle.exchange', { exchange: battle.exchange }),
        {
          fontFamily: 'Chakra Petch',
          fontSize: '18px',
          color: '#fff4dc',
          fontStyle: 'bold',
          stroke: '#1b2140',
          strokeThickness: 4,
        },
      )
      .setOrigin(0.5)
      .setDepth(8);
  }
}
