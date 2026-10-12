import {
  chooseAction,
  createGame,
  legalActions,
  step,
  type GameEvent,
  type GameState,
} from '@dice-bandits/engine';
import { expect, test, type Page } from '@playwright/test';
import type Phaser from 'phaser';
import { openTitleChoice, observeBoardGame, startJourney } from './helpers';

test.use({ video: 'on' });

type Point = { x: number; y: number };
type Sample = { token: Point; projected: Point; spaces: Point[]; lift: number };
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
        let hopIndex = -1;
        let progress: { progress: number } | undefined;
        const add = scene.tweens.add.bind(scene.tweens);
        scene.tweens.add = (config) => {
          const c = config as Phaser.Types.Tweens.TweenBuilderConfig;
          if (c.progress === 1) {
            hopIndex++;
            progress = c.targets as { progress: number };
          }
          return add(config);
        };
        const record = () => {
          const from = spaces[Math.max(0, hopIndex)]!;
          const to = spaces[Math.max(0, hopIndex) + 1]!;
          const k = progress?.progress ?? 0;
          const groundY = from.y + (to.y - from.y) * k;
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
            projected: project({ x: token.x, y: groundY }),
            lift: groundY - token.y,
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
      expect(Math.max(...probe.samples.map((sample) => sample.lift))).toBeGreaterThan(25);
      expect(probe.samples.every((sample) => sample.lift >= -0.01 && sample.lift <= 26.01)).toBe(
        true,
      );
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

test('real bot follow view tracks hops and reuses a readable overhead counter', async ({
  page,
}, info) => {
  const fixture = fiveStepWalk();
  const seat = fixture.moves[0]!.seat!;
  expect(fixture.previous.players[seat]!.control).toBe('bot');
  await observeBoardGame(page);
  await startJourney(page);
  await page.waitForFunction(() => window.__db?.art.boardReady);
  await page.evaluate(
    ({ previous, moves, seat }) => {
      const game = (window as ProbeWindow).__m5aGame!;
      const scene = game.scene.getScene('BoardScene') as Phaser.Scene & {
        tokenObjects: Map<number, Phaser.GameObjects.Image>;
        walkCounter?: Phaser.GameObjects.Container;
        walkCountText?: Phaser.GameObjects.Text;
        playEvents(events: GameEvent[]): Promise<void>;
        toggleWholeMap(state: GameState, whole: boolean): void;
      };
      window.diceBanditsSpeed = 0;
      game.events.emit('game-state', previous);
      scene.toggleWholeMap(previous, false);
      window.diceBanditsSpeed = 1;
      const token = scene.tokenObjects.get(seat)!;
      const probe = {
        done: false,
        frames: [] as Array<{ count: string; visible: boolean; offsetX: number; offsetY: number }>,
        elapsed: 0,
      };
      (window as unknown as { __botFollow: typeof probe }).__botFollow = probe;
      const record = () =>
        probe.frames.push({
          count: scene.walkCountText?.text ?? '',
          visible: scene.walkCounter?.visible ?? false,
          offsetX: (scene.walkCounter?.x ?? token.x) - token.x,
          offsetY: (scene.walkCounter?.y ?? token.y) - (token.y - token.displayHeight - 8),
        });
      game.events.on('postrender', record);
      const started = performance.now();
      void scene.playEvents(moves).then(() => {
        record();
        probe.elapsed = performance.now() - started;
        probe.done = true;
        game.events.off('postrender', record);
      });
    },
    { previous: fixture.previous, moves: fixture.moves, seat },
  );
  await page.waitForFunction(() =>
    (
      window as unknown as { __botFollow: { frames: Array<{ count: string; visible: boolean }> } }
    ).__botFollow.frames.some((frame) => frame.visible && frame.count === '4'),
  );
  await page.screenshot({ path: info.outputPath('bot-follow-counter.png') });
  await page.waitForFunction(
    () => (window as unknown as { __botFollow: { done: boolean } }).__botFollow.done,
  );
  const probe = await page.evaluate(
    () =>
      (
        window as unknown as {
          __botFollow: {
            frames: Array<{ count: string; visible: boolean; offsetX: number; offsetY: number }>;
            elapsed: number;
          };
        }
      ).__botFollow,
  );
  const visible = probe.frames.filter((frame) => frame.visible);
  expect([...new Set(visible.map((frame) => frame.count))]).toEqual(['4', '3', '2', '1']);
  expect(
    visible.every((frame) => Math.abs(frame.offsetX) < 0.01 && Math.abs(frame.offsetY) < 0.01),
  ).toBe(true);
  expect(probe.frames.at(-1)).toMatchObject({ visible: false, count: '' });
  // Same -30/+670ms browser tolerance as the human walk; authored bot total 3,050ms.
  expect(probe.elapsed).toBeGreaterThanOrEqual(3020);
  expect(probe.elapsed).toBeLessThan(3720);
  await info.attach('bot-follow.json', {
    body: JSON.stringify(probe),
    contentType: 'application/json',
  });
});

function goldWalk() {
  let state = createGame({
    seed: 'm6-readout-1',
    rounds: 30,
    seats: [
      { name: 'Sir Bram', classId: 'knight', control: 'human', personality: null },
      { name: 'Mint', classId: 'thief', control: 'human', personality: null },
    ],
  });
  for (let action = 0; action < 1200 && state.phase.kind !== 'gameOver'; action++) {
    const actor = state.players.find((player) => legalActions(state, player.seat).length)!;
    const result = step(state, chooseAction(state, actor.seat));
    if (
      result.events.filter((event) => event.type === 'Moved').length === 5 &&
      result.events.some((event) => event.type === 'GoldGained')
    )
      return { previous: state, next: result.state, events: result.events };
    state = result.state;
  }
  throw new Error('No legally replayed five-step gold landing');
}

type LocalWalk = {
  done: boolean;
  started: number;
  ended?: number;
  resized?: number;
  resizeEvents: number;
  counts: Array<{ remaining: number; at: number; text: string }>;
  hops: Array<{ at: number; duration: number }>;
  frames: Array<{ at: number; count: string; token: Point; overlap: boolean; clamped: boolean }>;
};
type LocalProbe = ProbeWindow & { __localWalk: LocalWalk };

async function startGoldWalk(page: Page, lang: 'th' | 'en', speed = 1, reduced = false) {
  const fixture = goldWalk();
  await observeBoardGame(page);
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.addInitScript(
    ({ previous, lang }) => {
      localStorage.setItem('diceBandits.save', JSON.stringify({ version: 2, state: previous }));
      localStorage.setItem('lang', lang);
      localStorage.setItem('dice-bandits:intro-seen', '1');
      localStorage.setItem('dice-bandits:tips', JSON.stringify({ enabled: false, seen: [] }));
    },
    { previous: fixture.previous, lang },
  );
  await page.goto(`/?speed=${speed}`);
  await openTitleChoice(page, 'continue');
  await page.waitForFunction(() => window.__db?.art.boardReady);
  await page.evaluate(() => {
    const probe = window as LocalProbe;
    const game = probe.__m5aGame!;
    const scene = game.scene.getScene('BoardScene') as Phaser.Scene & {
      tokenObjects: Map<number, Phaser.GameObjects.Image>;
      latestState: GameState;
      playEvents(
        events: GameEvent[],
        options?: { onStep?: (remaining: number, seat: number) => void },
      ): Promise<void>;
    };
    const trace: LocalWalk = {
      done: false,
      started: 0,
      resizeEvents: 0,
      counts: [],
      hops: [],
      frames: [],
    };
    probe.__localWalk = trace;
    game.scale.on('resize', () => {
      trace.resizeEvents++;
      trace.resized = performance.now();
    });
    const token = scene.tokenObjects.get(scene.latestState.turnSeat)!;
    const add = scene.tweens.add.bind(scene.tweens);
    scene.tweens.add = (config) => {
      const c = config as Phaser.Types.Tweens.TweenBuilderConfig;
      const progress = c.targets as { progress?: number };
      if (typeof progress?.progress === 'number' && c.progress === 1)
        trace.hops.push({ at: performance.now(), duration: Number(c.duration) });
      return add(config);
    };
    const record = () => {
      if (!trace.started || trace.done) return;
      const canvas = game.canvas.getBoundingClientRect();
      const point = scene.cameras.main.getViewMatrix().transformPoint(token.x, token.y);
      const p = {
        x: canvas.left + (point.x * canvas.width) / game.canvas.width,
        y: canvas.top + (point.y * canvas.height) / game.canvas.height,
      };
      const width =
        (token.displayWidth * scene.cameras.main.zoom * canvas.width) / game.canvas.width;
      const height =
        (token.displayHeight * scene.cameras.main.zoom * canvas.height) / game.canvas.height;
      const rect = document
        .querySelector('[data-testid="movement-readout"]')
        ?.getBoundingClientRect();
      const world = scene.cameras.main.worldView;
      trace.frames.push({
        at: performance.now(),
        token: p,
        count: document.querySelector('[data-testid="movement-remaining"]')?.textContent ?? '',
        overlap:
          !!rect &&
          rect.width > 0 &&
          p.x + width / 2 > rect.left &&
          p.x - width / 2 < rect.right &&
          p.y > rect.top &&
          p.y - height < rect.bottom,
        clamped: world.left >= -1 && world.top >= -1 && world.right <= 3201 && world.bottom <= 1801,
      });
    };
    game.events.on('postrender', record);
    const play = scene.playEvents.bind(scene);
    scene.playEvents = async (events) => {
      trace.started = performance.now();
      try {
        await play(events, {
          onStep: (remaining) => {
            trace.counts.push({
              remaining,
              at: performance.now(),
              text: document.querySelector('[data-testid="movement-remaining"]')?.textContent ?? '',
            });
          },
        });
      } finally {
        trace.ended = performance.now();
        trace.done = true;
        game.events.off('postrender', record);
      }
    };
  });
  return fixture;
}

for (const lang of ['th', 'en'] as const) {
  for (const short of [false, true]) {
    test(`real human roll counts planted hops and real gold arrival ${lang}${short ? ' 932x388' : ''}`, async ({
      page,
    }, info) => {
      if (short) await page.setViewportSize({ width: 932, height: 388 });
      const fixture = await startGoldWalk(page, lang);
      await page.locator('[data-action-index="0"]').click();
      await expect(page.getByTestId('movement-remaining')).toBeVisible();
      await page.screenshot({ path: info.outputPath('mid-walk.png') });
      const gold = fixture.events.find((event) => event.type === 'GoldGained')!.params.amount;
      const goldText = lang === 'th' ? `ได้รับ ${gold} ทอง` : `${gold} gold gained`;
      // Sample the human arrival's visibility, text and geometry in one browser task.
      const geometryHandle = await page.waitForFunction((expectedGold) => {
        const card = document.querySelector<HTMLElement>('[data-testid="movement-readout"]');
        const arrival = card?.querySelector<HTMLElement>('[data-testid="movement-arrival"]');
        if (
          !card ||
          !arrival ||
          arrival.getBoundingClientRect().width === 0 ||
          getComputedStyle(arrival).visibility !== 'visible' ||
          !arrival.textContent?.includes(expectedGold)
        )
          return false;
        const readout = card.getBoundingClientRect();
        const controls = [
          ...document.querySelectorAll<HTMLElement>(
            '.game-topline button, .action-tray, .game-dialog',
          ),
        ]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              label: el.textContent,
              overlaps:
                r.left < readout.right &&
                r.right > readout.left &&
                r.top < readout.bottom &&
                r.bottom > readout.top,
            };
          });
        const text = [
          ...document.querySelectorAll<HTMLElement>('.movement-readout, .movement-readout *'),
        ].map((el) => ({
          clipped: el.scrollWidth > el.clientWidth + 1,
          size: parseFloat(getComputedStyle(el).fontSize),
        }));
        return {
          controls,
          text,
          goldText: arrival.textContent,
          width: innerWidth,
          height: innerHeight,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      }, goldText);
      const geometry = await geometryHandle.jsonValue();
      await geometryHandle.dispose();
      if (!geometry) throw new Error('No visible human arrival geometry');
      expect(geometry.goldText).toContain(goldText);
      expect(geometry.controls.every((control) => !control.overlaps)).toBe(true);
      expect(geometry.text.every((text) => !text.clipped && text.size >= 14)).toBe(true);
      expect(geometry.overflow).toBe(false);
      await page.screenshot({ path: info.outputPath('arrival.png') });
      await page.waitForFunction(() => (window as LocalProbe).__localWalk.done);
      const trace = await page.evaluate(() => (window as LocalProbe).__localWalk);
      await info.attach('counted-walk.json', {
        body: JSON.stringify({ geometry, trace }),
        contentType: 'application/json',
      });
      expect(trace.counts.map((count) => count.remaining)).toEqual([4, 3, 2, 1, 0]);
      expect(trace.counts.map((count) => count.text)).toEqual(
        [4, 3, 2, 1, 0].map((count) =>
          lang === 'th' ? `เหลือ ${count} ช่อง` : `${count} spaces left`,
        ),
      );
      expect(trace.hops.map((hop) => hop.duration)).toEqual([560, 560, 560, 560, 560]);
      for (let i = 1; i < trace.hops.length; i++)
        expect(
          trace.hops[i]!.at - trace.counts[i - 1]!.at,
          'actual planted dwell before next hop',
        ).toBeGreaterThanOrEqual(135);
      // 5*(560+140) + 300 lead-in + 180 settle + 650 arrival = 4,630ms.
      // Keep the original browser tolerance (-30/+670ms), not a wider bound.
      expect(trace.ended! - trace.hops[0]!.at + 300).toBeGreaterThanOrEqual(4600);
      expect(trace.ended! - trace.hops[0]!.at + 300).toBeLessThan(5300);
      expect(trace.frames.length).toBeGreaterThan(30);
      expect(trace.frames.every((frame) => !frame.overlap && frame.clamped)).toBe(true);
      expect(trace.frames.filter((frame) => frame.count).length).toBeGreaterThan(5);
      await expect(page.getByTestId('movement-readout')).toHaveCount(0);
      await expect(page.locator('[data-action-index="0"]')).toBeEnabled();
      expect(JSON.stringify(await page.evaluate(() => window.__db!.getState()))).toBe(
        JSON.stringify(fixture.next),
      );
      await page.locator('[data-action-index="0"]').click();
      await expect(page.getByTestId('dice-roll')).toBeVisible();
    });
  }
}

for (const phase of ['hop', 'pause', 'arrival'] as const) {
  test(`real resize during ${phase} settles playback and commits endpoint`, async ({
    page,
  }, info) => {
    const fixture = await startGoldWalk(page, 'en', 1, false);
    await page.locator('[data-action-index="0"]').click();
    if (phase === 'arrival') {
      await page.getByTestId('movement-arrival').waitFor({ state: 'visible' });
    } else {
      await page.waitForFunction((phase) => {
        const trace = (window as unknown as LocalProbe).__localWalk;
        if (!trace.started || trace.done) return false;
        if (phase === 'pause')
          return trace.counts.length === 1 && performance.now() - trace.counts[0]!.at < 100;
        return (
          trace.hops.length === 2 &&
          trace.counts.length === 1 &&
          performance.now() - trace.hops[1]!.at > 40
        );
      }, phase);
    }
    await expect(page.locator('[data-action-index="0"]')).toBeDisabled();
    const original = page.viewportSize()!;
    await page.setViewportSize({ width: original.width + 17, height: original.height - 24 });
    await page.waitForFunction(() => {
      const trace = (window as unknown as LocalProbe).__localWalk;
      return trace.resizeEvents > 0 && trace.done;
    });
    const atResize = await page.evaluate(() => (window as unknown as LocalProbe).__localWalk);
    expect(atResize.ended! - atResize.resized!).toBeLessThan(100);
    await expect(page.getByTestId('movement-readout')).toHaveCount(0);
    await expect(page.locator('[data-action-index="0"]')).toBeEnabled();
    expect(await page.evaluate(() => localStorage.getItem('diceBandits.save'))).toContain(
      JSON.stringify(fixture.next),
    );
    const endpoint = await page.evaluate((seat) => {
      const scene = (window as unknown as LocalProbe).__m5aGame!.scene.getScene(
        'BoardScene',
      ) as unknown as { tokenObjects: Map<number, Point> };
      const token = scene.tokenObjects.get(seat)!;
      return { x: token.x, y: token.y };
    }, fixture.previous.turnSeat);
    const nextSpace = fixture.next.board.spaces.find(
      (space) => space.id === fixture.next.players[fixture.previous.turnSeat]!.pos,
    )!;
    expect(endpoint.x).toBeCloseTo(nextSpace.x);
    expect(endpoint.y).toBeCloseTo(nextSpace.y);
    await page.waitForTimeout(900);
    const later = await page.evaluate(() => (window as unknown as LocalProbe).__localWalk);
    expect(later.counts).toEqual(atResize.counts);
    expect(later.hops).toEqual(atResize.hops);
    await expect(page.getByTestId('movement-readout')).toHaveCount(0);
    await info.attach('real-resize.json', {
      body: JSON.stringify({ phase, atResize, later, endpoint }),
      contentType: 'application/json',
    });
  });
}

for (const policy of ['speed zero', 'reduced motion']) {
  test(`real human ${policy} reaches the authoritative endpoint without movement waits`, async ({
    page,
  }, info) => {
    const fixture = await startGoldWalk(
      page,
      'th',
      policy === 'speed zero' ? 0 : 1,
      policy === 'reduced motion',
    );
    await page.locator('[data-action-index="0"]').click();
    await page.waitForFunction(() => (window as LocalProbe).__localWalk.done);
    const trace = await page.evaluate(() => (window as LocalProbe).__localWalk);
    expect(trace.hops).toEqual([]);
    expect(trace.counts.map((count) => count.remaining)).toEqual([4, 3, 2, 1, 0]);
    expect(trace.ended! - trace.started).toBeLessThan(100);
    expect(JSON.stringify(await page.evaluate(() => window.__db!.getState()))).toBe(
      JSON.stringify(fixture.next),
    );
    await expect(page.locator('[data-action-index="0"]')).toBeEnabled();
    // Wait for actual Phaser rendered frames, not just resolved callbacks.
    const frames = await page.evaluate(async () => {
      const game = (window as unknown as LocalProbe).__m5aGame!;
      const result: Array<{ count: string; arrival: string; visible: boolean }> = [];
      for (let frame = 0; frame < 2; frame++) {
        await new Promise<void>((resolve) => game.events.once('postrender', () => resolve()));
        const count = document.querySelector<HTMLElement>('[data-testid="movement-remaining"]');
        const arrival = document.querySelector<HTMLElement>('[data-testid="movement-arrival"]');
        result.push({
          count: count?.textContent ?? '',
          arrival: arrival?.textContent ?? '',
          visible:
            !!count &&
            !!arrival &&
            count.getBoundingClientRect().width > 0 &&
            arrival.getBoundingClientRect().width > 0,
        });
      }
      return result;
    });
    const gold = fixture.events.find((event) => event.type === 'GoldGained')!.params.amount;
    expect(
      frames.every(
        (frame) =>
          frame.visible &&
          frame.count === 'เหลือ 0 ช่อง' &&
          frame.arrival.includes(`ได้รับ ${gold} ทอง`),
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`static-${policy}.png`) });
    // An unrelated real input supersedes the static card, without a wait.
    await page.getByTestId('map-toggle').click();
    await expect(page.getByTestId('movement-readout')).toHaveCount(0);
    await expect(page.locator('[data-action-index="0"]')).toBeEnabled();
    await info.attach('static-walk.json', {
      body: JSON.stringify({ trace, frames }),
      contentType: 'application/json',
    });
  });
}
