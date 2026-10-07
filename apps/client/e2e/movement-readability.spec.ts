import {
  chooseAction,
  createGame,
  legalActions,
  step,
  type GameEvent,
  type GameState,
} from '@dice-bandits/engine';
import { expect, test } from '@playwright/test';
import type Phaser from 'phaser';
import { observeBoardGame, startJourney } from './helpers';

type Point = { x: number; y: number };
type Sample = { token: Point; projected: Point; spaces: Point[] };
type ProbeWindow = Window & {
  __m5aGame?: Phaser.Game;
  __walk?: { done: boolean; samples: Sample[]; final?: Point; elapsed?: number };
};

/** Legal engine replay of the study seed; no copied states or invented events. */
function fiveStepWalk() {
  let state = createGame({
    seed: 'm6-study-1',
    rounds: 30,
    seats: [
      { name: 'Sir Bram', classId: 'knight', control: 'human', personality: null },
      { name: 'Mint', classId: 'thief', control: 'bot', personality: 'greedy' },
    ],
  });
  for (let action = 0; action < 1200; action++) {
    const actor = state.players.find((player) => legalActions(state, player.seat).length > 0)!;
    const result = step(state, chooseAction(state, actor.seat));
    const moves = result.events.filter((event) => event.type === 'Moved');
    if (moves.length === 5) return { previous: state, next: result.state, moves };
    state = result.state;
  }
  throw new Error('No legal five-step walk found');
}

for (const speed of [1, 0]) {
  test(`real scene traverses five empty spaces with projected intermediate positions (speed ${speed})`, async ({
    page,
  }, info) => {
    await observeBoardGame(page);
    await startJourney(page);
    await page.waitForFunction(() => window.__db?.art.boardReady);
    const fixture = fiveStepWalk();
    expect(fixture.moves.map((event) => event.params.to)).toEqual([6, 7, 8, 9, 10]);
    expect(
      fixture.moves.every(
        (event) => !fixture.previous.players.some((player) => player.pos === event.params.to),
      ),
    ).toBe(true);
    const seat = fixture.moves[0]!.seat!;
    const route = [
      fixture.previous.players[seat]!.pos,
      ...fixture.moves.map((event) => Number(event.params.to)),
    ];
    // Scene-level isolation: mount a legally replayed before-state, then exercise
    // the real shipped scene/tweens. This does not claim controller click latency.
    await page.evaluate(
      ({ previous, moves, route, speed }) => {
        const game = (window as ProbeWindow).__m5aGame!;
        const scene = game.scene.getScene('BoardScene') as Phaser.Scene & {
          tokenObjects: Map<number, Phaser.GameObjects.Image>;
          playEvents(events: GameEvent[]): Promise<void>;
          toggleWholeMap(state: GameState, whole: boolean): void;
        };
        window.diceBanditsSpeed = 0;
        game.events.emit('game-state', previous);
        scene.toggleWholeMap(previous, true);
        window.diceBanditsSpeed = speed;
        const token = scene.tokenObjects.get(moves[0]!.seat!)!;
        const spaces = route.map((id) => previous.board.spaces.find((space) => space.id === id)!);
        const probe = { done: false, samples: [] } as NonNullable<ProbeWindow['__walk']>;
        (window as ProbeWindow).__walk = probe;
        const record = () => {
          const canvas = game.canvas.getBoundingClientRect();
          const project = (point: Point) => {
            const p = scene.cameras.main.getViewMatrix().transformPoint(point.x, point.y);
            return {
              x: canvas.left + (p.x * canvas.width) / game.canvas.width,
              y: canvas.top + (p.y * canvas.height) / game.canvas.height,
            };
          };
          probe.samples.push({
            token: { x: token.x, y: token.y },
            projected: project(token),
            spaces: spaces.map(project),
          });
        };
        game.events.on('postrender', record);
        const started = performance.now();
        void scene.playEvents(moves).then(() => {
          probe.final = { x: token.x, y: token.y };
          probe.elapsed = performance.now() - started;
          probe.done = true;
          game.events.off('postrender', record);
        });
      },
      { previous: fixture.previous, moves: fixture.moves, route, speed },
    );
    await page.waitForFunction(() => (window as ProbeWindow).__walk?.done);
    const probe = await page.evaluate(() => (window as ProbeWindow).__walk!);
    await info.attach('projected-walk.json', {
      body: JSON.stringify({ route, ...probe }),
      contentType: 'application/json',
    });
    if (speed > 0) {
      const ordered: number[] = [];
      for (const sample of probe.samples) {
        for (let segment = 0; segment < route.length - 1; segment++) {
          const from = sample.spaces[segment]!,
            to = sample.spaces[segment + 1]!;
          const dx = to.x - from.x,
            dy = to.y - from.y;
          const fraction =
            ((sample.projected.x - from.x) * dx + (sample.projected.y - from.y) * dy) /
            (dx * dx + dy * dy);
          const cross =
            Math.abs((sample.projected.x - from.x) * dy - (sample.projected.y - from.y) * dx) /
            Math.hypot(dx, dy);
          if (fraction > 0.2 && fraction < 0.8 && cross < 0.5 && ordered.at(-1) !== segment)
            ordered.push(segment);
        }
      }
      expect(ordered, 'actual rendered frames between each projected pair, in event order').toEqual(
        [0, 1, 2, 3, 4],
      );
    } else {
      expect(probe.elapsed, 'speed 0 resolves without tween waits').toBeLessThan(100);
    }
    const endpoint = fixture.next.board.spaces.find(
      (space) => space.id === fixture.next.players[seat]!.pos,
    )!;
    expect(probe.final).toEqual({ x: endpoint.x, y: endpoint.y });
    await page.screenshot({ path: info.outputPath(`walk-speed-${speed}.png`) });
  });
}
