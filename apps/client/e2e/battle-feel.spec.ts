import { expect, test, type Page } from '@playwright/test';
import type { GameEvent } from '@dice-bandits/engine';
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
    await observeBoardGame(page);
    await page.addInitScript((lang) => localStorage.setItem('lang', lang), lang);
    await startBattleJourney(page, 1);
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
            document.querySelector<HTMLElement>('[data-testid="battle-readout"]')?.dataset.beat ===
            kind,
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
      body: JSON.stringify(timing),
      contentType: 'application/json',
    });
    await expect(page.locator('.action-bar button:enabled').first()).toBeVisible();
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
