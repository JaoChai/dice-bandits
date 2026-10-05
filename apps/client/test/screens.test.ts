import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLang, t } from '../src/i18n';
import { showSetup } from '../src/ui/screens';

afterEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  setLang('en');
});

describe('client screens', () => {
  it('uses translated title and default player names, without losing typed names', () => {
    document.body.innerHTML = '<div id="app"></div>';
    setLang('th');
    showSetup(vi.fn());

    const root = document.querySelector<HTMLElement>('#app')!;
    // Spec §4: the default seat name is the class hero name (was "Player {n}").
    expect(root.querySelector<HTMLInputElement>('[data-seat="0"] [data-field="name"]')!.value).toBe(
      t('hero.knight'),
    );
    expect(root.innerHTML).not.toContain('Player 1');
    root.querySelector<HTMLInputElement>('[data-seat="0"] [data-field="name"]')!.value = 'Mali';
    root
      .querySelector<HTMLInputElement>('[data-seat="0"] [data-field="name"]')!
      .dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[data-lang="en"]')!.click();
    expect(root.querySelector<HTMLInputElement>('[data-seat="0"] [data-field="name"]')!.value).toBe(
      'Mali',
    );
  });

  it('ignores URL seed unless supplied through the test hook', () => {
    document.body.innerHTML = '<div id="app"></div>';
    history.replaceState(null, '', '/?seed=untrusted-url-seed');
    const onStart = vi.fn();
    showSetup(onStart);
    document.querySelector<HTMLFormElement>('#setup-form')!.requestSubmit();

    expect(onStart).toHaveBeenCalledOnce();
    expect(onStart.mock.calls[0]![0].seed).not.toBe('untrusted-url-seed');
  });
});
