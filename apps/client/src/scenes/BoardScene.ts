import Phaser from 'phaser';
import type { GameState, GameEvent, Region } from '@dice-bandits/engine';
import { coinBurst, dice, dustPuff, shake } from '../fx';
import { reducedMotion } from '../art/motion';
import { hasAnim } from '../art/atlas';
import { createHeroToken, tokenOffsets } from './board/tokens';

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
    const positions = new Map<number, { x: number; y: number }>();
    const countAtSpace = new Map<number, number>();
    const minX = Math.min(...state.board.spaces.map((space) => space.x));
    const maxX = Math.max(...state.board.spaces.map((space) => space.x));
    const minY = Math.min(...state.board.spaces.map((space) => space.y));
    const maxY = Math.max(...state.board.spaces.map((space) => space.y));
    const paddingX = 24;
    const paddingTop = 55;
    const paddingBottom = 27;
    const boardHeightAvailable = 300 - paddingTop - paddingBottom;
    const scale = Math.min(
      (640 - paddingX * 2) / Math.max(1, maxX - minX),
      boardHeightAvailable / Math.max(1, maxY - minY),
    );
    const boardWidth = (maxX - minX) * scale;
    const boardHeight = (maxY - minY) * scale;
    const offsetX = (640 - boardWidth) / 2;
    const offsetY = paddingTop + (boardHeightAvailable - boardHeight) / 2;
    for (const space of state.board.spaces) {
      const x = offsetX + (space.x - minX) * scale;
      const y = offsetY + (space.y - minY) * scale;
      positions.set(space.id, { x, y });
      this.spacePositions.set(space.id, { x, y });
      this.add
        .image(x, y, `tile-${space.region as Region}`)
        .setDisplaySize(20, 20)
        .setDepth(0);
      const marker = this.add.graphics().setDepth(1);
      marker.fillStyle(kindColor(space.kind), 1);
      marker.fillRoundedRect(x - 7, y - 7, 14, 14, 3);
      const town = state.towns.find((candidate) => candidate.spaceId === space.id);
      if (town?.owner !== null && town?.owner !== undefined) {
        marker.fillStyle(seatColor(town.owner), 1);
        marker.fillCircle(x + 7, y - 7, 4);
      }
    }
    const leader = richestSeat(state);
    for (const player of state.players) {
      const point = positions.get(player.pos);
      if (!point) continue;
      const index = countAtSpace.get(player.pos) ?? 0;
      countAtSpace.set(player.pos, index + 1);
      const offset = tokenOffsets(index + 1)[index]!;
      const x = point.x + offset.x;
      const y = point.y + offset.y;
      const token = createHeroToken(this, player.classId, x, y, !reducedMotion());
      this.tokenObjects.set(player.seat, token);
      const decorations = this.add.graphics().setDepth(5);
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
      const glow = this.add.graphics().setDepth(2);
      glow.lineStyle(2, 0xffdc72, 0.9);
      glow.strokeCircle(point.x, point.y, 15);
    }
  }
}

function wait(duration: number): Promise<void> {
  return duration <= 0
    ? Promise.resolve()
    : new Promise((resolve) => window.setTimeout(resolve, duration));
}

function kindColor(kind: string): number {
  return (
    {
      castle: 0xf3c744,
      town: 0x4bb67a,
      shop: 0x60b8dc,
      chest: 0xe6a34a,
      monster: 0xc84d55,
      event: 0xb678d6,
      trap: 0x51445d,
    }[kind] ?? 0xffffff
  );
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
