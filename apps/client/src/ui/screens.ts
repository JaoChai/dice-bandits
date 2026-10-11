import type { ClassId, GameConfig, Personality } from '@dice-bandits/engine';
import { getLang, setLang, t } from '../i18n';
import { getAudioSettings, playSfx, setAudioSettings, setMusic } from '../audio';
import { loadGame, onSaveToast } from '../save';
import { testHooks } from '../testHooks';
import { latestSession } from '../online/session';
import { portraitStyle } from './artFrames';
import { openIntroComic, shouldShowIntroComic } from './introComic';
import { titleIcon } from './titleIcons';
import { hasCompletedPractice } from './titleProgress';

const classes: ClassId[] = ['knight', 'thief', 'mage', 'cleric'];
const personalities: Personality[] = ['greedy', 'vengeful', 'cowardly'];
type SeatDraft = {
  control: 'human' | 'bot' | 'empty';
  name: string;
  classId: ClassId;
  personality: Personality;
};
const drafts: SeatDraft[] = Array.from({ length: 4 }, (_, i) => ({
  control: i === 0 ? 'human' : i === 1 ? 'bot' : 'empty',
  name: '',
  classId: classes[i % classes.length]!,
  personality: 'greedy',
}));

/** Default seat name is the class hero name (spec §4); players can still type their own. */
function heroName(classId: ClassId): string {
  return t(`hero.${classId}`);
}

function languageToggle(): string {
  return `<div class="language-toggle" aria-label="${t('title.language')}"><button type="button" data-lang="th" class="${getLang() === 'th' ? 'selected' : ''}" aria-pressed="${getLang() === 'th'}">${t('lang.th')}</button><button type="button" data-lang="en" class="${getLang() === 'en' ? 'selected' : ''}" aria-pressed="${getLang() === 'en'}">${t('lang.en')}</button></div>`;
}

function bindLanguageToggle(root: HTMLElement, rerender: () => void): void {
  root.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((button) => {
    button.addEventListener('click', () => {
      setLang(button.dataset.lang as 'th' | 'en');
      rerender();
    });
  });
}

export function showTitle(
  onNewGame: () => void = () => {},
  online: {
    create?: () => void;
    join?: () => void;
    back?: (code: string) => void;
    onPractice?: () => void;
  } = {},
): void {
  setMusic('board');
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('Missing #app mount element');
  let choosing = false;
  let languageOpen = false;
  const render = (): void => {
    let discarded = false;
    const unsubscribe = onSaveToast(() => {
      discarded = true;
    });
    const saved = loadGame();
    const room = latestSession();
    unsubscribe();
    const option = (
      style: string,
      icon: Parameters<typeof titleIcon>[0],
      key: string,
      action: string,
      badge = '',
    ): string =>
      `<button type="button" class="title-option ${style}" ${action}><span class="title-option-icon">${titleIcon(icon)}</span><span class="title-option-copy"><b>${t(`title.${key}`)}${badge}</b><span>${t(`title.${key}Hint`)}</span></span><span class="title-chevron" aria-hidden="true">›</span></button>`;
    const badge =
      !saved && !hasCompletedPractice()
        ? `<i class="title-badge" data-testid="title-recommended">${t('title.recommended')}</i>`
        : '';
    root.innerHTML = `<main class="title-screen" data-testid="screen-title" style="background-image:url('/art/title.webp')">
      <div class="title-scrim" aria-hidden="true"></div>
      <div class="title-top"><button type="button" class="title-icon-button" data-testid="title-language" aria-label="${t('title.language')}" aria-expanded="${languageOpen}" aria-controls="title-languages">${getLang() === 'th' ? 'EN' : 'TH'}</button><div id="title-languages" class="title-languages" ${languageOpen ? '' : 'hidden'}>${languageToggle()}</div><button type="button" class="title-icon-button" data-testid="audio-settings" aria-label="${t('audio.settings')}">${titleIcon('gear')}</button></div>
      <div class="title-centre" ${choosing ? 'hidden' : ''}><h1 class="game-logo">${t('title.gameName')}</h1><p class="title-tagline">${t('title.tagline')}</p><button type="button" class="primary title-play" data-testid="title-play">${titleIcon('play')}${t('title.play')}</button><p class="title-hint">${t('title.hint')}</p></div>
      <section class="title-sheet" data-testid="title-chooser" aria-labelledby="title-choice-heading" ${choosing ? '' : 'hidden'}><div class="title-sheet-card"><div class="title-sheet-head"><button type="button" class="title-icon-button" data-testid="title-back" aria-label="${t('setup.back')}">${titleIcon('back')}</button><h2 id="title-choice-heading">${t('title.chooser')}</h2></div><div class="title-grid">
      ${saved ? option('title-continue', 'play', 'continue', 'data-action="continue"') : ''}
      ${option('title-solo', 'solo', 'solo', 'data-action="new"')}
      <div class="title-friends-group">${option('title-friends', 'friends', 'friends', 'data-testid="title-friends" aria-expanded="false" aria-controls="title-online-actions"')}<div id="title-online-actions" class="title-online-actions" hidden><button type="button" data-testid="online-create">${t('online.create')}</button><button type="button" data-testid="online-join">${t('online.join')}</button></div></div>
      ${online.onPractice ? option('title-dicey', 'dicey', 'dicey', 'data-testid="title-practice"', badge) : ''}
      ${option('title-story', 'book', 'story', 'data-testid="title-story"')}
      ${room ? `<button type="button" class="title-option title-room" data-testid="online-back"><span class="title-option-icon">${titleIcon('friends')}</span><span class="title-option-copy"><b>${escapeHtml(t('online.backToRoom', { code: room.code }))}</b><span>${t('title.friendsHint')}</span></span><span class="title-chevron" aria-hidden="true">›</span></button>` : ''}
      </div></div></section></main>`;
    const sheet = root.querySelector<HTMLElement>('[data-testid="title-chooser"]')!;
    const centre = root.querySelector<HTMLElement>('.title-centre')!;
    const reveal = (): void => {
      choosing = true;
      sheet.hidden = false;
      centre.hidden = true;
    };
    const close = (): void => {
      choosing = false;
      root.querySelector('.title-grid')!.classList.remove('friends-open');
      root.querySelector<HTMLElement>('#title-online-actions')!.hidden = true;
      root.querySelector('[data-testid="title-friends"]')!.setAttribute('aria-expanded', 'false');
      sheet.hidden = true;
      centre.hidden = false;
      root.querySelector<HTMLElement>('[data-testid="title-play"]')!.focus();
    };
    root.querySelector('[data-testid="title-play"]')!.addEventListener('click', () => {
      reveal();
      root.querySelector<HTMLElement>('[data-testid="title-back"]')!.focus();
    });
    root.querySelector('[data-testid="title-back"]')!.addEventListener('click', close);
    root.querySelector('.title-screen')!.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') {
        if (choosing) {
          event.stopPropagation();
          languageOpen = false;
          root.querySelector<HTMLElement>('#title-languages')!.hidden = true;
          root
            .querySelector('[data-testid="title-language"]')!
            .setAttribute('aria-expanded', 'false');
          close();
        } else if (languageOpen) {
          languageOpen = false;
          root.querySelector<HTMLElement>('#title-languages')!.hidden = true;
          root
            .querySelector('[data-testid="title-language"]')!
            .setAttribute('aria-expanded', 'false');
          root.querySelector<HTMLElement>('[data-testid="title-language"]')!.focus();
        }
      }
    });
    root.querySelector('[data-testid="title-language"]')!.addEventListener('click', () => {
      languageOpen = !languageOpen;
      const panel = root.querySelector<HTMLElement>('#title-languages')!;
      panel.hidden = !languageOpen;
      root
        .querySelector('[data-testid="title-language"]')!
        .setAttribute('aria-expanded', String(languageOpen));
      if (languageOpen) panel.querySelector<HTMLElement>('[data-lang]')!.focus();
    });
    root.querySelector('[data-testid="title-friends"]')!.addEventListener('click', (event) => {
      const panel = root.querySelector<HTMLElement>('#title-online-actions')!;
      panel.hidden = !panel.hidden;
      root.querySelector('.title-grid')!.classList.toggle('friends-open', !panel.hidden);
      (event.currentTarget as HTMLElement).setAttribute('aria-expanded', String(!panel.hidden));
    });
    if (discarded) {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.setAttribute('role', 'status');
      toast.textContent = t('toast.saveDiscarded');
      root.append(toast);
    }
    bindLanguageToggle(root, render);
    root.querySelector('[data-testid="audio-settings"]')?.addEventListener('click', () => {
      openSoundDialog(root.querySelector<HTMLButtonElement>('[data-testid="audio-settings"]')!);
    });
    root.querySelector('[data-testid="title-story"]')?.addEventListener('click', () => {
      openIntroComic({
        onClose: () => focusTitleChoice('title-story'),
      });
    });
    root.querySelector('[data-action="new"]')?.addEventListener('click', onNewGame);
    root
      .querySelector('[data-testid="title-practice"]')
      ?.addEventListener('click', () => online.onPractice?.());
    root
      .querySelector('[data-testid="online-create"]')
      ?.addEventListener(
        'click',
        online.create ??
          (() =>
            root.dispatchEvent(
              new CustomEvent('dice-bandits:online', { detail: { mode: 'create' } }),
            )),
      );
    root
      .querySelector('[data-testid="online-join"]')
      ?.addEventListener(
        'click',
        online.join ??
          (() =>
            root.dispatchEvent(
              new CustomEvent('dice-bandits:online', { detail: { mode: 'join' } }),
            )),
      );
    root.querySelector('[data-testid="online-back"]')?.addEventListener('click', () => {
      const current = latestSession();
      if (current) {
        if (online.back) online.back(current.code);
        else
          root.dispatchEvent(
            new CustomEvent('dice-bandits:online', { detail: { code: current.code } }),
          );
      }
    });
    root.querySelector('[data-action="continue"]')?.addEventListener('click', () => {
      root.dispatchEvent(new CustomEvent('dice-bandits:continue', { detail: saved }));
    });
  };
  render();
  if (shouldShowIntroComic()) {
    openIntroComic({
      onClose: () => focusTitleChoice('title-story'),
      onPracticeOffer: online.onPractice,
    });
  }
}

export function focusTitleChoice(testId: 'title-story' | 'title-practice'): void {
  const root = document.querySelector<HTMLElement>('#app');
  root?.querySelector<HTMLElement>('[data-testid="title-play"]')?.click();
  root?.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus();
}

export function showSetup(
  onStart: (config: GameConfig) => void,
  onBack: () => void = () => showTitle(() => showSetup(onStart)),
): void {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('Missing #app mount element');
  let error = false;
  const render = (): void => {
    const seatRows = drafts
      .map(
        (seat, index) =>
          `<fieldset class="seat-row" data-seat="${index}"><legend>${t('setup.seat', { seat: index + 1 })}</legend><label><select data-field="control" aria-label="${t('setup.seat', { seat: index + 1 })}"><option value="human" ${seat.control === 'human' ? 'selected' : ''}>${t('setup.human')}</option><option value="bot" ${seat.control === 'bot' ? 'selected' : ''}>${t('setup.bot')}</option><option value="empty" ${seat.control === 'empty' ? 'selected' : ''}>${t('setup.empty')}</option></select></label><span class="seat-portrait portrait-${seat.classId}" style="${portraitStyle(seat.classId)}" role="img" aria-label="${t(`class.${seat.classId}`)}"></span>${seat.control === 'empty' ? '' : `<label>${t('setup.name')}<input data-field="name" value="${escapeHtml(seat.name || heroName(seat.classId))}" maxlength="18" required></label><label>${t('setup.class')}<select data-field="classId" aria-label="${t('setup.class')}">${classes.map((classId) => `<option value="${classId}" ${seat.classId === classId ? 'selected' : ''}>${t(`class.${classId}`)}</option>`).join('')}</select></label>${seat.control === 'bot' ? `<label>${t('setup.personality')}<select data-field="personality">${personalities.map((personality) => `<option value="${personality}" ${seat.personality === personality ? 'selected' : ''}>${t(`personality.${personality}`)}</option>`).join('')}</select></label>` : ''}`}</fieldset>`,
      )
      .join('');
    root.innerHTML = `<main class="screen setup-screen card" data-testid="screen-setup"><header><button class="text-button" data-action="back">← ${t('setup.back')}</button>${languageToggle()}</header><h1>${t('setup.title')}</h1><p>${t('setup.instructions')}</p><form id="setup-form"><div class="seat-list">${seatRows}</div><p class="error" role="alert">${error ? t('setup.invalid') : ''}</p><button class="primary" type="submit">${t('setup.start')}</button></form></main>`;
    bindLanguageToggle(root, render);
    root.querySelector('[data-action="back"]')?.addEventListener('click', onBack);
    root.querySelectorAll<HTMLElement>('.seat-row').forEach((row) => {
      const index = Number(row.dataset.seat);
      row
        .querySelectorAll<HTMLSelectElement | HTMLInputElement>('[data-field]')
        .forEach((control) => {
          const update = (): void => {
            const field = control.dataset.field;
            if (field === 'control') drafts[index]!.control = control.value as SeatDraft['control'];
            if (field === 'name') drafts[index]!.name = control.value;
            if (field === 'classId') drafts[index]!.classId = control.value as ClassId;
            if (field === 'personality') drafts[index]!.personality = control.value as Personality;
            if (field === 'control' || field === 'classId') render();
          };
          control.addEventListener('change', update);
          control.addEventListener('input', update);
        });
    });
    root.querySelector<HTMLFormElement>('#setup-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const active = drafts.filter((seat) => seat.control !== 'empty');
      if (active.length < 2 || !active.some((seat) => seat.control === 'human')) {
        error = true;
        render();
        return;
      }
      const config: GameConfig = {
        seed: testHooks.seed ?? `dice-bandits-${Date.now()}`,
        rounds: 30,
        seats: active.map((seat) => ({
          name: seat.name.trim() || heroName(seat.classId),
          classId: seat.classId,
          control: seat.control as 'human' | 'bot',
          personality: seat.control === 'bot' ? seat.personality : null,
        })),
      };
      onStart(config);
    });
  };
  render();
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

/**
 * Sound-settings dialog: mute + music/sfx volume, applied and persisted
 * immediately. Exported for the board menu: its settings entry bubbles
 * `dice-bandits:sound-settings` and main.ts opens this dialog in response.
 */
export function openSoundDialog(openButton: HTMLButtonElement): void {
  if (document.querySelector('[data-testid="audio-dialog"]')) return;
  const current = getAudioSettings();
  const shade = document.createElement('div');
  shade.className = 'dialog-shade';
  shade.innerHTML = `<section class="game-dialog audio-dialog" data-testid="audio-dialog" role="dialog" aria-modal="true" aria-label="${t('audio.settings')}"><h2>${t('audio.settings')}</h2><label class="audio-option audio-mute-row"><input type="checkbox" data-testid="audio-mute"${current.muted ? ' checked' : ''}> ${t('audio.muteAll')}</label><label class="audio-option">${t('audio.music')}<span class="audio-slider"><input type="range" min="0" max="100" step="5" value="${toPercent(current.music)}" data-testid="audio-music-volume"><output class="audio-value" data-testid="audio-music-value">${toPercent(current.music)}%</output></span></label><label class="audio-option">${t('audio.sfx')}<span class="audio-slider"><input type="range" min="0" max="100" step="5" value="${toPercent(current.sfx)}" data-testid="audio-sfx-volume"><output class="audio-value" data-testid="audio-sfx-value">${toPercent(current.sfx)}%</output></span></label><button type="button" data-testid="audio-close">${t('audio.close')}</button></section>`;

  const close = (): void => {
    shade.remove();
    document.removeEventListener('keydown', onKeydown, true);
    openButton.focus();
  };
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  };
  const music = shade.querySelector<HTMLInputElement>('[data-testid="audio-music-volume"]')!;
  const sfx = shade.querySelector<HTMLInputElement>('[data-testid="audio-sfx-volume"]')!;
  const musicValue = shade.querySelector<HTMLOutputElement>('[data-testid="audio-music-value"]')!;
  const sfxValue = shade.querySelector<HTMLOutputElement>('[data-testid="audio-sfx-value"]')!;
  music.addEventListener('input', () => {
    musicValue.textContent = `${music.value}%`;
    setAudioSettings({ music: Number(music.value) / 100 });
  });
  sfx.addEventListener('input', () => {
    sfxValue.textContent = `${sfx.value}%`;
    setAudioSettings({ sfx: Number(sfx.value) / 100 });
    playSfx('click');
  });
  shade
    .querySelector<HTMLInputElement>('[data-testid="audio-mute"]')!
    .addEventListener('change', (event) => {
      setAudioSettings({ muted: (event.target as HTMLInputElement).checked });
    });
  shade
    .querySelector<HTMLButtonElement>('[data-testid="audio-close"]')!
    .addEventListener('click', close);
  document.addEventListener('keydown', onKeydown, true);
  document.querySelector('#app')?.append(shade);
  shade.querySelector<HTMLInputElement>('[data-testid="audio-mute"]')?.focus();
}

function toPercent(volume: number): number {
  return Math.round(volume * 100);
}
