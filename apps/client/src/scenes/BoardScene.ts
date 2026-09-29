import Phaser from 'phaser';
import type { GameState, GameEvent } from '@dice-bandits/engine';
import { coinBurst, dice, dustPuff, shake } from '../fx';
import { reducedMotion } from '../art/motion';
import { hasAnim } from '../art/atlas';
import { createHeroToken, tokenLayout } from './board/tokens';
import { boardLayout, HUD_RECTS, type ScreenPoint } from './board/layout';
import { roadSegmentsFor, placeDecorations, placeAmbients } from '../art/decorations';
import { drawGround } from './board/ground';
import { drawRoad } from './board/road';
import { drawTiles } from './board/tiles';
import { drawDecor } from './board/decor';
import { drawAmbients } from './board/ambient';

const CANVAS = { width: 640, height: 360 };

export default class BoardScene extends Phaser.Scene {
  private tokenObjects = new Map<number, Phaser.GameObjects.Image | Phaser.GameObjects.Sprite>();
  private spacePositions = new Map<number, { x: number; y: number }>();

  constructor() {
    super('BoardScene');
  }

  create(): void {
    this.cameras.main.setScroll(0, 0);
    this.game.events.on('game-state', (state: GameState) => this.renderBoard(state));
    const initial = this.game.registry.get('state') as GameState | undefined;
    if (initial) this.renderBoard(initial);
  }

  async playEvents(events: GameEvent[]): Promise<void> {
    const speed = window.diceBanditsSpeed;
    for (const event of events) {
      const token = event.seat === null ? undefined : this.tokenObjects.get(event.seat);
      if (event.type === 'DiceRolled' && token) {
        dice(this, token, speed);
        await wait(350 * speed);
      } else if (event.type === 'Moved' && token) {
        const destination = this.spacePositions.get(Number(event.params.to));
        if (destination) {
          const movingLeft = destination.x < token.x;
          token.setFlipX(movingLeft);
          if (speed > 0) {
            const middleX = (token.x + destination.x) / 2;
            const sprite =
              token instanceof Phaser.GameObjects.Sprite && hasAnim(this, token.texture.key, 'hop')
                ? token
                : undefined;
            sprite?.play(`${sprite.texture.key}:hop`);
            await new Promise<void>((resolve) => {
              this.tweens.add({
                targets: token,
                x: middleX,
                y: destination.y - 8,
                duration: 100 * speed,
                ease: 'Sine.easeOut',
                onComplete: () => {
                  this.tweens.add({
                    targets: token,
                    x: destination.x,
                    y: destination.y,
                    duration: 100 * speed,
                    ease: 'Sine.easeIn',
                    onComplete: () => {
                      if (sprite) {
                        if (!reducedMotion() && hasAnim(this, sprite.texture.key, 'idle')) {
                          sprite.play(`${sprite.texture.key}:idle`);
                        } else {
                          sprite.anims.stop();
                          sprite.setFrame(0);
                        }
                      }
                      dustPuff(this, destination.x, destination.y, speed);
                      resolve();
                    },
                  });
                },
              });
            });
          } else {
            token.setPosition(destination.x, destination.y);
          }
        }
      } else if (event.type === 'GoldStolen' && token) {
        coinBurst(this, token, speed);
        await wait(360 * speed);
      } else if (event.type === 'FrenzyStarted') {
        shake(this, speed);
        await wait(220 * speed);
      }
    }
  }

  private renderBoard(state: GameState): void {
    this.children.removeAll(true);
    this.tokenObjects.clear();
    this.spacePositions.clear();
    const layout = boardLayout(state.board.spaces, CANVAS);
    const toScreen = (x: number, y: number): ScreenPoint => layout.toScreen(x, y);
    // Keep seeded decorations out from under the DOM HUD overlay zones.
    const view = { ...toView(toScreen), avoid: HUD_RECTS };

    // Layer 1: region ground covering the whole canvas.
    drawGround(this, state.board.spaces, toScreen, CANVAS.width, CANVAS.height);

    // Layer 2: cream road along every `next` edge.
    drawRoad(this, roadSegmentsFor(state.board.spaces, view));

    // Layer 3: space tiles with town-owner pips.
    const owners = new Map<number, number | null>();
    for (const town of state.towns) owners.set(town.spaceId, town.owner);
    drawTiles(this, state.board.spaces, toScreen, layout.scale, owners);

    // Layer 4: seeded props + ambient water/lava, y-sorted. The ambient layer
    // is skipped entirely under prefers-reduced-motion.
    const decorScale = layout.scale >= 16 ? 1 : layout.scale / 16;
    drawDecor(this, placeDecorations(state.board.spaces, state.config.seed, view), decorScale);
    if (!reducedMotion()) {
      drawAmbients(this, placeAmbients(state.board.spaces, state.config.seed, view), decorScale);
    }

    // Layer 5: hero tokens (createHeroToken sets token depth itself).
    const positions = new Map<number, ScreenPoint>();
    for (const space of state.board.spaces) {
      const point = toScreen(space.x, space.y);
      positions.set(space.id, point);
      this.spacePositions.set(space.id, point);
    }
    const leader = richestSeat(state);
    const offsets = tokenLayout(state.players.map((player) => player.pos));
    for (const [playerIndex, player] of state.players.entries()) {
      const point = positions.get(player.pos);
      if (!point) continue;
      const offset = offsets[playerIndex]!;
      const x = point.x + offset.x;
      const y = point.y + offset.y;
      const token = createHeroToken(this, player.classId, x, y, !reducedMotion());
      this.tokenObjects.set(player.seat, token);
      const decorations = this.add.graphics().setDepth(40);
      decorations.lineStyle(
        2,
        player.seat === state.turnSeat ? 0xffdc72 : seatColor(player.seat),
        1,
      );
      decorations.strokeCircle(x, y, 10);
      if (player.seat === leader) {
        decorations.fillStyle(0xffd447, 1);
        decorations.fillTriangle(x - 4, y - 11, x + 4, y - 11, x, y - 17);
      }
      if (player.prank) {
        decorations.fillStyle(0xe86eaa, 1);
        decorations.fillTriangle(x - 5, y - 9, x + 5, y - 9, x, y - 16);
      }
    }
    const current = state.players[state.turnSeat];
    const point = current ? positions.get(current.pos) : undefined;
    if (point) {
      const glow = this.add.graphics().setDepth(39);
      glow.lineStyle(2, 0xffdc72, 0.9);
      glow.strokeCircle(point.x, point.y, 15);
    }
  }
}

function toView(toScreen: (x: number, y: number) => ScreenPoint) {
  return { width: CANVAS.width, height: CANVAS.height, toScreen };
}

function wait(duration: number): Promise<void> {
  return duration <= 0
    ? Promise.resolve()
    : new Promise((resolve) => window.setTimeout(resolve, duration));
}

function seatColor(seat: number): number {
  return [0xf15b4a, 0x52c2ed, 0xa5d65b, 0xcd76d7][seat % 4]!;
}
function richestSeat(state: GameState): number {
  return state.players.reduce(
    (best, player) => (player.gold > (state.players[best]?.gold ?? -1) ? player.seat : best),
    0,
  );
}
