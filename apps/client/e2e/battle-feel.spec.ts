import { expect, test, type Page } from '@playwright/test';
import {
  createGame,
  startBattle,
  step,
  type GameEvent,
  type GameState,
} from '@dice-bandits/engine';
import type Phaser from 'phaser';
import type { BattleBeat } from '../src/scenes/battle/presentation';
import { observeBoardGame, startBattleJourney } from './helpers';

type Sample = {
  kind: string;
  at: number;
  hp: string[];
  meters: string[];
  beat: BattleBeat;
  locked: boolean;
};
type Probe = Window & {
  __m5aGame: Phaser.Game;
  __beats: Sample[];
  __battleEvents: GameEvent[];
  __battleStart: number;
  __battleFinish: number;
};
async function instrument(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = window as Probe;
    probe.__beats = [];
    const scene = probe.__m5aGame.scene.getScene('BattleScene') as Phaser.Scene & {
      playEvents(
        events: GameEvent[],
        speed: number,
        options?: { onBeat?: (beat: BattleBeat) => void },
      ): Promise<void>;
    };
    const original = scene.playEvents.bind(scene);
    scene.playEvents = async (events, speed, options) => {
      probe.__battleStart = performance.now();
      probe.__battleFinish = 0;
      probe.__battleEvents = events;
      await original(
        events,
        speed,
        options && {
          ...options,
          onBeat(beat) {
            options.onBeat?.(beat);
            probe.__beats.push({
              kind: beat.kind,
              beat,
              at: performance.now(),
              hp: [...document.querySelectorAll('.battle-hp-value')].map((el) => el.textContent!),
              meters: [...document.querySelectorAll('.battle-hp-track')].map((el) =>
                el.getAttribute('aria-valuenow')!,
              ),
              locked: [...document.querySelectorAll<HTMLButtonElement>('.action-bar button')].every(
                (el) => el.disabled,
              ),
            });
          },
        },
      );
      probe.__battleFinish = performance.now();
    };
  });
}

for (const lang of ['en', 'th']) {
  test(`human seven beats hold HP until drain and lock dispatch (${lang})`, async ({
    page,
  }, info) => {
    const cpuRate = Number(process.env.BATTLE_FEEL_CPU_RATE ?? '1');
    if (cpuRate !== 1 && cpuRate !== 4) {
      throw new Error('BATTLE_FEEL_CPU_RATE must be 1 or 4');
    }
    await observeBoardGame(page);
    await page.addInitScript((lang) => localStorage.setItem('lang', lang), lang);
    await startBattleJourney(page, 1);
    const cpuSession = cpuRate === 4 ? await page.context().newCDPSession(page) : undefined;
    try {
      await cpuSession?.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
      await instrument(page);
      await page.evaluate(() => {
        window.diceBanditsSpeed = 1;
      });
      const before = await page.locator('.battle-hp-value').allTextContents();
      await page.getByTestId('pick-attack').click();
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      if (info.project.name === 'mobile-landscape' && lang === 'th') {
        for (const kind of ['anticipation', 'damage', 'drain', 'result']) {
          await page.waitForFunction(
            (kind) =>
              document.querySelector<HTMLElement>('[data-testid="battle-readout"]')?.dataset
                .beat === kind,
            kind,
            { polling: 'raf', timeout: 5000 },
          );
          await page.screenshot({ path: info.outputPath(`battle-${kind}-${lang}.png`) });
        }
      }
      await expect.poll(() => page.evaluate(() => (window as Probe).__beats.length)).toBe(7);
      const samples = await page.evaluate(() => (window as Probe).__beats);
      expect(samples.map((s) => s.kind)).toEqual([
        'reveal',
        'anticipation',
        'lunge',
        'impact',
        'damage',
        'drain',
        'result',
      ]);
      expect(samples.every((s) => s.locked)).toBe(true);
      for (const sample of samples.slice(0, 6)) expect(sample.hp).toEqual(before);
      for (const target of samples[5]!.beat.targets) {
        const index = target.side === 'a' ? 0 : 1;
        expect(Number(samples[6]!.hp[index]!.split('/')[0])).toBe(target.toHp);
        expect(Number(samples[6]!.meters[index])).toBe(target.toHp);
      }
      await page.screenshot({ path: info.outputPath(`battle-result-${lang}.png`) });
      await expect
        .poll(() => page.evaluate(() => (window as Probe).__battleFinish || 0))
        .toBeGreaterThan(0);
      const timing = await page.evaluate(() => {
        const p = window as Probe;
        return {
          elapsed: p.__battleFinish - p.__battleStart,
          samples: p.__beats,
          events: p.__battleEvents,
        };
      });
      expect(timing.elapsed).toBeGreaterThanOrEqual(2220);
      expect(timing.elapsed).toBeLessThan(3500);
      await info.attach('battle-timing', {
        body: JSON.stringify({ ...timing, cpuRate, cpuThrottlingApplied: !!cpuSession }),
        contentType: 'application/json',
      });
      await expect(page.locator('.action-bar button:enabled').first()).toBeVisible();
    } finally {
      if (cpuSession) {
        try {
          await cpuSession.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        } finally {
          await cpuSession.detach();
        }
      }
    }
  });
}

for (const mode of ['zero', 'reduced'] as const) {
  test(`${mode} reconciles immediately without animated beats`, async ({ page }) => {
    await observeBoardGame(page);
    if (mode === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
    await startBattleJourney(page, mode === 'zero' ? 0 : 1);
    await instrument(page);
    await page.getByTestId('pick-attack').click();
    await expect.poll(() => page.evaluate(() => (window as Probe).__beats.length)).toBe(1);
    const sample = await page.evaluate(() => (window as Probe).__beats[0]!);
    expect(sample.kind).toBe('result');
    expect(sample.beat.duration).toBe(0);
    for (const target of sample.beat.targets) {
      const index = target.side === 'a' ? 0 : 1;
      expect(Number(sample.hp[index]!.split('/')[0])).toBe(target.toHp);
      expect(Number(sample.meters[index])).toBe(target.toHp);
    }
  });
}

for (const boundary of ['resize', 'shutdown'] as const)
  test(`${boundary} cancels pending scene waits, clears transient effects and commits final HP`, async ({
    page,
  }) => {
    await observeBoardGame(page);
    await startBattleJourney(page, 1);
    await instrument(page);
    await page.evaluate(() => {
      window.diceBanditsSpeed = 1;
    });
    await page.getByTestId('pick-attack').click();
    await expect
      .poll(() => page.evaluate(() => (window as Probe).__beats.length))
      .toBeGreaterThan(0);
    if (boundary === 'resize') await page.setViewportSize({ width: 932, height: 388 });
    else await page.evaluate(() => (window as Probe).__m5aGame.scene.stop('BattleScene'));
    await expect
      .poll(() => page.evaluate(() => (window as Probe).__battleFinish || 0), { timeout: 1500 })
      .toBeGreaterThan(0);
    const final = await page.evaluate(() => {
      const state = window.__db!.getState();
      const hp = [...document.querySelectorAll('.battle-hp-value')].map((el) =>
        Number(el.textContent!.split('/')[0]),
      );
      const scene = (window as Probe).__m5aGame.scene.getScene('BattleScene');
      return {
        hp,
        expected:
          state.phase.kind === 'battle' ? [state.phase.battle.a.hp, state.phase.battle.b.hp] : [],
        effects: scene.children.getChildren().filter((el) => el.name.startsWith('battle-effect-'))
          .length,
      };
    });
    expect(final.hp).toEqual(final.expected);
    expect(final.effects).toBe(0);
  });

// Real engine fixtures isolate matrix outcomes without fabricating events/RNG.
function exchangeFixture(kind: 'counter' | 'blocked' | 'secret' | 'end'): GameState {
  const state = createGame({
    seed: `r2c-${kind}`,
    rounds: 24,
    seats: [
      {
        name: 'Hero',
        classId: kind === 'secret' ? 'mage' : kind === 'blocked' ? 'cleric' : 'thief',
        control: 'human',
        personality: null,
      },
      {
        name: 'Rival',
        classId: kind === 'blocked' ? 'cleric' : 'knight',
        control: 'human',
        personality: null,
      },
    ],
  });
  const rival = state.players[1]!;
  if (kind === 'end') rival.hp = 1;
  return startBattle(state, {
    context: 'pvp',
    spaceId: state.players[0]!.pos,
    opponent: {
      kind: 'player',
      seat: 1,
      monsterId: null,
      level: rival.level,
      hp: rival.hp,
      stats: rival.stats,
      secretUsed: false,
      buffs: { ironSkin: false, poison: false, halveNext: false },
    },
  }).state;
}

async function mountFixture(page: Page, state: GameState): Promise<void> {
  await page.goto('/?speed=1');
  await page.evaluate((state) => {
    document
      .querySelector('#app')!
      .dispatchEvent(new CustomEvent('dice-bandits:continue', { detail: state }));
  }, state);
  await page.waitForFunction(() => window.__db?.art.battleReady);
}

for (const lang of ['en', 'th'])
  for (const kind of ['counter', 'blocked', 'secret', 'end'] as const)
    test(`engine ${kind} preserves seven beats, privacy and final HP (${lang})`, async ({
      page,
    }, info) => {
      await observeBoardGame(page);
      await page.addInitScript((lang) => localStorage.setItem('lang', lang), lang);
      const initial = exchangeFixture(kind);
      expect(initial.phase).toMatchObject({ kind: 'battle', battle: { attackerSide: 'a' } });
      await mountFixture(page, initial);
      await page.getByTestId('pass-ready').click();
      const first =
        kind === 'counter'
          ? 'strike'
          : kind === 'blocked' || kind === 'secret'
            ? 'secret'
            : 'attack';
      const second = kind === 'counter' ? 'counter' : 'defend';
      const pending = step(initial, { type: 'battlePick', side: 'a', pick: first });
      const resolved = step(pending.state, { type: 'battlePick', side: 'b', pick: second });
      await page.getByTestId(`pick-${first}`).click();
      await expect(page.getByTestId('pass-screen')).toBeVisible();
      await expect(page.getByTestId('battle-readout')).toHaveCount(0);
      await expect(page.getByTestId('chosen-card')).toHaveText('?');
      // No pre-reveal secret name in DOM/aria; pass flow is never bypassed.
      if (first === 'secret') {
        const html = await page.locator('#app').innerHTML();
        // A player's inventory may legitimately contain an unrelated card;
        // only the pending class-secret name must remain absent.
        expect(html).not.toContain(kind === 'secret' ? 'Firestorm' : 'Sanctuary');
      }
      await page.getByTestId('pass-ready').click();
      const before = await page.locator('.battle-hp-value').allTextContents();
      await instrument(page);
      await page.getByTestId(`pick-${second}`).click();
      await expect.poll(() => page.evaluate(() => (window as Probe).__beats.length)).toBe(7);
      const samples = await page.evaluate(() => (window as Probe).__beats);
      expect(samples.map((sample) => sample.kind)).toEqual([
        'reveal',
        'anticipation',
        'lunge',
        'impact',
        'damage',
        'drain',
        'result',
      ]);
      expect(samples.every((sample) => sample.locked)).toBe(true);
      for (const sample of samples.slice(0, 6)) expect(sample.hp).toEqual(before);
      const damage = samples[4]!.beat;
      if (kind === 'counter') {
        expect(damage.outcome).toBe('countered');
        expect(damage.targets).toEqual([
          expect.objectContaining({ side: 'a', amount: expect.any(Number) }),
        ]);
        expect(damage.targets[0]!.amount).toBeGreaterThan(0);
      }
      if (kind === 'blocked') {
        expect(damage.outcome).toBe('blocked');
        expect(damage.targets).toEqual([]);
      }
      if (kind === 'secret') {
        expect(samples[0]!.beat.revealed).toEqual([{ side: 'a', secretId: 'firestorm' }]);
        expect(damage.targets[0]!.amount).toBeGreaterThan(0);
      }
      for (const target of samples[5]!.beat.targets) {
        const index = target.side === 'a' ? 0 : 1;
        expect(Number(samples[6]!.hp[index]!.split('/')[0])).toBe(target.toHp);
        expect(Number(samples[6]!.meters[index])).toBe(target.toHp);
      }
      await page.screenshot({ path: info.outputPath(`${kind}-result-${lang}.png`) });
      await expect
        .poll(() => page.evaluate(() => (window as Probe).__battleFinish))
        .toBeGreaterThan(0);
      expect(await page.evaluate(() => window.__db!.getState())).toEqual(resolved.state);
      if (kind === 'end') {
        expect(resolved.events.some((event) => event.type === 'BattleEnded')).toBe(true);
        expect(samples[6]!.beat.result).toBe('win');
        await expect(page.locator('.battle-hud')).toHaveCount(0);
        expect(
          await page.evaluate(() => (window as Probe).__m5aGame.scene.isActive('BattleScene')),
        ).toBe(false);
      } else {
        await expect(page.getByTestId('pass-screen')).toBeVisible();
        await page.getByTestId('pass-ready').click();
        await expect(page.locator('.action-bar button:enabled').first()).toBeVisible();
      }
      await info.attach('engine-exchange', {
        body: JSON.stringify({ events: resolved.events, samples }),
        contentType: 'application/json',
      });
    });

test('bot-only scene plan fits the 600ms budget with no extra beat delay', async ({
  page,
}, info) => {
  await observeBoardGame(page);
  const previous = exchangeFixture('counter');
  previous.players.forEach((player) => (player.control = 'bot'));
  const pending = step(previous, { type: 'battlePick', side: 'a', pick: 'strike' });
  const next = step(pending.state, { type: 'battlePick', side: 'b', pick: 'counter' });
  await mountFixture(page, pending.state);
  const sample = await page.evaluate(
    async ({ previous, next }) => {
      const scene = (window as Probe).__m5aGame.scene.getScene('BattleScene') as Phaser.Scene & {
        playEvents(
          events: GameEvent[],
          speed: number,
          options: {
            previous: GameState;
            next: GameState;
            mode: 'bot';
            onBeat: (beat: BattleBeat) => void;
          },
        ): Promise<void>;
      };
      const beats: BattleBeat[] = [];
      const started = performance.now();
      await scene.playEvents(next.events, 1, {
        previous,
        next: next.state,
        mode: 'bot',
        onBeat: (beat) => beats.push(beat),
      });
      return {
        elapsed: performance.now() - started,
        beats,
        renderer: (window as Probe).__m5aGame.renderer.type,
      };
    },
    { previous: pending.state, next },
  );
  expect(sample.beats).toHaveLength(7);
  expect(sample.beats.reduce((sum, beat) => sum + beat.duration, 0)).toBeLessThanOrEqual(600);
  // Phaser timers settle on rendered frames; report wall time separately.
  expect(sample.elapsed).toBeLessThanOrEqual(600);
  console.log('bot scene timing:', JSON.stringify(sample));
  await info.attach('bot-timing', {
    body: JSON.stringify(sample),
    contentType: 'application/json',
  });
});

test('zero-damage event renders a miss beat without a fictitious damage sprite', async ({
  page,
}, info) => {
  await observeBoardGame(page);
  const previous = exchangeFixture('counter');
  await mountFixture(page, previous);
  // The current engine has no natural miss branch (matrix damage is min 1).
  // Exercise the presentation's zero-damage contract explicitly, not as RNG evidence.
  const sample = await page.evaluate(async (state) => {
    const game = (window as Probe).__m5aGame;
    const scene = game.scene.getScene('BattleScene') as Phaser.Scene & {
      playEvents(
        events: GameEvent[],
        speed: number,
        options: {
          previous: GameState;
          next: GameState;
          mode: 'human';
          onBeat: (beat: BattleBeat) => void;
        },
      ): Promise<void>;
    };
    const beats: BattleBeat[] = [];
    let damageSprites = 0;
    await scene.playEvents(
      [
        {
          type: 'DamageDealt',
          seat: 0,
          params: { attacker: 0, defender: 1, toAttacker: 0, toDefender: 0 },
        },
      ],
      1,
      {
        previous: state,
        next: state,
        mode: 'human',
        onBeat: (beat) => {
          beats.push(beat);
          damageSprites += scene.children
            .getChildren()
            .filter((object) => object.name === 'battle-effect-damage').length;
        },
      },
    );
    return { beats, damageSprites };
  }, previous);
  expect(sample.beats.map((beat) => beat.kind)).toEqual([
    'reveal',
    'anticipation',
    'lunge',
    'impact',
    'damage',
    'drain',
    'result',
  ]);
  expect(sample.beats[4]).toMatchObject({ outcome: 'miss', targets: [] });
  expect(sample.damageSprites).toBe(0);
  await info.attach('zero-damage-miss', {
    body: JSON.stringify(sample),
    contentType: 'application/json',
  });
});

test('two real online browsers commit battle views and act before detached beats finish', async ({
  page: host,
  browser,
}, info) => {
  test.setTimeout(90000);
  const context = await browser.newContext({
    storageState: 'e2e/storage-state.json',
    viewport: info.project.use.viewport,
  });
  try {
    const guest = await context.newPage();
    const pages = [host, guest];
    for (const page of pages) await observeBoardGame(page);
    await host.goto('http://127.0.0.1:8787/?speed=1');
    await host.getByTestId('online-create').click();
    await host.getByTestId('online-name').fill('Alice');
    await host.getByTestId('online-create-submit').click();
    await expect(host.getByTestId('screen-lobby')).toBeVisible();
    const code = (await host.locator('.room-code strong').textContent())!.trim();
    await guest.goto(`http://127.0.0.1:8787/r/${code}?speed=1`);
    await guest.getByTestId('online-name').fill('Bob');
    await guest.getByTestId('online-join-submit').click();
    await expect(guest.getByTestId('screen-lobby')).toBeVisible();
    await host.getByTestId('lobby-start').click();
    for (const page of pages) {
      await page.waitForFunction(() => window.__db?.art.boardReady);
      await page.evaluate(() => {
        window.diceBanditsSpeed = 1;
        const probe = window as Probe & {
          __onlineBattle: Array<{
            started: number;
            finished: number;
            beats: BattleBeat[];
            matched: boolean;
            state: GameState;
          }>;
        };
        probe.__onlineBattle = [];
        const game = probe.__m5aGame;
        const scene = game.scene.getScene('BattleScene') as Phaser.Scene & {
          playEvents(...args: unknown[]): Promise<void>;
        };
        const original = scene.playEvents.bind(scene);
        scene.playEvents = async (events, speed, options: unknown) => {
          const opts = options as { next: GameState; onBeat?: (beat: BattleBeat) => void };
          const sample = {
            started: performance.now(),
            finished: 0,
            beats: [] as BattleBeat[],
            matched: true,
            state: opts.next,
          };
          probe.__onlineBattle.push(sample);
          await original(events, speed, {
            ...opts,
            onBeat: (beat: BattleBeat) => {
              opts.onBeat?.(beat);
              sample.beats.push(beat);
              sample.matched &&=
                JSON.stringify(game.registry.get('state')) === JSON.stringify(opts.next);
            },
          });
          sample.finished = performance.now();
        };
      });
    }
    const selector =
      'button[data-choice]:visible:enabled,button[data-action-index]:visible:enabled';
    let evidence: unknown;
    for (let action = 0; action < 120 && !evidence; action++) {
      await expect
        .poll(async () =>
          (await Promise.all(pages.map((page) => page.locator(selector).count()))).some(Boolean),
        )
        .toBe(true);
      for (const page of pages) {
        const buttons = page.locator(selector);
        if (!(await buttons.count())) continue;
        const sample = await page.evaluate(() => {
          const probe = window as Probe & {
            __onlineBattle: Array<{
              started: number;
              finished: number;
              beats: BattleBeat[];
              matched: boolean;
              state: GameState;
            }>;
          };
          const candidate = probe.__onlineBattle.findLast(
            (sample) => sample.beats.some((beat) => beat.duration > 0) && !sample.finished,
          );
          return candidate
            ? {
                ...candidate,
                acted: performance.now(),
                registry: probe.__m5aGame.registry.get('state'),
                controller: window.__db!.getState(),
              }
            : null;
        });
        await buttons.first().click();
        if (sample) {
          expect(sample.matched).toBe(true);
          expect(sample.registry).toEqual(sample.controller);
          expect(sample.finished).toBe(0);
          expect(sample.acted - sample.started).toBeLessThan(600);
          evidence = sample;
          for (const participant of pages) {
            await expect
              .poll(() =>
                participant.evaluate(() => {
                  const probe = window as Probe & {
                    __onlineBattle: Array<{ started: number; finished: number }>;
                  };
                  return probe.__onlineBattle.some((sample) => sample.finished > sample.started);
                }),
              )
              .toBe(true);
          }
        }
        break;
      }
    }
    expect(
      evidence,
      'must reach a real resolved battle and click the next legal action during its detached playback',
    ).toBeTruthy();
    await info.attach('online-battle-handoff', {
      body: JSON.stringify(evidence),
      contentType: 'application/json',
    });
  } finally {
    await context.close();
  }
});
