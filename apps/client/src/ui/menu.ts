import { getLang, setLang, t } from '../i18n';
import { getAudioSettings, setAudioSettings } from '../audio';
import { loadTips, resetTips, setEnabled } from '../tutor/tips';

export interface MenuOptions {
  /** Invoked by the menu's exit control (single exit path keeps e2e selectors stable). */
  onExit: () => void;
}

/**
 * Board menu button (spec §9): language, sound and exit live inside one menu —
 * no loose TH/EN squares on the board. All legacy control test ids are kept so
 * existing unit + E2E coverage keeps passing. A language switch refreshes the
 * open panel in place (element identity preserved, listeners bound once).
 */
export function renderMenu(root: HTMLElement, options: MenuOptions): void {
  if (root.querySelector('[data-testid="menu-button"]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-button';
  button.dataset.testid = 'menu-button';
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', t('menu.open'));
  button.innerHTML =
    '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false"><g fill="currentColor"><rect x="2" y="3" width="12" height="2" rx="1"/><rect x="2" y="7" width="12" height="2" rx="1"/><rect x="2" y="11" width="12" height="2" rx="1"/></g></svg>';
  root.append(button);

  const isOpen = (): boolean => root.querySelector('.menu-panel') !== null;

  const closePanel = (): void => {
    root.querySelector('.menu-panel')?.remove();
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKeydown, true);
    button.focus();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    closePanel();
  };

  /**
   * Refresh open-panel labels/settings for the current language + audio state.
   * Updates text/attributes of the existing nodes only — never detach or
   * rebuild — so a language click finishes bubbling to the HUD's delegated
   * handler and every listener keeps its single binding.
   */
  const refreshPanel = (panel: HTMLElement): void => {
    const lang = getLang();
    const languageSection = panel.querySelector<HTMLElement>('[data-testid="menu-language"]');
    if (languageSection) {
      languageSection.querySelector('.menu-label')!.textContent = t('menu.language');
      const nav = languageSection.querySelector<HTMLElement>('.language-toggle')!;
      nav.setAttribute('aria-label', t('menu.language'));
      languageSection.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((langButton) => {
        const selected = langButton.dataset.lang === lang;
        langButton.textContent = t(`lang.${langButton.dataset.lang as 'th' | 'en'}`);
        langButton.classList.toggle('selected', selected);
        langButton.setAttribute('aria-pressed', String(selected));
      });
    }
    const soundSection = panel.querySelector<HTMLElement>('[data-testid="menu-sound"]');
    if (soundSection) {
      soundSection.querySelector('.menu-label')!.textContent = t('menu.sound');
      syncAudioMenu(panel);
      const settings = soundSection.querySelector<HTMLButtonElement>(
        '[data-testid="audio-settings"]',
      );
      if (settings) settings.textContent = t('audio.settings');
    }
    const tips = panel.querySelector<HTMLButtonElement>('[data-testid="menu-dicey-tips"]');
    if (tips) {
      const enabled = loadTips().enabled;
      tips.textContent = t('menu.diceyTips');
      tips.setAttribute('aria-pressed', String(enabled));
      tips.classList.toggle('selected', enabled);
    }
    const reset = panel.querySelector<HTMLButtonElement>('[data-testid="menu-dicey-reset"]');
    if (reset) reset.textContent = t('menu.diceyReset');
    const exit = panel.querySelector<HTMLButtonElement>('[data-action="exit"]');
    if (exit) exit.textContent = t('menu.exit');
  };

  const bindPanel = (panel: HTMLElement): void => {
    panel.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((langButton) => {
      langButton.addEventListener('click', () => {
        setLang(langButton.dataset.lang as 'th' | 'en');
        // The HUD's delegated handler re-renders the board; the open panel
        // stays open and follows the new language without losing state.
        if (panel.isConnected) refreshPanel(panel);
      });
    });
    panel
      .querySelector<HTMLButtonElement>('[data-testid="audio-toggle"]')
      ?.addEventListener('click', () => {
        setAudioSettings({ muted: !getAudioSettings().muted });
        syncAudioMenu(panel);
      });
    panel
      .querySelector<HTMLButtonElement>('[data-testid="audio-settings"]')
      ?.addEventListener('click', (event) => {
        // The main flow owns the sound-settings dialog; bubble the request to it.
        event.currentTarget?.dispatchEvent(
          new CustomEvent('dice-bandits:sound-settings', { bubbles: true, composed: true }),
        );
      });
    panel
      .querySelector<HTMLButtonElement>('[data-testid="menu-dicey-tips"]')
      ?.addEventListener('click', () => {
        setEnabled(!loadTips().enabled);
        refreshPanel(panel);
      });
    panel
      .querySelector<HTMLButtonElement>('[data-testid="menu-dicey-reset"]')
      ?.addEventListener('click', () => {
        resetTips();
        refreshPanel(panel);
      });
    panel
      .querySelector<HTMLButtonElement>('[data-action="exit"]')
      ?.addEventListener('click', () => {
        closePanel();
        options.onExit();
      });
  };

  const openPanel = (): void => {
    const lang = getLang();
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    // Open toward the centre/right, away from Dicey's left-side tip zone.
    panel.style.left = '0';
    panel.style.right = 'auto';
    panel.innerHTML = `<div class="menu-section" data-testid="menu-language"><span class="menu-label">${t('menu.language')}</span><nav class="language-toggle" aria-label="${t('menu.language')}"><button type="button" data-lang="th" class="${lang === 'th' ? 'selected' : ''}" aria-pressed="${lang === 'th'}">${t('lang.th')}</button><button type="button" data-lang="en" class="${lang === 'en' ? 'selected' : ''}" aria-pressed="${lang === 'en'}">${t('lang.en')}</button></nav></div><div class="menu-section" data-testid="menu-sound"><span class="menu-label">${t('menu.sound')}</span>${audioMenuHtml()}<button type="button" class="text-button" data-testid="audio-settings">${t('audio.settings')}</button></div><div class="menu-section" data-testid="menu-dicey"><div class="language-toggle"><button type="button" data-testid="menu-dicey-tips" aria-pressed="${loadTips().enabled}" class="${loadTips().enabled ? 'selected' : ''}">${t('menu.diceyTips')}</button><button type="button" data-testid="menu-dicey-reset">${t('menu.diceyReset')}</button></div></div><div class="menu-section" data-testid="menu-exit"><button type="button" class="text-button" data-action="exit">${t('menu.exit')}</button></div>`;
    bindPanel(panel);
    button.after(panel);
    // Keep the expanded menu inside a short landscape viewport; keyboard focus
    // and normal scrolling can still reach every section, including Exit.
    panel.style.maxHeight = `calc(100dvh - ${panel.getBoundingClientRect().top + 6}px)`;
    panel.style.overflowY = 'auto';
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKeydown, true);
  };

  button.addEventListener('click', () => {
    if (isOpen()) closePanel();
    else openPanel();
  });
}

/** Refresh the mute toggle inside an open menu panel. */
function syncAudioMenu(panel: HTMLElement): void {
  const toggle = panel.querySelector<HTMLButtonElement>('[data-testid="audio-toggle"]');
  if (!toggle) return;
  const muted = getAudioSettings().muted;
  toggle.setAttribute('aria-pressed', String(muted));
  const label = muted ? t('audio.unmute') : t('audio.mute');
  toggle.setAttribute('aria-label', label);
  toggle.setAttribute('title', label);
}

/** Speaker SVG (same shape as the HUD's audio-toggle). */
function audioMenuHtml(): string {
  const muted = getAudioSettings().muted;
  const label = muted ? t('audio.unmute') : t('audio.mute');
  return `<button type="button" class="audio-toggle" data-testid="audio-toggle" aria-pressed="${muted}" aria-label="${label}" title="${label}"><svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true" focusable="false"><g shape-rendering="crispEdges" fill="currentColor"><rect x="2" y="6" width="2" height="4"/><rect x="4" y="5" width="2" height="6"/><rect x="6" y="4" width="2" height="8"/><g class="audio-waves"><rect x="10" y="6" width="1" height="4"/><rect x="12" y="4" width="1" height="8"/></g></g><g class="audio-slash" shape-rendering="crispEdges" stroke="#e2606c" stroke-width="2"><line x1="1" y1="15" x2="15" y2="1"/></g></svg></button>`;
}
