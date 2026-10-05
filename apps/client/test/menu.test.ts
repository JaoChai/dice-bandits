import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLang, setLang } from '../src/i18n';
import { renderMenu } from '../src/ui/menu';
import { openSoundDialog } from '../src/ui/screens';

function mount(): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
  setLang('en');
  localStorage.clear();
});

describe('renderMenu', () => {
  it('renders a closed menu button by default', () => {
    const root = mount();
    renderMenu(root, { onExit: vi.fn() });
    const button = root.querySelector<HTMLButtonElement>('[data-testid="menu-button"]');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.getAttribute('aria-label')?.trim().length).toBeGreaterThan(0);
    expect(root.querySelector('.menu-panel')).toBeNull();
  });

  it('reveals language, sound and exit controls with their old test ids when opened', () => {
    const root = mount();
    renderMenu(root, { onExit: vi.fn() });
    root.querySelector<HTMLButtonElement>('[data-testid="menu-button"]')!.click();
    const panel = root.querySelector<HTMLElement>('.menu-panel');
    expect(panel).not.toBeNull();
    expect(
      root.querySelector<HTMLElement>('[data-testid="menu-language"] .menu-label')?.textContent,
    ).toBe('Language');
    expect(root.querySelector('[data-testid="menu-sound"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="menu-exit"]')).not.toBeNull();
    // The legacy controls live inside the panel with their old test ids.
    expect(root.querySelector('.menu-panel [data-lang="th"]')).not.toBeNull();
    expect(root.querySelector('.menu-panel [data-lang="en"]')).not.toBeNull();
    expect(root.querySelector('.menu-panel [data-testid="audio-toggle"]')).not.toBeNull();
    expect(root.querySelector('.menu-panel [data-testid="audio-settings"]')).not.toBeNull();
    expect(root.querySelector('.menu-panel [data-action="exit"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="menu-button"]')?.getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('keeps the language switch working from inside the menu', () => {
    const root = mount();
    renderMenu(root, { onExit: vi.fn() });
    root.querySelector<HTMLButtonElement>('[data-testid="menu-button"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-lang="th"]')!.click();
    expect(getLang()).toBe('th');
    root.querySelector<HTMLButtonElement>('[data-lang="en"]')!.click();
    expect(getLang()).toBe('en');
  });

  it('dispatches onExit through the exit control', () => {
    const root = mount();
    const onExit = vi.fn();
    renderMenu(root, { onExit });
    root.querySelector<HTMLButtonElement>('[data-testid="menu-button"]')!.click();
    root.querySelector<HTMLButtonElement>('.menu-panel [data-action="exit"]')!.click();
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('re-dispatches menu-exit at most once per exit click at an outer mount', () => {
    // Mirrors the board wiring: the menu sits inside a game shell that
    // re-dispatches the event outward. One click must yield exactly one event
    // at the outer mount (main.ts adds one history entry per event).
    const outer = mount();
    const shell = document.createElement('div');
    outer.append(shell);
    const events: string[] = [];
    outer.addEventListener('dice-bandits:menu-exit', () => events.push('exit'));
    renderMenu(shell, {
      onExit: () => {
        shell.dispatchEvent(
          new CustomEvent('dice-bandits:menu-exit', { bubbles: true, composed: true }),
        );
      },
    });
    shell.querySelector<HTMLButtonElement>('[data-testid="menu-button"]')!.click();
    shell.querySelector<HTMLButtonElement>('.menu-panel [data-action="exit"]')!.click();
    expect(events).toHaveLength(1);
  });

  it('opens the sound-settings dialog through the bubbling request when the flow listens', () => {
    // Mirrors the app wiring: the menu bubbles `dice-bandits:sound-settings`;
    // main.ts listens on #app and opens openSoundDialog (exported from
    // screens.ts). The dialog appends itself to #app, so mount one first.
    document.body.innerHTML = '<div id="app"></div>';
    const root = mount();
    root.addEventListener('dice-bandits:sound-settings', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        '[data-testid="audio-settings"]',
      );
      if (button) openSoundDialog(button);
    });
    renderMenu(root, { onExit: vi.fn() });
    root.querySelector<HTMLButtonElement>('[data-testid="menu-button"]')!.click();
    root.querySelector<HTMLButtonElement>('.menu-panel [data-testid="audio-settings"]')!.click();
    expect(document.querySelectorAll('[data-testid="audio-dialog"]')).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('[data-testid="audio-close"]')!.click();
    expect(document.querySelectorAll('[data-testid="audio-dialog"]')).toHaveLength(0);
  });

  it('closes on Escape and returns focus to the menu button', () => {
    const root = mount();
    renderMenu(root, { onExit: vi.fn() });
    const button = root.querySelector<HTMLButtonElement>('[data-testid="menu-button"]')!;
    button.click();
    expect(root.querySelector('.menu-panel')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(root.querySelector('.menu-panel')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('toggles closed when the button is pressed again', () => {
    const root = mount();
    renderMenu(root, { onExit: vi.fn() });
    const button = root.querySelector<HTMLButtonElement>('[data-testid="menu-button"]')!;
    button.click();
    expect(root.querySelector('.menu-panel')).not.toBeNull();
    button.click();
    expect(root.querySelector('.menu-panel')).toBeNull();
  });
});
