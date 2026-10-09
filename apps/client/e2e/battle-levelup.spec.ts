import { expect, test } from '@playwright/test';
import type { GameEvent, GameState } from '@dice-bandits/engine';
import type Phaser from 'phaser';
import type { BattleBeat } from '../src/scenes/battle/presentation';
import { observeBoardGame, startBattleJourney } from './helpers';

type Result = {
  events: GameEvent[];
  previous: { hp: number; maxHp: number };
  engine: { hp: number; maxHp: number; level: number };
  result: { hpText: string | null; value: number; max: number; fill: string };
};
type Probe = Window & {
  __m5aGame: Phaser.Game;
  __levelUp: Result | null;
  __completedBattles: number;
};

for (const [lang, mode] of [
  ['th', 'animated'],
  ['en', 'zero'],
  ['th', 'reduced'],
] as const) {
  test(`real winning level-up reconciles public HP and max (${lang}, ${mode})`, async ({
    page,
  }, info) => {
    await observeBoardGame(page);
    await page.addInitScript((lang) => localStorage.setItem('lang', lang), lang);
    if (mode === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
    await startBattleJourney(page, mode === 'zero' ? 0 : 1);
    await page.evaluate(() => {
      const probe = window as Probe;
      const scene = probe.__m5aGame.scene.getScene('BattleScene') as Phaser.Scene & {
        playEvents(
          events: GameEvent[],
          speed: number,
          options?: {
            previous: GameState;
            next: GameState;
            onBeat?: (beat: BattleBeat) => void;
          },
        ): Promise<void>;
      };
      const original = scene.playEvents.bind(scene);
      probe.__levelUp = null;
      probe.__completedBattles = 0;
      // Forward the actual engine events/states untouched and observe the real
      // result callback BEFORE the final HUD rerender can mask a stale maximum.
      scene.playEvents = async (events, speed, options) => {
        if (!options) return original(events, speed);
        await original(events, speed, {
          ...options,
          onBeat(beat) {
            options.onBeat?.(beat);
            if (beat.kind !== 'result' || !events.some((event) => event.type === 'LevelUp')) return;
            if (options.previous.phase.kind !== 'battle') throw new Error('expected real battle');
            const previous = options.previous.phase.battle.a;
            const player = options.next.players.find((player) => player.seat === previous.seat)!;
            const left = document.querySelector('.battle-hp-card.left')!;
            const meter = left.querySelector('.battle-hp-track')!;
            probe.__levelUp = {
              events,
              previous: { hp: previous.hp, maxHp: previous.stats.maxHp },
              engine: { hp: player.hp, maxHp: player.stats.maxHp, level: player.level },
              result: {
                hpText: left.querySelector('.battle-hp-value')!.textContent,
                value: Number(meter.getAttribute('aria-valuenow')),
                max: Number(meter.getAttribute('aria-valuemax')),
                fill: meter.querySelector<HTMLElement>('span')!.style.width,
              },
            };
          },
        });
        probe.__completedBattles++;
      };
    });
    for (let action = 1; action <= 8; action++) {
      const attack = page.getByTestId('pick-attack');
      const button = (await attack.isVisible())
        ? attack
        : page.locator('[data-testid^="pick-"]:visible:enabled').first();
      await button.click();
      await page.waitForFunction(
        (count) => (window as Probe).__levelUp || (window as Probe).__completedBattles >= count,
        action,
      );
      if (await page.evaluate(() => !!(window as Probe).__levelUp)) break;
    }
    const result = await page.evaluate(() => (window as Probe).__levelUp);
    expect(result, 'journey must reach a real winning level-up').not.toBeNull();
    await info.attach('public-levelup-result', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });
    await page.screenshot({ path: info.outputPath(`levelup-${lang}-${mode}.png`) });
    expect(result!.events.some((event) => event.type === 'LevelUp')).toBe(true);
    expect(
      result!.events.some(
        (event) => event.type === 'BattleEnded' && event.params.result === 'aWin',
      ),
    ).toBe(true);
    expect(result!.previous.maxHp).toBe(48);
    expect(result!.engine).toEqual({ hp: 54, maxHp: 54, level: 2 });
    expect(result!.result.value, 'result HP must not be clamped to the old maximum').toBe(
      result!.engine.hp,
    );
    expect(result!.result.max, 'result maximum must match the engine after level-up').toBe(
      result!.engine.maxHp,
    );
    expect(result!.result.hpText).toBe('54/54');
    expect(result!.result.fill).toBe('100%');
  });
}
