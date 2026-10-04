import { afterEach, describe, expect, it, vi } from 'vitest';
import type { showSetup as ShowSetup } from '../src/ui/screens';

let showSetup: typeof ShowSetup;

afterEach(async () => {
  const { setLang } = await import('../src/i18n');
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  setLang('en');
  vi.resetModules();
});

describe('hero default names', () => {
  it('defaults each seat name to its class hero name and keeps it editable', async () => {
    // screens.ts keeps module-level seat drafts; a fresh module per test keeps
    // the defaults unpolluted by earlier tests' typed names. All imports stay
    // dynamic so they resolve against the same module registry as showSetup.
    vi.resetModules();
    ({ showSetup } = await import('../src/ui/screens'));
    const { t } = await import('../src/i18n');
    document.body.innerHTML = '<div id="app"></div>';
    showSetup(vi.fn());
    const root = document.querySelector<HTMLElement>('#app')!;
    // Seats 2/3 default to "empty" (0-player minimum, 1 human default); flip
    // them to human to see the hero names for every class.
    root
      .querySelectorAll<HTMLSelectElement>(
        '[data-seat="2"] [data-field="control"], [data-seat="3"] [data-field="control"]',
      )
      .forEach((control) => {
        control.value = 'human';
        control.dispatchEvent(new Event('change', { bubbles: true }));
      });
    expect(root.querySelector<HTMLInputElement>('[data-seat="0"] [data-field="name"]')!.value).toBe(
      t('hero.knight'),
    );
    expect(root.querySelector<HTMLInputElement>('[data-seat="1"] [data-field="name"]')!.value).toBe(
      t('hero.thief'),
    );
    expect(root.querySelector<HTMLInputElement>('[data-seat="2"] [data-field="name"]')!.value).toBe(
      t('hero.mage'),
    );
    expect(root.querySelector<HTMLInputElement>('[data-seat="3"] [data-field="name"]')!.value).toBe(
      t('hero.cleric'),
    );
    const input = root.querySelector<HTMLInputElement>('[data-seat="0"] [data-field="name"]')!;
    input.value = 'Mali';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.value).toBe('Mali');
  });

  it('defaults to the Thai hero names in Thai', async () => {
    vi.resetModules();
    ({ showSetup } = await import('../src/ui/screens'));
    const { setLang } = await import('../src/i18n');
    document.body.innerHTML = '<div id="app"></div>';
    setLang('th');
    showSetup(vi.fn());
    const root = document.querySelector<HTMLElement>('#app')!;
    expect(root.querySelector<HTMLInputElement>('[data-seat="0"] [data-field="name"]')!.value).toBe(
      'เซอร์แบรม',
    );
  });
});
