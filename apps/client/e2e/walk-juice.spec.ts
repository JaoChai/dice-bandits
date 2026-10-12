import {
  chooseAction,
  createGame,
  legalActions,
  step,
  type GameEvent,
  type GameState,
} from '@dice-bandits/engine';
import { writeFile, mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type Phaser from 'phaser';
import { WORLD } from '../src/scenes/board/camera';
import { observeBoardGame, startJourney, openTitleChoice } from './helpers';

test.use({ video: { mode: 'on', size: { width: 915, height: 412 } } });
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

// Regression: fixed 24px lifts can push supported 18-character names above
// the north edge. Measure real text bounds, including stroke and padding.
for (const name of ['Alexander Hamilton', 'W'.repeat(18)]) {
  for (const [lang, width, height] of [
    ['th', 915, 412],
    ['en', 1280, 720],
  ] as const) {
    test(`full crowded names stay bounded ${name} ${lang} ${width}x${height}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
      await observeBoardGame(page);
      await page.goto('/?seed=m5ab-1&speed=0');
      await openTitleChoice(page, 'new');
      for (let seat = 0; seat < 4; seat++) {
        await page
          .locator(`[data-seat="${seat}"] select[data-field="control"]`)
          .selectOption('human');
        await page.locator(`[data-seat="${seat}"] input[data-field="name"]`).fill(name);
        await page.locator(`[data-seat="${seat}"] input[data-field="name"]`).blur();
      }
      await page.locator('#setup-form button[type="submit"]').click();
      await page.waitForFunction(() => window.__db?.art.boardReady);
      expect(await page.evaluate(() => window.__db!.getState().players.map((p) => p.name))).toEqual(
        [name, name, name, name],
      );
      const tiles = await page.evaluate(() =>
        window.__db!.getState().board.spaces.map((s) => s.id),
      );
      // Capture the reviewer's exact tile first, before checking every other tile.
      const evidence = [];
      for (const tile of [21, ...tiles.filter((id) => id !== 21)]) {
        const rows = await page.evaluate(async (pos) => {
          const game = (window as Probe).__m5aGame;
          const scene = game.scene.getScene('BoardScene') as Board & {
            renderBoard(state: GameState): void;
          };
          const state = window.__db!.getState();
          scene.renderBoard({ ...state, players: state.players.map((p) => ({ ...p, pos })) });
          await new Promise<void>((resolve) => game.events.once('postrender', resolve));
          const camera = scene.cameras.main;
          const canvas = game.canvas.getBoundingClientRect();
          const project = (x: number, y: number) => {
            const p = camera.getViewMatrix().transformPoint(x, y);
            return {
              x: canvas.left + (p.x * canvas.width) / game.canvas.width,
              y: canvas.top + (p.y * canvas.height) / game.canvas.height,
            };
          };
          const viewport = {
            left: canvas.left + (camera.x * canvas.width) / game.canvas.width,
            top: canvas.top + (camera.y * canvas.height) / game.canvas.height,
            right: canvas.left + ((camera.x + camera.width) * canvas.width) / game.canvas.width,
            bottom: canvas.top + ((camera.y + camera.height) * canvas.height) / game.canvas.height,
          };
          return [...scene.nameTags].map(([seat, tag]) => {
            const b = tag.getBounds();
            const hero = scene.tokenObjects.get(seat)!.getBounds();
            const a = project(b.left, b.top),
              z = project(b.right, b.bottom);
            return {
              seat,
              text: tag.text,
              fontSize: tag.style.fontSize,
              visible: tag.visible && tag.alpha === 1,
              tag: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
              hero: { left: hero.left, top: hero.top, right: hero.right, bottom: hero.bottom },
              screen: { left: a.x, top: a.y, right: z.x, bottom: z.y },
              viewport,
            };
          });
        }, tile);
        evidence.push({ tile, rows });
        if (tile === 21) {
          await page.screenshot({
            path: info.outputPath(`long-name-${lang}-${width}x${height}.png`),
          });
          await info.attach('north-edge-geometry.json', {
            body: JSON.stringify(rows),
            contentType: 'application/json',
          });
        }
        expect(rows).toHaveLength(4);
        for (const [index, row] of rows.entries()) {
          const context = `tile ${tile} seat ${row.seat}`;
          expect(row.text, context).toBe(name);
          expect(row.fontSize, context).toBe('15px');
          expect(row.visible, context).toBe(true);
          expect(row.tag.left, context).toBeGreaterThanOrEqual(0);
          expect(row.tag.top, context).toBeGreaterThanOrEqual(0);
          expect(row.tag.right, context).toBeLessThanOrEqual(WORLD.width);
          expect(row.tag.bottom, context).toBeLessThan(row.hero.top);
          expect(row.tag.bottom, context).toBeLessThanOrEqual(WORLD.height);
          expect(row.screen.left, context).toBeGreaterThanOrEqual(row.viewport.left);
          expect(row.screen.top, context).toBeGreaterThanOrEqual(row.viewport.top);
          expect(row.screen.right, context).toBeLessThanOrEqual(row.viewport.right);
          expect(row.screen.bottom, context).toBeLessThanOrEqual(row.viewport.bottom);
          for (const other of rows.slice(index + 1)) {
            const overlap =
              Math.max(
                0,
                Math.min(row.tag.right, other.tag.right) - Math.max(row.tag.left, other.tag.left),
              ) *
              Math.max(
                0,
                Math.min(row.tag.bottom, other.tag.bottom) - Math.max(row.tag.top, other.tag.top),
              );
            expect(overlap, `${context} overlaps seat ${other.seat}`).toBe(0);
          }
        }
      }
      await info.attach('all-long-name-tiles.json', {
        body: JSON.stringify(evidence),
        contentType: 'application/json',
      });
    });
  }
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

// Instrument only real rendered state: no production hooks, invented dice or
// frame timers. Sampling starts BEFORE Roll, including the centre overlay.
for (const [lang, width, height] of [
  ['th', 915, 412],
  ['en', 1280, 720],
] as const) {
  test(`no-spin roll and airborne happy pose ${lang} ${width}x${height}`, async ({
    page,
  }, info) => {
    const fixture = turningWalk();
    expect(fixture.events.filter((e) => e.type === 'Moved').length).toBeGreaterThanOrEqual(3);
    const rolled = Number(fixture.events.find((e) => e.type === 'DiceRolled')!.params.value);
    await page.setViewportSize({ width, height });
    await observeBoardGame(page);
    await page.addInitScript(
      ({ state, lang }) => {
        localStorage.setItem('diceBandits.save', JSON.stringify({ version: 2, state }));
        localStorage.setItem('lang', lang);
        localStorage.setItem('dice-bandits:intro-seen', '1');
        localStorage.setItem('dice-bandits:tips', JSON.stringify({ enabled: false, seen: [] }));
      },
      { state: fixture.previous, lang },
    );
    await page.goto('/?speed=1');
    await openTitleChoice(page, 'continue');
    await page.waitForFunction(() => window.__db?.art.boardReady);
    const trace = await page.evaluate(async () => {
      const game = (window as Probe).__m5aGame;
      const scene = game.scene.getScene('BoardScene') as Board;
      const activeSeat = window.__db!.getState().turnSeat;
      const hero = scene.tokenObjects.get(activeSeat)!;
      const trace = {
        done: false,
        maxAngle: 0,
        hopFrames: [] as Array<{ k: number; frame: string }>,
        rollFrames: [] as string[],
        die: [] as Array<{
          face: string;
          top: number;
          bottom: number;
          tagTop: number;
          viewTop: number;
          above: boolean;
          inside: boolean;
          width: number;
          stage: string | null;
          at: number;
        }>,
        captures: {} as Record<string, string>,
        resultAt: null as number | null,
        rest: '',
        dieAtRest: -1,
      };
      let phase = 'centre',
        k = 0;
      const add = scene.tweens.add.bind(scene.tweens);
      scene.tweens.add = (config: Phaser.Types.Tweens.TweenBuilderConfig) => {
        if (config.duration === 560 && config.progress === 1) {
          phase = 'hop';
          k = 0;
          const update = config.onUpdate,
            finish = config.onComplete;
          config.onUpdate = (...args) => {
            k = (config.targets as { progress: number }).progress;
            update?.(...args);
          };
          config.onComplete = (...args) => {
            phase = 'hold';
            finish?.(...args);
          };
        } else if (config.duration === 350 && config.roll === 1) phase = 'roll';
        return add(config);
      };
      const capture = (name: string): void => {
        if (name in trace.captures) return;
        trace.captures[name] = '';
        const camera = scene.cameras.main;
        const p = camera.getViewMatrix().transformPoint(hero.x, hero.y);
        // Fixed crop includes the full airborne hero; no shape is resized.
        (game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).snapshotArea(
          Math.max(0, Math.floor(p.x - 100)),
          Math.max(0, Math.floor(p.y - 160)),
          200,
          180,
          (image) => {
            if (image instanceof HTMLImageElement) trace.captures[name] = image.src;
          },
        );
      };
      const record = () => {
        const stage =
          document.querySelector<HTMLElement>('[data-testid="dice-roll"]')?.dataset.stage ?? null;
        if (stage === 'result' && trace.resultAt === null) trace.resultAt = performance.now();
        for (const token of scene.tokenObjects.values())
          trace.maxAngle = Math.max(trace.maxAngle, Math.abs(token.angle));
        if (phase === 'roll') trace.rollFrames.push(String(hero.frame.name));
        if (phase === 'hop') {
          trace.hopFrames.push({ k, frame: String(hero.frame.name) });
          if (k < 0.2) capture('idle-before');
          else if (k > 0.3 && k < 0.6) capture('happy-air');
          else if (k > 0.84 && k < 0.98) capture('idle-landing');
        }
        const icon = scene.children.getChildren().find((o) => o.name === 'roll-die') as
          Phaser.GameObjects.Image | undefined;
        if (icon && icon.alpha >= 0.8) {
          const b = icon.getBounds();
          const camera = scene.cameras.main;
          const a = camera.getViewMatrix().transformPoint(b.left, b.top);
          const z = camera.getViewMatrix().transformPoint(b.right, b.bottom);
          const tag = scene.nameTags.get(activeSeat)!;
          trace.die.push({
            face: String(icon.frame.name),
            top: b.top,
            bottom: b.bottom,
            tagTop: tag.getBounds().top,
            viewTop: camera.worldView.y,
            above: b.bottom <= tag.getBounds().top + 1,
            inside:
              a.x >= camera.x &&
              a.y >= camera.y &&
              z.x <= camera.x + camera.width &&
              z.y <= camera.y + camera.height,
            width: ((z.x - a.x) * game.canvas.getBoundingClientRect().width) / game.canvas.width,
            stage,
            at: performance.now(),
          });
        }
      };
      game.events.on('postrender', record);
      const play = scene.playEvents.bind(scene);
      let finish!: () => void;
      const done = new Promise<void>((r) => {
        finish = r;
      });
      scene.playEvents = async (events) => {
        await play(events);
        trace.done = true;
        trace.rest = String(hero.frame.name);
        trace.dieAtRest = scene.children.getChildren().filter((o) => o.name === 'roll-die').length;
        game.events.off('postrender', record);
        scene.tweens.add = add;
        finish();
      };
      document.querySelector<HTMLButtonElement>('[data-action-index="0"]')!.click();
      await done;
      return trace;
    });
    expect(
      trace.maxAngle,
      'sample EVERY rendered frame from Roll through landing',
    ).toBeLessThanOrEqual(15);
    expect(trace.rollFrames).toContain('happy');
    expect(trace.hopFrames.some((f) => f.k > 0.22 && f.k < 0.82 && f.frame === 'happy')).toBe(true);
    expect(
      trace.hopFrames.every((f) => f.frame === (f.k > 0.22 && f.k < 0.82 ? 'happy' : 'idle')),
    ).toBe(true);
    expect(trace.rest).toBe('idle');
    expect(trace.die.length).toBeGreaterThan(0);
    expect(trace.resultAt).not.toBeNull();
    expect(trace.die.every((d) => d.at >= trace.resultAt! && d.stage !== 'rolling')).toBe(true);
    expect(trace.die.every((d) => d.inside)).toBe(true);
    expect(trace.die.some((d) => d.above)).toBe(true);
    expect(trace.die.every((d) => d.face === (rolled <= 6 ? `dieFace${rolled}` : 'die'))).toBe(
      true,
    );
    expect(Math.max(...trace.die.map((d) => d.width))).toBeGreaterThanOrEqual(24);
    expect(trace.dieAtRest).toBe(0);
    console.log(
      `Walk C ${lang} ${width}x${height}: max |angle|=${trace.maxAngle.toFixed(2)}, ${trace.hopFrames.length} hop samples, die=${rolled}, no clipping, idle rest, 0 die leaks`,
    );
    await info.attach('walk-c-render-trace.json', {
      body: JSON.stringify(trace),
      contentType: 'application/json',
    });
    const evidence = process.env.WALK_EVIDENCE_DIR;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      for (const [name, data] of Object.entries(trace.captures)) {
        expect(data, `actual rendered ${name}`).toMatch(/^data:image\/png/);
        await writeFile(
          `${evidence}/${lang}-${info.project.name}-${name}.png`,
          Buffer.from(data.split(',')[1]!, 'base64'),
        );
      }
      await writeFile(
        `${evidence}/${lang}-${info.project.name}-trace.json`,
        JSON.stringify(trace, null, 2),
      );
    }
    await page.screenshot({ path: info.outputPath(`walk-c-rest-${lang}.png`) });
    if (process.env.AXE_SOURCE) {
      await page.addScriptTag({ path: process.env.AXE_SOURCE });
      const axe = await page.evaluate(async () =>
        (
          window as unknown as {
            axe: { run(): Promise<{ violations: Array<{ impact: string }> }> };
          }
        ).axe.run(),
      );
      const serious = axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
      console.log(`axe Walk C ${lang} ${width}x${height}: ${serious.length} serious/critical`);
      expect(serious).toEqual([]);
      await info.attach('walk-c-axe.json', {
        body: JSON.stringify(axe),
        contentType: 'application/json',
      });
    }
    const video = page.video()!;
    await page.close();
    if (evidence)
      await video.saveAs(`${evidence}/human-${lang}-${width}x${height}-${info.project.name}.webm`);
    await info.attach('walk-c-human-video', {
      path: await video.path(),
      contentType: 'video/webm',
    });
  });
}

test('bot replay keeps the 400ms hop with happy airborne and idle landing', async ({
  page,
}, info) => {
  const fixture = turningWalk();
  await page.setViewportSize({ width: 915, height: 412 });
  await observeBoardGame(page);
  await page.addInitScript((state) => {
    localStorage.setItem('diceBandits.save', JSON.stringify({ version: 2, state }));
    localStorage.setItem('lang', 'th');
    localStorage.setItem('dice-bandits:intro-seen', '1');
    localStorage.setItem('dice-bandits:tips', JSON.stringify({ enabled: false, seen: [] }));
  }, fixture.previous);
  await page.goto('/?speed=1');
  await openTitleChoice(page, 'continue');
  await page.waitForFunction(() => window.__db?.art.boardReady);
  const result = await page.evaluate(
    async ({ state, events }) => {
      const game = (window as Probe).__m5aGame;
      const scene = game.scene.getScene('BoardScene') as Board & {
        renderBoard(state: GameState): void;
        playEvents(events: GameEvent[], options: { mode: 'bot' }): Promise<void>;
      };
      scene.renderBoard(state);
      const hero = scene.tokenObjects.get(state.turnSeat)!;
      const frames: string[] = [],
        durations: number[] = [];
      const add = scene.tweens.add.bind(scene.tweens);
      scene.tweens.add = (config) => {
        if (config.progress === 1 && config.duration !== 350)
          durations.push(Number(config.duration));
        return add(config);
      };
      const record = () => frames.push(String(hero.frame.name));
      game.events.on('postrender', record);
      await scene.playEvents(events, { mode: 'bot' });
      game.events.off('postrender', record);
      scene.tweens.add = add;
      return {
        frames,
        durations,
        rest: String(hero.frame.name),
        angle: hero.angle,
        dies: scene.children.getChildren().filter((o) => o.name === 'roll-die').length,
      };
    },
    { state: fixture.previous, events: fixture.events },
  );
  expect(result.durations.length).toBeGreaterThanOrEqual(3);
  expect(result.durations.every((ms) => ms === 400)).toBe(true);
  expect(result.frames).toContain('happy');
  expect(result.rest).toBe('idle');
  expect(result.angle).toBe(0);
  expect(result.dies).toBe(0);
  console.log(
    `Walk C bot: ${result.durations.length} x 400ms hops, happy airborne, idle rest, 0 die leaks`,
  );
  await info.attach('walk-c-bot-trace', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  const video = page.video()!;
  await page.close();
  if (process.env.WALK_EVIDENCE_DIR)
    await video.saveAs(`${process.env.WALK_EVIDENCE_DIR}/bot-th-915x412-${info.project.name}.webm`);
  await info.attach('walk-c-bot-video', {
    path: await video.path(),
    contentType: 'video/webm',
  });
});
