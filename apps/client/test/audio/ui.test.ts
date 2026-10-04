import { beforeEach, describe, expect, it } from 'vitest';
import { createGame, type GameConfig } from '@dice-bandits/engine';
import { getAudioSettings, initAudio, resetAudioForTests, setAudioSettings } from '../../src/audio';
import { AUDIO_SETTINGS_KEY } from '../../src/audio/settings';
import { setLang, t } from '../../src/i18n';
import { renderHud } from '../../src/ui/hud';
import { showTitle } from '../../src/ui/screens';

const config: GameConfig = {
  seed: 'audio-ui-test',
  rounds: 12,
  seats: [
    { name: 'Human', classId: 'knight', control: 'human', personality: null },
    { name: 'Bot', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
};

beforeEach(() => {
  resetAudioForTests();
  localStorage.clear();
  document.body.innerHTML = '';
  initAudio();
});

function boardRoot(): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  return root;
}

function openTitleDialog(): HTMLButtonElement {
  document.body.innerHTML = '<div id="app"></div>';
  showTitle();
  const open = document.querySelector<HTMLButtonElement>('[data-testid="audio-settings"]')!;
  open.click();
  return open;
}

describe('HUD audio toggle', () => {
  it('binds one handler across rerenders: one click flips muted exactly once', () => {
    resetAudioForTests();
    localStorage.clear();
    let saved: string | null = null;
    const writes: string[] = [];
    initAudio({
      storage: {
        getItem: () => saved,
        setItem: (_key, value) => {
          writes.push(value);
          saved = value;
        },
      },
    });

    const root = boardRoot();
    const state = createGame(config);
    renderHud(root, state, () => undefined);
    const toggle = root.querySelector<HTMLButtonElement>('[data-testid="audio-toggle"]')!;
    expect(toggle).toBeInstanceOf(HTMLButtonElement);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe(t('audio.mute'));

    renderHud(root, state, () => undefined);
    renderHud(root, state, () => undefined);
    expect(root.querySelector('[data-testid="audio-toggle"]')).toBe(toggle);

    toggle.click();
    expect(writes, 'one click must persist exactly once').toHaveLength(1);
    expect(JSON.parse(writes[0]!)).toMatchObject({ muted: true });
    expect(getAudioSettings().muted).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe(t('audio.unmute'));
  });

  it('switches the accessible label when the language changes', () => {
    const root = boardRoot();
    const state = createGame(config);
    setLang('en');
    renderHud(root, state, () => undefined);
    const toggle = root.querySelector<HTMLButtonElement>('[data-testid="audio-toggle"]')!;
    expect(toggle.getAttribute('aria-label')).toBe(t('audio.mute'));

    // The language toggle lives inside the board menu (spec §9): open it first.
    root.querySelector<HTMLButtonElement>('[data-testid="menu-button"]')!.click();
    root.querySelector<HTMLButtonElement>('.menu-panel [data-lang="th"]')!.click();
    // The header toggle keeps its identity; the label follows the new language.
    expect(root.querySelector('.game-topline > [data-testid="audio-toggle"]')).toBe(toggle);
    expect(toggle.getAttribute('aria-label')).toBe(t('audio.mute'));
    expect(toggle.getAttribute('aria-label')).toBe('ปิดเสียง');
    setLang('en');
  });
});

describe('title sound dialog', () => {
  it('opens with role=dialog, the three controls, and values from settings', () => {
    setAudioSettings({ muted: true, music: 0.35, sfx: 0.6 });
    openTitleDialog();

    const dialog = document.querySelector('[data-testid="audio-dialog"]')!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector<HTMLInputElement>('[data-testid="audio-mute"]')!.checked).toBe(
      true,
    );
    expect(
      document.querySelector<HTMLInputElement>('[data-testid="audio-music-volume"]')!.value,
    ).toBe('35');
    expect(
      document.querySelector<HTMLInputElement>('[data-testid="audio-sfx-volume"]')!.value,
    ).toBe('60');
  });

  it('persists a music slider move to 20 as music 0.2 immediately', () => {
    openTitleDialog();
    const music = document.querySelector<HTMLInputElement>('[data-testid="audio-music-volume"]')!;
    music.value = '20';
    music.dispatchEvent(new Event('input', { bubbles: true }));

    expect(getAudioSettings().music).toBeCloseTo(0.2);
    const stored = JSON.parse(localStorage.getItem(AUDIO_SETTINGS_KEY)!) as { music: number };
    expect(stored.music).toBeCloseTo(0.2);
    expect(document.querySelector('[data-testid="audio-music-value"]')?.textContent).toBe('20%');
  });

  it('persists an sfx slider move as sfx 0.3 immediately', () => {
    openTitleDialog();
    const sfx = document.querySelector<HTMLInputElement>('[data-testid="audio-sfx-volume"]')!;
    sfx.value = '30';
    sfx.dispatchEvent(new Event('input', { bubbles: true }));

    expect(getAudioSettings().sfx).toBeCloseTo(0.3);
    const stored = JSON.parse(localStorage.getItem(AUDIO_SETTINGS_KEY)!) as { sfx: number };
    expect(stored.sfx).toBeCloseTo(0.3);
  });

  it('applies the mute checkbox immediately', () => {
    openTitleDialog();
    const mute = document.querySelector<HTMLInputElement>('[data-testid="audio-mute"]')!;
    mute.checked = true;
    mute.dispatchEvent(new Event('change', { bubbles: true }));

    expect(getAudioSettings().muted).toBe(true);
  });

  it('closes on Escape and returns focus to the settings button', () => {
    const open = openTitleDialog();
    document.querySelector<HTMLButtonElement>('[data-testid="audio-close"]')!.focus();
    document
      .querySelector('[data-testid="audio-dialog"]')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );

    expect(document.querySelector('[data-testid="audio-dialog"]')).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it('closes via the close button and returns focus to the settings button', () => {
    const open = openTitleDialog();
    document.querySelector<HTMLButtonElement>('[data-testid="audio-close"]')!.click();

    expect(document.querySelector('[data-testid="audio-dialog"]')).toBeNull();
    expect(document.activeElement).toBe(open);
  });
});
