import Phaser from 'phaser';
import type { GameState } from '@dice-bandits/engine';
import { t, onLangChange } from '../i18n';
import type { PostResult } from '../ui/battlePostModel';
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

  private postTweens: Phaser.Tweens.Tween[] = [];
  private postSprites: Phaser.GameObjects.Sprite[] = [];
  private postHomes = new Map<Phaser.GameObjects.Sprite, { x: number; y: number }>();
  private postWinner: 'a' | 'b' | null = null;
  private postChoiceMounted = false;
  private heldPostResult: PostResult | null = null;
  private heldPostLevelUp = false;

  /** View-only finale. The engine remains the sole source of results/rewards. */
  postVictory(result: PostResult, duration: number): void {
    this.settlePostEffects();
    this.cancelBattlePresentation();
    this.postWinner = result.winner;
    this.heldPostResult = result;
    this.postChoiceMounted = false;
    this.postHomes.clear();
    for (const child of this.children.list) {
      const display = child as Phaser.GameObjects.Sprite;
      if (display.depth >= 6) display.setVisible(false);
    }
    for (const side of ['a', 'b'] as const) {
      const sprite = this.fighters?.[side];
      if (!sprite) continue;
      this.tweens.killTweensOf(sprite);
      const home = this.layout[side === 'a' ? 'left' : 'right'];
      sprite.setPosition(home.x, home.y).setAngle(0);
      this.postHomes.set(sprite, { x: home.x, y: home.y });
      const winner = side === result.winner;
      const pose = winner ? 'happy' : result.winner ? 'hurt' : 'idle';
      sprite.setFrame(sprite.texture.has(pose) ? pose : 'idle');
      sprite.setAlpha(winner || !result.winner ? 1 : 0.6);
      if (!winner && result.winner && duration > 0)
        this.postTweens.push(
          this.tweens.add({
            targets: sprite,
            y: home.y + this.layout.fighterHeight * 0.08,
            angle: side === 'a' ? -12 : 12,
            alpha: 0.35,
            duration,
            ease: 'Sine.easeIn',
          }),
        );
      if (winner && duration > 0)
        this.postTweens.push(
          this.tweens.add({
            targets: sprite,
            y: home.y - this.layout.fighterHeight * 0.075,
            duration: duration / 4,
            yoyo: true,
            repeat: 1,
            ease: 'Sine.easeOut',
          }),
        );
    }
  }

  postRewards(result: PostResult, duration: number): void {
    const actor = result.winner ? this.fighters?.[result.winner] : undefined;
    if (!actor || !result.gold || duration <= 0) return;
    const { width, height } = this.cameras.main;
    for (let index = 0; index < 7; index++) {
      const coin = this.add.sprite(
        actor.x + (index - 3) * 16,
        actor.y - this.layout.fighterHeight * 0.5,
        'art:icons',
        'coin',
      );
      coin.setDisplaySize(height * 0.055, height * 0.055).setDepth(30);
      this.postSprites.push(coin);
      this.postTweens.push(
        this.tweens.add({
          targets: coin,
          x: width * 0.47,
          y: height * 0.29,
          scaleX: coin.scaleX * 0.5,
          scaleY: coin.scaleY * 0.5,
          alpha: 0,
          duration: duration * 0.72,
          delay: index * duration * 0.03,
          ease: 'Sine.easeInOut',
        }),
      );
    }
  }

  postChoice(levelUp: boolean, reduced: boolean): void {
    if (this.postChoiceMounted) return;
    this.postChoiceMounted = true;
    this.heldPostLevelUp = levelUp;
    this.settlePostEffects();
    const { width, height } = this.cameras.main;
    for (const side of ['a', 'b'] as const) {
      const sprite = this.fighters?.[side];
      if (!sprite) continue;
      const home = { x: width * (side === 'a' ? 0.115 : 0.885), y: height * 0.69 };
      this.postHomes.set(sprite, home);
      sprite.setScale(sprite.scaleX * 0.64, sprite.scaleY * 0.64);
      if (reduced) sprite.setPosition(home.x, home.y);
      else
        this.postTweens.push(
          this.tweens.add({ targets: sprite, ...home, duration: 180, ease: 'Sine.easeOut' }),
        );
      if (levelUp && side === this.postWinner && !reduced) {
        for (let index = 0; index < 7; index++) {
          const star = this.add.sprite(
            home.x + (index - 3) * height * 0.026,
            home.y - this.layout.fighterHeight * 0.3,
            'art:icons',
            'star',
          );
          star.setDisplaySize(height * 0.04, height * 0.04).setDepth(30);
          this.postSprites.push(star);
          this.postTweens.push(
            this.tweens.add({
              targets: star,
              y: star.y - height * 0.3,
              alpha: 0,
              duration: 600,
              delay: index * 35,
              ease: 'Sine.easeOut',
            }),
          );
        }
      }
    }
  }

  settlePostEffects(): void {
    this.postTweens.forEach((tween) => tween.stop());
    this.postTweens = [];
    this.postSprites.forEach((sprite) => sprite.destroy());
    this.postSprites = [];
    this.postHomes.forEach((home, sprite) => {
      if (sprite.active) sprite.setPosition(home.x, home.y);
    });
  }

  constructor() {
    super('BattleScene');
  }

  create(): void {
    this.layout = battleLayout(this.cameras.main.width, this.cameras.main.height);
    const onResize = (): void => {
      const result = this.heldPostResult;
      const choices = this.postChoiceMounted;
      const level = this.heldPostLevelUp;
      if (this.latestState) this.renderBattle(this.latestState);
      if (result) {
        this.postVictory(result, 0);
        if (choices) this.postChoice(level, true);
      }
    };
    this.scale.on('resize', onResize);
    this.game.events.on('game-state', this.renderBattle, this);
    const offLang = onLangChange(() => {
      this.cancelBattlePresentation();
      this.exchangeLabel?.setText(t('battle.exchange', { exchange: this.exchange }));
    });
    this.events.once('shutdown', () => {
      this.settlePostEffects();
      this.postHomes.clear();
      this.heldPostResult = null;
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
      let wallTimer: number | undefined;
      let finishWait: (() => void) | undefined;
      let cleaned = false;
      const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        timer?.remove(false);
        window.clearTimeout(wallTimer);
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
          const wallDeadline = options.mode === 'human' ? performance.now() + beat.duration : 0;
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
              let settled = false;
              const complete = (): void => {
                settled = true;
                timer?.remove(false);
                window.clearTimeout(wallTimer);
                timer = undefined;
                finishWait = undefined;
                resolve();
              };
              const checkHumanFloor = (): void => {
                if (settled || cleaned || revision !== this.presentationRevision) return;
                // Phaser's smoothed delta can dispatch early. Keep scene pause/
                // timeScale eligibility, but give every human beat its own wall floor.
                const remaining = wallDeadline - performance.now();
                if (remaining > 0) {
                  timer = this.time.delayedCall(remaining, checkHumanFloor);
                  // Scene eligibility has already been reached. A smoothed early
                  // callback used to round the wall-floor correction to another
                  // frame (seven extra frames under CPU throttling). Resolve the
                  // correction directly, retaining pause/timeScale eligibility.
                  window.clearTimeout(wallTimer);
                  wallTimer = window.setTimeout(() => {
                    if (
                      !this.time.paused &&
                      this.time.timeScale > 0 &&
                      (!this.sys || this.sys.isActive())
                    )
                      checkHumanFloor();
                  }, remaining);
                } else {
                  complete();
                }
              };
              timer = this.time.delayedCall(
                wait,
                options.mode === 'human' ? checkHumanFloor : complete,
              );
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
    // All views commit normally. Only this scene retains its cosmetic backdrop.
    if (this.heldPostResult && state.phase.kind !== 'battle') return;
    this.settlePostEffects();
    this.postHomes.clear();
    this.heldPostResult = null;
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
