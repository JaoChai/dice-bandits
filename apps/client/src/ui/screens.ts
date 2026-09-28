import type { ClassId, GameConfig, Personality } from '@dice-bandits/engine';
import { getLang, setLang, t } from '../i18n';
import { loadGame, onSaveToast } from '../save';
import { testHooks } from '../testHooks';

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

export function showTitle(onNewGame: () => void = () => {}): void {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('Missing #app mount element');
  const render = (): void => {
    let discarded = false;
    const unsubscribe = onSaveToast(() => {
      discarded = true;
    });
    const saved = loadGame();
    unsubscribe();
    root.innerHTML = `<main class="screen title-screen" data-testid="screen-title"><header>${languageToggle()}</header><div class="title-art" aria-hidden="true">🎲</div><h1 class="pixel">${t('title.gameName')}</h1><p>${t('title.subtitle')}</p><div class="title-actions"><button class="primary pixel" data-action="new">${t('title.newGame')}</button>${saved ? `<button class="secondary" data-action="continue">${t('title.continue')}</button>` : ''}</div></main>`;
    if (discarded) {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.setAttribute('role', 'status');
      toast.textContent = t('toast.saveDiscarded');
      root.append(toast);
    }
    bindLanguageToggle(root, render);
    root.querySelector('[data-action="new"]')?.addEventListener('click', onNewGame);
    root.querySelector('[data-action="continue"]')?.addEventListener('click', () => {
      root.dispatchEvent(new CustomEvent('dice-bandits:continue', { detail: saved }));
    });
  };
  render();
}

export function showSetup(onStart: (config: GameConfig) => void): void {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('Missing #app mount element');
  let error = false;
  const render = (): void => {
    const seatRows = drafts
      .map(
        (seat, index) =>
          `<fieldset class="seat-row" data-seat="${index}"><legend>${t('setup.seat', { seat: index + 1 })}</legend><label><select data-field="control" aria-label="${t('setup.seat', { seat: index + 1 })}"><option value="human" ${seat.control === 'human' ? 'selected' : ''}>${t('setup.human')}</option><option value="bot" ${seat.control === 'bot' ? 'selected' : ''}>${t('setup.bot')}</option><option value="empty" ${seat.control === 'empty' ? 'selected' : ''}>${t('setup.empty')}</option></select></label>${seat.control === 'empty' ? '' : `<label>${t('setup.name')}<input data-field="name" value="${escapeHtml(seat.name || t('setup.defaultName', { n: index + 1 }))}" maxlength="18" required></label><label>${t('setup.class')}<select data-field="classId" aria-label="${t('setup.class')}">${classes.map((classId) => `<option value="${classId}" ${seat.classId === classId ? 'selected' : ''}>${t(`class.${classId}`)}</option>`).join('')}</select></label><img class="portrait" src="/sprites/hero-${seat.classId}-portrait.png" alt="${t(`class.${seat.classId}`)}" width="42" height="42">${seat.control === 'bot' ? `<label>${t('setup.personality')}<select data-field="personality">${personalities.map((personality) => `<option value="${personality}" ${seat.personality === personality ? 'selected' : ''}>${t(`personality.${personality}`)}</option>`).join('')}</select></label>` : ''}`}</fieldset>`,
      )
      .join('');
    root.innerHTML = `<main class="screen setup-screen" data-testid="screen-setup"><header><button class="text-button" data-action="back">← ${t('setup.back')}</button>${languageToggle()}</header><h1 class="pixel">${t('setup.title')}</h1><p>${t('setup.instructions')}</p><form id="setup-form"><div class="seat-list">${seatRows}</div><p class="error" role="alert">${error ? t('setup.invalid') : ''}</p><button class="primary pixel" type="submit">${t('setup.start')}</button></form></main>`;
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
          name: seat.name.trim() || t('setup.defaultName', { n: drafts.indexOf(seat) + 1 }),
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
