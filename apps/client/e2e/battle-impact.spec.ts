import { expect, test } from '@playwright/test';
import type Phaser from 'phaser';
import { step, type GameEvent, type GameState } from '@dice-bandits/engine';
import type { BattleBeat } from '../src/scenes/battle/presentation';
import { observeBoardGame, startBattleJourney } from './helpers';

type Sample = { kind: BattleBeat['kind']; at: number; duration: number };
type Timing = { started: number; finished: number; samples: Sample[]; elapsed: number };
type BattleScene = Phaser.Scene & {
  playEvents(
    events: GameEvent[],
    speed: number,
    options: {
      previous: GameState;
      next: GameState;
      mode: 'human' | 'bot' | 'online';
      onBeat?: (beat: BattleBeat) => void;
    },
  ): Promise<void>;
};
type Probe = Window & { __m5aGame: Phaser.Game; __impactTiming: Timing };

for (const cpuRate of [1, 4])
  for (const command of ['attack', 'strike'] as const)
    test(`battle impact ${command} cadence CPU ${cpuRate} human half <=2220ms`, async ({
      page,
    }, info) => {
      const lang = info.project.name === 'mobile-landscape' ? 'th' : 'en';
      await observeBoardGame(page);
      await page.addInitScript((value) => localStorage.setItem('lang', value), lang);
      await startBattleJourney(page, 1);
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
        await page.evaluate(() => {
          window.diceBanditsSpeed = 1;
          const probe = window as Probe;
          const scene = probe.__m5aGame.scene.getScene('BattleScene') as BattleScene;
          const original = scene.playEvents.bind(scene);
          scene.playEvents = async (events, speed, options) => {
            const timing: Timing = {
              started: performance.now(),
              finished: 0,
              samples: [],
              elapsed: 0,
            };
            probe.__impactTiming = timing;
            await original(events, speed, {
              ...options,
              onBeat(beat) {
                options.onBeat?.(beat);
                timing.samples.push({
                  kind: beat.kind,
                  at: performance.now(),
                  duration: beat.duration,
                });
              },
            });
            timing.finished = performance.now();
            timing.elapsed = timing.finished - timing.started;
          };
        });
        await page.getByTestId(`pick-${command}`).click();
        await page.waitForFunction(() => (window as Probe).__impactTiming?.finished > 0);
        const timing = await page.evaluate(() => (window as Probe).__impactTiming);
        const measured = timing.samples.map((sample, index) => ({
          ...sample,
          measuredMs: (timing.samples[index + 1]?.at ?? timing.finished) - sample.at,
        }));
        const evidence = {
          ...timing,
          measured,
          lang,
          cpuRate,
          viewport: page.viewportSize(),
          unit: 'one resolved human half',
        };
        console.log('R1 human half:', JSON.stringify(evidence));
        await info.attach('human-half-timing', {
          body: JSON.stringify(evidence),
          contentType: 'application/json',
        });
        await page.screenshot({
          path: info.outputPath(`impact-${command}-${lang}-cpu${cpuRate}.png`),
        });
        expect(timing.samples.map((sample) => sample.kind)).toEqual([
          'reveal',
          'anticipation',
          'lunge',
          'impact',
          'damage',
          'drain',
          'result',
        ]);
        expect(timing.samples.reduce((sum, sample) => sum + sample.duration, 0)).toBe(2000);
        expect(timing.elapsed).toBeGreaterThanOrEqual(2000);
        expect(timing.elapsed).toBeLessThanOrEqual(2220);
      } finally {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await cdp.detach();
      }
    });

for (const mode of ['bot', 'online'] as const)
  test(`battle impact ${mode} scene half <=600ms with real engine events`, async ({
    page,
  }, info) => {
    await observeBoardGame(page);
    await startBattleJourney(page, 0);
    const previous = await page.evaluate(() => window.__db!.getState());
    const next = step(previous, { type: 'battlePick', side: 'a', pick: 'strike' });
    const timing = await page.evaluate(
      async ({ previous, next, mode }) => {
        const scene = (window as Probe).__m5aGame.scene.getScene('BattleScene') as BattleScene;
        const samples: Sample[] = [];
        const started = performance.now();
        await scene.playEvents(next.events, 1, {
          previous,
          next: next.state,
          mode,
          onBeat: (beat) =>
            samples.push({ kind: beat.kind, at: performance.now(), duration: beat.duration }),
        });
        const finished = performance.now();
        return { started, finished, samples, elapsed: finished - started };
      },
      { previous, next, mode },
    );
    console.log(`R1 ${mode} half:`, JSON.stringify(timing));
    await info.attach(`${mode}-half-timing`, {
      body: JSON.stringify(timing),
      contentType: 'application/json',
    });
    expect(timing.samples).toHaveLength(7);
    expect(timing.samples.reduce((sum, sample) => sum + sample.duration, 0)).toBeLessThanOrEqual(
      600,
    );
    expect(timing.elapsed).toBeLessThanOrEqual(600);
  });
