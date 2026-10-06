import type { ClassId, GameConfig, Personality } from '@dice-bandits/engine';
import { getLang, setLang, t } from '../i18n';
import { getAudioSettings, playSfx, setAudioSettings, setMusic } from '../audio';
import { loadGame, onSaveToast } from '../save';
import { testHooks } from '../testHooks';
import { latestSession } from '../online/session';
import { portraitStyle } from './artFrames';
import { openIntroComic, shouldShowIntroComic } from './introComic';

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
  online: { create?: () => void; join?: () => void; back?: (code: string) => void } = {},
): void {
  setMusic('board');
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('Missing #app mount element');
  const render = (): void => {
    let discarded = false;
    const unsubscribe = onSaveToast(() => {
      discarded = true;
    });
    const saved = loadGame();
    const room = latestSession();
    unsubscribe();
    root.innerHTML = `<main class="screen title-screen card" data-testid="screen-title" style="background-image:url('/art/title.webp')"><header>${languageToggle()}<button type="button" class="text-button" data-testid="audio-settings">${t('audio.settings')}</button></header><h1 class="game-logo">${t('title.gameName')}</h1><p>${t('title.subtitle')}</p><div class="title-actions"><button class="primary" data-action="new">${t('title.newGame')}</button>${saved ? `<button class="secondary" data-action="continue">${t('title.continue')}</button>` : ''}<button class="secondary" data-testid="online-create">${t('online.create')}</button><button class="secondary" data-testid="online-join">${t('online.join')}</button><button class="secondary" data-testid="title-story">${t('title.story')}</button>${room ? `<button class="secondary" data-testid="online-back">${t('online.backToRoom', { code: room.code })}</button>` : ''}</div></main>`;
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
        onClose: () => root.querySelector<HTMLElement>('[data-testid="title-story"]')?.focus(),
      });
    });
    root.querySelector('[data-action="new"]')?.addEventListener('click', onNewGame);
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
      onClose: () => root.querySelector<HTMLElement>('[data-testid="title-story"]')?.focus(),
    });
  }
}

export function showSetup(onStart: (config: GameConfig) => void): void {
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
    root
      .querySelector('[data-action="back"]')
      ?.addEventListener('click', () => showTitle(() => showSetup(onStart)));
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
