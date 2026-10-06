import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const key = 'dice-bandits:intro-seen';
const find = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (id: string) => {
  expect(find(id), id).not.toBeNull();
  find(id)!.click();
};
const press = (key: string, options: KeyboardEventInit = {}) =>
  document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, ...options }),
  );

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  press('Escape');
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  localStorage.clear();
});

async function title() {
  const { setLang } = await import('../../src/i18n');
  setLang('en');
  const { showTitle } = await import('../../src/ui/screens');
  showTitle();
  return showTitle;
}

// Breaks caught: lost title integration, wrong panel boundaries, missing exit
// persistence, untrapped focus, duplicate key handling, and unsafe storage.
it('opens a labelled modal on a new visitor title', async () => {
  await title();
  expect(find('intro-comic')?.getAttribute('role')).toBe('dialog');
  expect(find('intro-comic')?.getAttribute('aria-modal')).toBe('true');
  expect(find('intro-caption')?.textContent).toContain('King Bart');
  expect(find('intro-back')?.hasAttribute('disabled')).toBe(true);
  expect(find('intro-skip')).not.toBeNull();
});

it('moves next and back without going before panel one', async () => {
  await title();
  click('intro-next');
  expect(find('intro-caption')?.textContent).toContain('Baron Raccoon');
  click('intro-back');
  press('ArrowLeft');
  expect(find('intro-caption')?.textContent).toContain('King Bart');
  expect(find('intro-back')?.hasAttribute('disabled')).toBe(true);
});

it('finishes on panel four and remembers completion', async () => {
  const showTitle = await title();
  click('intro-next');
  click('intro-next');
  click('intro-next');
  expect(find('intro-caption')?.textContent).toContain('pocket');
  expect(find('intro-next')).toBeNull();
  expect(find('intro-done')).not.toBeNull();
  expect(find('intro-skip')).not.toBeNull();
  click('intro-done');
  expect(find('intro-comic')).toBeNull();
  expect(localStorage.getItem(key)).toBe('1');
  showTitle();
  expect(find('intro-comic')).toBeNull();
});

it('remembers skipping and returns focus to the story entry', async () => {
  const showTitle = await title();
  click('intro-skip');
  expect(localStorage.getItem(key)).toBe('1');
  expect(document.activeElement).toBe(find('title-story'));
  showTitle();
  expect(find('intro-comic')).toBeNull();
  click('title-story');
  expect(find('intro-caption')?.textContent).toContain('King Bart');
});

it('advances by arrows, Enter, Space and panel tap then exits by Escape', async () => {
  await title();
  press('ArrowRight');
  expect(find('intro-caption')?.textContent).toContain('Baron Raccoon');
  press('ArrowLeft');
  press('Enter');
  expect(find('intro-caption')?.textContent).toContain('Baron Raccoon');
  press(' ');
  expect(find('intro-caption')?.textContent).toContain('crown');
  click('intro-panel');
  expect(find('intro-done')).not.toBeNull();
  press('Escape');
  expect(find('intro-comic')).toBeNull();
  expect(localStorage.getItem(key)).toBe('1');
});

it('traps Tab in the modal and keeps button activation semantic', async () => {
  await title();
  find('intro-next')!.focus();
  press('Tab');
  expect(document.activeElement).toBe(find('intro-skip'));
  press('Tab', { shiftKey: true });
  expect(document.activeElement).toBe(find('intro-next'));
  click('intro-next');
  find('intro-back')!.focus();
  // Enter on a native button must not also advance the story.
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  find('intro-back')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  click('intro-back');
  expect(find('intro-caption')?.textContent).toContain('King Bart');
});

it('does not stack overlays or retain closed keyboard listeners on replay', async () => {
  const showTitle = await title();
  showTitle();
  expect(document.querySelectorAll('[data-testid="intro-comic"]')).toHaveLength(1);
  press('Escape');
  click('title-story');
  press('ArrowRight');
  expect(find('intro-caption')?.textContent).toContain('Baron Raccoon');
});

it('does not auto-open for a returning visitor', async () => {
  localStorage.setItem(key, '1');
  await title();
  expect(find('intro-comic')).toBeNull();
  expect(find('title-story')).not.toBeNull();
});

it('treats an invalid seen value as a fresh visit', async () => {
  localStorage.setItem(key, 'garbage');
  await title();
  expect(find('intro-comic')).not.toBeNull();
});

it('updates captions on a language change without resetting the panel', async () => {
  await title();
  click('intro-next');
  const { setLang } = await import('../../src/i18n');
  setLang('th');
  expect(find('intro-caption')?.textContent).toContain('บารอนแรคคูน');
  expect(find('intro-next')?.textContent).toBe('ถัดไป');
});

it('shows once per page when reads and writes throw but allows replay', async () => {
  const showTitle = await import('../../src/ui/screens').then((m) => m.showTitle);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  expect(() => showTitle()).not.toThrow();
  expect(find('intro-comic')).not.toBeNull();
  expect(() => click('intro-skip')).not.toThrow();
  showTitle();
  expect(find('intro-comic')).toBeNull();
  click('title-story');
  expect(find('intro-comic')).not.toBeNull();
});

// Failed artwork must not strand a visitor or leave a loading indicator forever.
it('shows captions while loading, reveals loaded art and hides the loading message', async () => {
  await title();
  const status = document.querySelector<HTMLElement>('.intro-image-status')!;
  expect(status.textContent).toBe('Loading artwork…');
  expect(find('intro-caption')?.textContent).toContain('King Bart');
  find('intro-panel')!.dispatchEvent(new Event('load'));
  expect(status.hidden).toBe(true);
  expect(find('intro-panel')!.parentElement?.classList.contains('intro-image-ready')).toBe(true);
});

it('falls back to the caption on an artwork error and still exits', async () => {
  await title();
  find('intro-panel')!.dispatchEvent(new Event('error'));
  expect(document.querySelector('.intro-image-status')?.textContent).toContain(
    'Artwork unavailable',
  );
  expect(find('intro-caption')?.textContent).toContain('King Bart');
  click('intro-next');
  expect(find('intro-caption')?.textContent).toContain('Baron Raccoon');
  click('intro-skip');
  expect(find('intro-comic')).toBeNull();
});

it('still closes when only persisting the exit fails', async () => {
  const showTitle = await title();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  click('intro-skip');
  expect(find('intro-comic')).toBeNull();
  showTitle();
  expect(find('intro-comic')).toBeNull();
});
