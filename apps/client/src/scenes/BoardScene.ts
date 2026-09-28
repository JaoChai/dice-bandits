import Phaser from 'phaser';
import type { GameState, Region } from '@dice-bandits/engine';
import { coinBurst, dice, hop, shake } from '../fx';

export default class BoardScene extends Phaser.Scene {
  private tokenObjects = new Map<number, Phaser.GameObjects.Image>();

  constructor() {
    super('BoardScene');
  }

  create(): void {
    this.cameras.main.setScroll(0, 0);
    this.game.events.on('game-state', (state: GameState) => this.renderBoard(state));
    this.game.events.on('game-events', (events: { type: string; seat: number | null }[]) => {
      for (const event of events) {
        const token = event.seat === null ? undefined : this.tokenObjects.get(event.seat);
        if (event.type === 'Moved' && token) hop(this, token, window.diceBanditsSpeed);
        if (event.type === 'DiceRolled' && token) dice(this, token, window.diceBanditsSpeed);
        if (event.type === 'GoldStolen' && token) coinBurst(this, token, window.diceBanditsSpeed);
        if (event.type === 'FrenzyStarted') shake(this, window.diceBanditsSpeed);
      }
    });
    const initial = this.game.registry.get('state') as GameState | undefined;
    if (initial) this.renderBoard(initial);
  }

  private renderBoard(state: GameState): void {
    this.children.removeAll(true);
    this.tokenObjects.clear();
    const positions = new Map<number, { x: number; y: number }>();
    const countAtSpace = new Map<number, number>();
    const minX = Math.min(...state.board.spaces.map((space) => space.x));
    const maxX = Math.max(...state.board.spaces.map((space) => space.x));
    const minY = Math.min(...state.board.spaces.map((space) => space.y));
    const maxY = Math.max(...state.board.spaces.map((space) => space.y));
    for (const space of state.board.spaces) {
      const x = 25 + ((space.x - minX) / Math.max(1, maxX - minX)) * 590;
      const y = 90 + ((space.y - minY) / Math.max(1, maxY - minY)) * 260;
      positions.set(space.id, { x, y });
      this.add
        .image(x, y, `tile-${space.region as Region}`)
        .setDisplaySize(24, 24)
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
      const angle = (index * Math.PI) / 2;
      const x = point.x + Math.cos(angle) * 8;
      const y = point.y + Math.sin(angle) * 8;
      const token = this.add
        .image(x, y, `hero-${player.classId}`)
        .setDisplaySize(19, 19)
        .setDepth(4);
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
    if (state.round >= 10) {
      const banner = this.add.graphics().setDepth(8);
      banner.fillStyle(0x9b3547, 0.9);
      banner.fillRoundedRect(205, 3, 230, 22, 5);
    }
  }
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
