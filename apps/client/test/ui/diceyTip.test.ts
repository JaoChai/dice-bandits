import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGame, type GameState } from '@dice-bandits/engine';
import { createDiceyGuide, showDiceyTip } from '../../src/ui/diceyTip';
import { loadTips, resetTips, setEnabled } from '../../src/tutor/tips';
import { setLang } from '../../src/i18n';

const find = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
let cleanups: (() => void)[];
beforeEach(() => {
  localStorage.clear();
  resetTips();
  setEnabled(true);
  setLang('en');
  document.body.innerHTML =
    '<button id="focused">Game control</button><div id="app"><section class="game-shell"><button data-action-index="0">Roll</button></section></div>';
  document.getElementById('focused')!.focus();
  cleanups = [];
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
const root = () => document.getElementById('app')!;
function state(): GameState {
  return createGame({
    seed: 'dicey-dom',
    rounds: 12,
    seats: [
      { name: 'A', classId: 'knight', control: 'human', personality: null },
      { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' },
    ],
  });
}
function input(next = state()) {
  return { prev: next, next, events: [], isLocalHuman: (seat: number) => seat === 0 };
}

// Breaks caught: modal/focus theft, missing read-only dismiss, image failures
// removing the instruction, stale language, and handlers leaking past game exit.
it('shows a non-modal status without stealing focus and dismisses by Got it', () => {
  let dismissed = 0;
  cleanups.push(
    showDiceyTip(root(), 'roll', () => {
      dismissed++;
    }),
  );
  expect(find('dicey-tip')?.getAttribute('role')).toBe('status');
  expect(find('dicey-tip')?.hasAttribute('aria-modal')).toBe(false);
  expect(find('dicey-tip')?.textContent).toContain('Tap the big die');
  expect(document.activeElement?.id).toBe('focused');
  find('dicey-tip-ok')!.click();
  expect(dismissed).toBe(1);
  expect(find('dicey-tip')).toBeNull();
});
it('keeps the text usable while loading, then crops the pointing atlas frame', () => {
  cleanups.push(showDiceyTip(root(), 'roll', () => {}));
  const portrait = document.querySelector<HTMLElement>('.dicey-portrait')!;
  expect(portrait.hidden).toBe(true);
  expect(find('dicey-tip-ok')).not.toBeNull();
  document.querySelector('.dicey-art-loader')!.dispatchEvent(new Event('load'));
  expect(portrait.hidden).toBe(false);
  expect(portrait.style.backgroundImage).toContain('/art/tutor/dicey.webp');
  expect(portrait.style.backgroundPosition).toContain('-');
});
it('uses a text-only bubble and warns once if art is missing', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  cleanups.push(showDiceyTip(root(), 'battle', () => {}));
  document.querySelector('.dicey-art-loader')!.dispatchEvent(new Event('error'));
  expect(document.querySelector<HTMLElement>('.dicey-portrait')!.hidden).toBe(true);
  expect(find('dicey-tip')?.textContent).toContain('Battle!');
  expect(warn.mock.calls.flat().join(' ')).toContain('Dicey');
  find('dicey-tip-ok')!.click();
  expect(find('dicey-tip')).toBeNull();
});
it('changes language without losing the current topic or focus', () => {
  cleanups.push(showDiceyTip(root(), 'fork', () => {}));
  setLang('th');
  expect(find('dicey-tip')?.textContent).toContain('ทางแยก');
  expect(find('dicey-tip-ok')?.textContent).toBe('เข้าใจแล้ว');
  expect(document.activeElement?.id).toBe('focused');
});
it('stops language and image handlers when removed', () => {
  const cleanup = showDiceyTip(root(), 'roll', () => {});
  const portrait = document.querySelector<HTMLElement>('.dicey-portrait')!;
  const loader = document.querySelector('.dicey-art-loader')!;
  cleanup();
  setLang('th');
  loader.dispatchEvent(new Event('load'));
  expect(find('dicey-tip')).toBeNull();
  expect(portrait.hidden).toBe(true);
});
it('shows the initial roll and remembers acknowledgement without mutating game state', () => {
  const guide = createDiceyGuide(root());
  cleanups.push(() => guide.destroy());
  const next = state();
  const snapshot = JSON.stringify(next);
  guide.update(input(next));
  expect(find('dicey-tip')?.dataset.topic).toBe('roll');
  find('dicey-tip-ok')!.click();
  expect(loadTips().seen).toContain('roll');
  guide.update(input(state()));
  expect(find('dicey-tip')).toBeNull();
  expect(JSON.stringify(next)).toBe(snapshot);
});
it('dismisses on a real game action press without preventing its click', () => {
  const guide = createDiceyGuide(root());
  cleanups.push(() => guide.destroy());
  guide.update(input());
  let actions = 0;
  const button = document.querySelector<HTMLButtonElement>('[data-action-index]')!;
  button.addEventListener('click', () => actions++);
  button.click();
  expect(find('dicey-tip')).toBeNull();
  expect(loadTips().seen).toContain('roll');
  expect(actions).toBe(1);
});
it('dismisses old state tips on a new state and shows the next queued topic', () => {
  const guide = createDiceyGuide(root());
  cleanups.push(() => guide.destroy());
  const prev = state();
  guide.update(input(prev));
  const next = state();
  next.phase = { kind: 'chooseBranch', remaining: 3, options: [2, 3] };
  guide.update({ ...input(next), prev });
  expect(loadTips().seen).toContain('roll');
  expect(find('dicey-tip')?.dataset.topic).toBe('fork');
});
it('does not dismiss on repeated status renders of the identical state', () => {
  const guide = createDiceyGuide(root());
  cleanups.push(() => guide.destroy());
  const data = input();
  guide.update(data);
  guide.update(data);
  expect(find('dicey-tip')?.dataset.topic).toBe('roll');
  expect(loadTips().seen).toEqual([]);
});
it('hides immediately on disabling and reset re-evaluates the current state', () => {
  const guide = createDiceyGuide(root());
  cleanups.push(() => guide.destroy());
  guide.update(input());
  setEnabled(false);
  expect(find('dicey-tip')).toBeNull();
  resetTips();
  expect(find('dicey-tip')).toBeNull();
  setEnabled(true);
  expect(find('dicey-tip')?.dataset.topic).toBe('roll');
});
it('shows nothing for bot, remote and bot-takeover predicates', () => {
  const guide = createDiceyGuide(root());
  cleanups.push(() => guide.destroy());
  guide.update({ ...input(), isLocalHuman: () => false });
  expect(find('dicey-tip')).toBeNull();
});
it('does not drain carried tips while a bot controls the turn', () => {
  const guide = createDiceyGuide(root());
  cleanups.push(() => guide.destroy());
  const next = state();
  next.phase = { kind: 'chooseBranch', remaining: 3, options: [2, 3] };
  guide.update(input(next));
  const bot = state();
  bot.turnSeat = 1;
  guide.update({ ...input(bot), prev: next });
  expect(find('dicey-tip')).toBeNull();
});
it('removes the visible tip and subscriptions on game teardown', () => {
  const guide = createDiceyGuide(root());
  guide.update(input());
  guide.destroy();
  resetTips();
  setEnabled(true);
  expect(find('dicey-tip')).toBeNull();
});
