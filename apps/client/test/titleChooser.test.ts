import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '@dice-bandits/engine';
import { showTitle } from '../src/ui/screens';
import { saveGame } from '../src/save';
import { saveSession } from '../src/online/session';
import { setLang } from '../src/i18n';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('dice-bandits:intro-seen', '1');
  document.body.innerHTML = '<div id="app"></div>';
  setLang('en');
});
const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
const open = () => click('[data-testid="title-play"]');
const save = () =>
  saveGame(
    createGame({
      seed: 'title',
      rounds: 12,
      seats: [
        { name: 'Human', classId: 'knight', control: 'human', personality: null },
        { name: 'Bot', classId: 'thief', control: 'bot', personality: 'greedy' },
      ],
    }),
  );

describe('title chooser', () => {
  it('has one primary action and reveals the options without changing route', () => {
    const newGame = vi.fn();
    showTitle(newGame, { onPractice: vi.fn() });
    expect(document.querySelectorAll('.primary')).toHaveLength(1);
    expect(document.querySelector<HTMLElement>('[data-testid="title-chooser"]')!.hidden).toBe(true);
    const route = location.href;
    open();
    expect(location.href).toBe(route);
    expect(document.querySelector('[data-testid="title-chooser"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="title-recommended"]')).not.toBeNull();
    click('[data-action="new"]');
    expect(newGame).toHaveBeenCalledOnce();
  });
  it('only offers Continue for a valid save and dispatches the real saved state', () => {
    showTitle();
    open();
    expect(document.querySelector('[data-action="continue"]')).toBeNull();
    save();
    showTitle();
    open();
    const handler = vi.fn();
    document.querySelector('#app')!.addEventListener('dice-bandits:continue', handler);
    click('[data-action="continue"]');
    expect(handler).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-action="continue"]')!.textContent).toContain(
      'Back to your saved game',
    );
    expect(document.querySelector('[data-action="continue"]')!.textContent).not.toContain(
      'turn 12',
    );
  });
  it.each(['save', 'complete'])('does not recommend practice with %s', (kind) => {
    if (kind === 'save') save();
    else sessionStorage.setItem('dice-bandits:practice-complete', '1');
    showTitle(vi.fn(), { onPractice: vi.fn() });
    open();
    expect(document.querySelector('[data-testid="title-recommended"]')).toBeNull();
  });
  it('restores Play focus with Back and Escape, including after repeated renders', () => {
    showTitle();
    open();
    click('[data-testid="title-back"]');
    expect(document.activeElement).toBe(document.querySelector('[data-testid="title-play"]'));
    open();
    document
      .querySelector('[data-testid="title-chooser"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(document.querySelector('[data-testid="title-play"]'));
  });
  it('keeps real action identifiers, room callback, language and sound controls reachable', () => {
    const back = vi.fn();
    saveSession({ code: 'ABCDE', seat: 0, token: 'test-only', name: 'Human' });
    showTitle(vi.fn(), { onPractice: vi.fn(), back });
    open();
    for (const id of [
      'online-create',
      'online-join',
      'title-story',
      'title-practice',
      'online-back',
      'audio-settings',
    ]) {
      expect(document.querySelector(`[data-testid="${id}"]`)).toBeInstanceOf(HTMLButtonElement);
    }
    click('[data-testid="online-back"]');
    expect(back).toHaveBeenCalledWith('ABCDE');
    click('[data-testid="title-language"]');
    expect(document.querySelector('[data-lang="th"]')).not.toBeNull();
  });
});
