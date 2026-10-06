import { expect, test } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };
import th from '../src/i18n/th.json' with { type: 'json' };
import { assertInside, assertNoEllipsis, startJourney } from './helpers';

for (const lang of ['en', 'th'] as const) {
  test(`corrected Dicey rule copy fits without covering controls ${lang}`, async ({
    page,
  }, info) => {
    await page.addInitScript((locale) => {
      localStorage.setItem('dice-bandits:tips', JSON.stringify({ enabled: true, seen: [] }));
      localStorage.setItem('lang', locale);
    }, lang);
    await startJourney(page);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByTestId('dicey-tip')).toBeVisible();
    await expect(page.locator('.dicey-portrait')).toBeVisible({ timeout: 15_000 });
    const results = [];
    // Copy-only visual fixtures in the real rendered bubble. Trigger/translation
    // semantics are covered by the real guide/engine/controller unit regressions.
    for (const topic of ['castle', 'chest', 'monster'] as const) {
      const caption = (lang === 'en' ? en : th)[`dicey.tip.${topic}`];
      const result = await page.evaluate((copy) => {
        const text = document.querySelector<HTMLElement>('.dicey-text')!;
        text.textContent = copy;
        const tip = document.querySelector<HTMLElement>('.dicey-tip')!.getBoundingClientRect();
        const overlaps = [
          ...document.querySelectorAll(
            '.action-tray, .seat-card, .turn-ribbon, .game-topline > *, .battle-hud, .battle-hp-card',
          ),
        ].map((control) => {
          const rect = control.getBoundingClientRect();
          return (
            Math.max(0, Math.min(tip.right, rect.right) - Math.max(tip.left, rect.left)) *
            Math.max(0, Math.min(tip.bottom, rect.bottom) - Math.max(tip.top, rect.top))
          );
        });
        return {
          caption: text.textContent,
          lines:
            text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight),
          overlaps,
        };
      }, caption);
      expect(result.caption).toBe(caption);
      expect(result.lines, `${lang}/${topic}`).toBeLessThanOrEqual(2);
      for (const overlap of result.overlaps) expect(overlap).toBe(0);
      await assertInside(page, '[data-testid="dicey-tip"]');
      await assertNoEllipsis(page, '[data-testid="dicey-tip"]');
      await page.screenshot({ path: info.outputPath(`copy-${lang}-${topic}.png`) });
      if (process.env.AXE_SOURCE) {
        await page.addScriptTag({ path: process.env.AXE_SOURCE });
        const axe = await page.evaluate(async () =>
          (
            window as unknown as {
              axe: { run: (options: unknown) => Promise<{ violations: { impact: string }[] }> };
            }
          ).axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }),
        );
        await info.attach(`${topic}-axe`, {
          body: JSON.stringify(axe),
          contentType: 'application/json',
        });
        const serious = axe.violations.filter((issue) =>
          ['serious', 'critical'].includes(issue.impact),
        );
        expect(serious).toEqual([]);
        console.log(`axe corrected ${lang}/${topic}: ${serious.length} serious/critical`);
      }
      results.push({ topic, ...result });
    }
    await info.attach('corrected-copy-layout', {
      body: JSON.stringify({ viewport: page.viewportSize(), lang, results }),
      contentType: 'application/json',
    });
  });
}
