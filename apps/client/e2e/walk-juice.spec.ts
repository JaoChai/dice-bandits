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
import { WORLD } from '../src/scenes/board/camera';
import { observeBoardGame, startJourney, openTitleChoice } from './helpers';

test.use({ video: 'on' });
type Board = Phaser.Scene & {
  tokenObjects: Map<number, Phaser.GameObjects.Image>;
  nameTags: Map<number, Phaser.GameObjects.Text>;
  playEvents(events: GameEvent[]): Promise<void>;
};
type Probe = Window & {
  __m5aGame: Phaser.Game;
  __juice?: {
    done: boolean;
    flips: number;
    leans: number[];
    dust: number;
    endpoint?: { x: number; y: number };
  };
};

for (const [lang, width, height] of [
  ['th', 915, 412],
  ['en', 1280, 720],
] as const) {
  test(`four-player start separates heroes and seat-coloured tags ${lang} ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
    await observeBoardGame(page);
    await startJourney(page);
    await page.waitForFunction(() => window.__db?.art.boardReady);
    const geometry = await page.evaluate(async () => {
      const game = (window as Probe).__m5aGame;
      await new Promise<void>((resolve) => game.events.once('postrender', resolve));
      const scene = game.scene.getScene('BoardScene') as Board;
      const camera = scene.cameras.main;
      const canvas = game.canvas.getBoundingClientRect();
      const project = (x: number, y: number) => {
        const p = camera.getViewMatrix().transformPoint(x, y);
        return {
          x: canvas.left + (p.x * canvas.width) / game.canvas.width,
          y: canvas.top + (p.y * canvas.height) / game.canvas.height,
        };
      };
      const bounds = (object: Phaser.GameObjects.Image | Phaser.GameObjects.Text) => {
        const r = object.getBounds();
        const a = project(r.left, r.top);
        const b = project(r.right, r.bottom);
        return {
          left: a.x,
          right: b.x,
          top: a.y,
          bottom: b.y,
          visible: object.visible && object.alpha === 1,
        };
      };
      return [...scene.tokenObjects].map(([seat, hero]) => {
        const tag = scene.nameTags?.get(seat);
        return {
          seat,
          hero: bounds(hero),
          tag: tag
            ? { ...bounds(tag), text: tag.text, background: tag.style.backgroundColor }
            : null,
        };
      });
    });
    expect(geometry).toHaveLength(4);
    for (const [index, row] of geometry.entries()) {
      expect(row.hero.visible).toBe(true);
      expect(row.hero.left).toBeGreaterThanOrEqual(0);
      expect(row.hero.right).toBeLessThanOrEqual(width);
      expect(row.tag).not.toBeNull();
      expect(row.tag!.visible).toBe(true);
      expect(row.tag!.bottom).toBeLessThan(row.hero.top);
      expect(row.tag!.left).toBeGreaterThanOrEqual(0);
      expect(row.tag!.right).toBeLessThanOrEqual(width);
      expect(row.tag!.top).toBeGreaterThanOrEqual(0);
      expect(row.tag!.background).toBe(['#2E7FE0', '#3BA84A', '#6C2EBE', '#D42B3A'][index]);
      for (const other of geometry.slice(index + 1)) {
        expect(
          Math.min(row.hero.right, other.hero.right) - Math.max(row.hero.left, other.hero.left),
        ).toBeLessThanOrEqual(0);
        if (row.tag && other.tag) {
          const overlap =
            Math.max(
              0,
              Math.min(row.tag.right, other.tag.right) - Math.max(row.tag.left, other.tag.left),
            ) *
            Math.max(
              0,
              Math.min(row.tag.bottom, other.tag.bottom) - Math.max(row.tag.top, other.tag.top),
            );
          expect(overlap).toBe(0);
        }
      }
    }
    await page.screenshot({ path: info.outputPath(`start-${lang}-${width}x${height}.png`) });
    if (process.env.AXE_SOURCE) {
      await page.addScriptTag({ path: process.env.AXE_SOURCE });
      const result = await page.evaluate(async () =>
        (
          window as unknown as {
            axe: { run(): Promise<{ violations: Array<{ impact: string }> }> };
          }
        ).axe.run(),
      );
      const serious = result.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
      console.log(
        `axe four-player start ${lang} ${width}x${height}: ${serious.length} serious/critical`,
      );
      expect(serious).toEqual([]);
      await info.attach('start-axe.json', {
        body: JSON.stringify(result),
        contentType: 'application/json',
      });
    }
    const edges = await page.evaluate((world) => {
      const scene = (window as Probe).__m5aGame.scene.getScene('BoardScene') as Board & {
        renderBoard(state: GameState): void;
      };
      const state = window.__db!.getState();
      const failures: string[] = [];
      for (const space of state.board.spaces) {
        scene.renderBoard({
          ...state,
          players: state.players.map((p) => ({ ...p, pos: space.id })),
        });
        for (const [seat, hero] of scene.tokenObjects) {
          for (const [kind, object] of [
            ['hero', hero],
            ['tag', scene.nameTags.get(seat)!],
          ] as const) {
            const b = object.getBounds();
            if (b.left < 0 || b.top < 0 || b.right > world.width || b.bottom > world.height)
              failures.push(`${space.id}/${seat}/${kind}`);
          }
        }
      }
      scene.renderBoard(state);
      return failures;
    }, WORLD);
    expect(edges, 'crowds and full labels stay within the authored map at every tile').toEqual([]);
    await info.attach('crowd-geometry.json', {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
  });
}

// Find a real legal human roll with both horizontal directions, not invented movement.
function turningWalk() {
  let state = createGame({
    seed: 'm6-readout-1',
    rounds: 30,
    seats: [
      { name: 'Sir Bram', classId: 'knight', control: 'human', personality: null },
      { name: 'Mint', classId: 'thief', control: 'human', personality: null },
    ],
  });
  for (let action = 0; action < 1200 && state.phase.kind !== 'gameOver'; action++) {
    const actor = state.players.find((p) => legalActions(state, p.seat).length)!;
    const result = step(state, chooseAction(state, actor.seat));
    const moves = result.events.filter((e) => e.type === 'Moved');
    const route = [
      state.players[state.turnSeat]!.pos,
      ...moves.map((e) => Number(e.params.to)),
    ].map((id) => state.board.spaces.find((s) => s.id === id)!);
    const dx = route.slice(1).map((s, i) => s.x - route[i]!.x);
    if (moves.length >= 3 && dx.some((x) => x > 6) && dx.some((x) => x < -6))
      return { previous: state, next: result.state, events: result.events, dx };
    state = result.state;
  }
  throw new Error('No legally replayed human direction-changing walk');
}

test('real human multi-space turn squeezes, leans and lands upright with dust', async ({
  page,
}, info) => {
  const fixture = turningWalk();
  await observeBoardGame(page);
  await page.addInitScript((previous: GameState) => {
    localStorage.setItem('diceBandits.save', JSON.stringify({ version: 2, state: previous }));
    localStorage.setItem('lang', 'en');
    localStorage.setItem('dice-bandits:intro-seen', '1');
    localStorage.setItem('dice-bandits:tips', JSON.stringify({ enabled: false, seen: [] }));
  }, fixture.previous);
  await page.goto('/?speed=1');
  await openTitleChoice(page, 'continue');
  await page.waitForFunction(() => window.__db?.art.boardReady);
  await page.evaluate(() => {
    const probe = window as Probe;
    const game = probe.__m5aGame;
    const scene = game.scene.getScene('BoardScene') as Board;
    const state = window.__db!.getState();
    const hero = scene.tokenObjects.get(state.turnSeat)!;
    const trace = { done: false, flips: 0, leans: [] as number[], dust: 0 } as NonNullable<
      Probe['__juice']
    >;
    probe.__juice = trace;
    let facing = hero.flipX;
    const record = () => {
      if (hero.flipX !== facing) {
        trace.flips++;
        facing = hero.flipX;
      }
      trace.leans.push(hero.angle);
      trace.dust = Math.max(
        trace.dust,
        scene.children.getChildren().filter((o) => o.name === 'walk-dust').length,
      );
    };
    const play = scene.playEvents.bind(scene);
    scene.playEvents = async (events) => {
      game.events.on('postrender', record);
      await play(events);
      trace.endpoint = { x: hero.x, y: hero.y };
      trace.done = true;
      game.events.off('postrender', record);
    };
  });
  await page.locator('[data-action-index="0"]').click();
  await page.waitForFunction(() => (window as Probe).__juice!.done);
  const trace = await page.evaluate(() => (window as Probe).__juice!);
  expect(trace.flips).toBeGreaterThanOrEqual(1);
  expect(Math.max(...trace.leans)).toBeGreaterThan(10);
  expect(Math.min(...trace.leans)).toBeLessThan(-10);
  expect(trace.dust).toBeGreaterThanOrEqual(8);
  const end = fixture.next.board.spaces.find(
    (s) => s.id === fixture.next.players[fixture.previous.turnSeat]!.pos,
  )!;
  expect(trace.endpoint).toEqual({ x: end.x, y: end.y });
  await info.attach('turning-walk.json', {
    body: JSON.stringify({ dx: fixture.dx, trace }),
    contentType: 'application/json',
  });
  await info.attach('turning-human-video', {
    path: await page.video()!.path(),
    contentType: 'video/webm',
  });
});
