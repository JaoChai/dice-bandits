import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createGame,
  data,
  legalActions,
  step,
  type GameEvent,
  type GameState,
} from '@dice-bandits/engine';
import type { ClientMsg, ServerMsg } from '@dice-bandits/room';
import { OnlineController } from '../../src/online/onlineController';
import { createDiceyGuide, showDiceyTip } from '../../src/ui/diceyTip';
import { loadTips, resetTips, setEnabled } from '../../src/tutor/tips';
import { setLang } from '../../src/i18n';
import { showActionDialog, showPhaseDialog } from '../../src/ui/dialogs';

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
  expect(find('dicey-tip')?.textContent).toContain('Tap Roll to see your dice total.');
  expect(document.activeElement?.id).toBe('focused');
  find('dicey-tip-ok')!.click();
  expect(dismissed).toBe(1);
  expect(find('dicey-tip')).toBeNull();
});
// Break caught: roll pointer stays at stale coordinates or leaks observers after dismissal.
it('tracks the real roll CTA on resize/language and cleans its observer without dispatch', () => {
  const roll = root().querySelector<HTMLButtonElement>('[data-action-index]')!;
  roll.dataset.testid = 'action-roll';
  let x = 600;
  vi.spyOn(roll, 'getBoundingClientRect').mockImplementation(() => new DOMRect(x, 350, 80, 44));
  const disconnect = vi.fn();
  let onResize: () => void = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const cleanup = showDiceyTip(root(), 'roll', () => {});
  cleanups.push(cleanup);
  const pointer = find('dicey-tip')!.querySelector<HTMLElement>('.dicey-pointer');
  expect(pointer).not.toBeNull();
  expect(find('dicey-tip')!.style.getPropertyValue('--dicey-cta-x')).toBe('640px');
  x = 500;
  window.dispatchEvent(new Event('resize'));
  expect(find('dicey-tip')!.style.getPropertyValue('--dicey-cta-x')).toBe('540px');
  x = 450;
  setLang('th');
  onResize();
  expect(find('dicey-tip')!.style.getPropertyValue('--dicey-cta-x')).toBe('490px');
  expect(find('dicey-tip')!.textContent).toContain('แตะปุ่มทอยเต๋าเพื่อดูแต้มที่ได้');
  cleanup();
  expect(disconnect).toHaveBeenCalledTimes(1);
  x = 700;
  window.dispatchEvent(new Event('resize'));
  onResize();
  expect(find('dicey-tip')).toBeNull();
  vi.unstubAllGlobals();
});
it('omits the roll pointer for non-roll topics or an absent roll control', () => {
  for (const topic of ['shop', 'levelUp', 'chest', 'roll'] as const) {
    const cleanup = showDiceyTip(root(), topic, () => {});
    expect(find('dicey-tip')!.querySelector('.dicey-pointer')).toBeNull();
    cleanup();
  }
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
// Breaks caught: event-only tips auto-acknowledged by the second online render,
// and retained tips escaping local-human eligibility on a takeover refresh.
it.each([
  ['shop', 'shop'],
  ['townChallenge', 'town'],
] as const)(
  'keeps the %s landing tip across both real online view renders',
  async (phase, topic) => {
    const guide = createDiceyGuide(root());
    cleanups.push(() => guide.destroy());
    const prev = state();
    const destination = prev.board.spaces.find(
      (space) =>
        space.kind === (phase === 'shop' ? 'shop' : 'town') &&
        prev.board.spaces.some((from) => from.next.length === 1 && from.next[0] === space.id),
    )!;
    const from = prev.board.spaces.find(
      (space) => space.next.length === 1 && space.next[0] === destination.id,
    )!;
    prev.players[0]!.pos = from.id;
    prev.players[0]!.forcedRoll = 1;
    prev.players[1]!.pos = from.id;
    if (phase === 'townChallenge')
      prev.towns.find((town) => town.spaceId === destination.id)!.owner = 1;
    const landed = step(prev, { type: 'roll' });
    expect(landed.state.phase.kind).toBe(phase);
    const snapshot = JSON.stringify(landed.state);
    const sent: ClientMsg[] = [];
    let events: GameEvent[] = [];
    let previous = prev;
    let ready = false;
    const renders: { topic: string | undefined; seen: string[] }[] = [];
    const controller = new OnlineController({
      state: prev,
      socket: { send: (message) => sent.push(message) },
      onEvents: async (batch) => {
        guide.dismiss();
        events.push(...batch);
      },
      onAwaitingViewChange: () => render(),
    });
    function render() {
      if (!ready || controller.hudOnlineState.awaitingView) return;
      guide.update({
        prev: previous,
        next: controller.state,
        events,
        isLocalHuman: (seat) =>
          seat === controller.you &&
          controller.seats.find((entry) => entry.seat === seat)?.controller !== 'botTakeover',
      });
      previous = controller.state;
      events = [];
      renders.push({ topic: find('dicey-tip')?.dataset.topic, seen: loadTips().seen });
    }
    function view(next: GameState): Extract<ServerMsg, { type: 'view' }> {
      return {
        type: 'view',
        state: next,
        turn: 1,
        you: 0,
        legal: legalActions(next, 0),
        seats: [
          {
            seat: 0,
            name: 'A',
            classId: 'knight',
            kind: 'human',
            controller: 'player',
            connected: true,
          },
          { seat: 1, name: 'B', classId: 'thief', kind: 'bot', controller: 'bot', connected: true },
        ],
        opponentPicked: false,
      };
    }
    await controller.handleMessage(view(prev));
    ready = true;
    await controller.handleMessage({ type: 'events', turn: 1, events: landed.events });
    await controller.handleMessage(view(landed.state)).then(render);
    expect(renders).toEqual([
      { topic, seen: [] },
      { topic, seen: [] },
    ]);
    expect(JSON.stringify(controller.state)).toBe(snapshot);
    expect(sent).toEqual([]);
    if (phase === 'shop') {
      find('dicey-tip-ok')!.click();
      expect(find('dicey-tip')).toBeNull();
    } else {
      const left = step(landed.state, { type: 'leave' });
      await controller.handleMessage({ type: 'events', turn: 2, events: left.events });
      await controller.handleMessage(view(left.state)).then(render);
      expect(find('dicey-tip')?.dataset.topic).not.toBe('town');
    }
    expect(loadTips().seen).toContain(topic);
    expect(sent).toEqual([]);
  },
);
it('keeps a carried event topic on a same-state refresh with no new topics', () => {
  const guide = createDiceyGuide(root());
  cleanups.push(() => guide.destroy());
  const next = state();
  next.phase = { kind: 'chooseBranch', remaining: 3, options: [2, 3] };
  const chest = next.board.spaces.find((space) => space.kind === 'chest')!;
  guide.update({
    ...input(next),
    events: [{ type: 'Moved', seat: 0, params: { to: chest.id, remaining: 0 } }],
  });
  const refreshed: GameState = { ...next, phase: { kind: 'shop', stock: [] } };
  guide.update({ ...input(refreshed), prev: next });
  expect(find('dicey-tip')?.dataset.topic).toBe('chest');
  guide.update(input(refreshed));
  expect(find('dicey-tip')?.dataset.topic).toBe('chest');
  expect(loadTips().seen).toEqual(['fork']);
});
it('dismisses an event-only tip when the same state loses local-human eligibility', () => {
  const guide = createDiceyGuide(root());
  cleanups.push(() => guide.destroy());
  const next = state();
  next.phase = { kind: 'shop', stock: [] };
  const shop = next.board.spaces.find((space) => space.kind === 'shop')!;
  guide.update({
    ...input(next),
    events: [{ type: 'Moved', seat: 0, params: { to: shop.id, remaining: 0 } }],
  });
  expect(find('dicey-tip')?.dataset.topic).toBe('shop');
  guide.update({ ...input(next), isLocalHuman: () => false });
  expect(find('dicey-tip')).toBeNull();
  expect(loadTips().seen).toContain('shop');
});
// Break caught: a real phase/reward choice dispatches but the tip stays until a view arrives.
it.each(['shop', 'levelUp', 'reward'] as const)(
  'dismisses immediately on a real %s dialog choice while the next view is delayed',
  (kind) => {
    const guide = createDiceyGuide(root());
    cleanups.push(() => guide.destroy());
    const next = state();
    next.phase =
      kind === 'levelUp'
        ? { kind: 'levelUp', seat: 0, choices: [data.PERKS[0]!.id], then: 'endTurn' }
        : kind === 'shop'
          ? { kind: 'shop', stock: [] }
          : { kind: 'pvpReward', winner: 0, loser: 1 };
    const topic = kind === 'levelUp' ? 'levelUp' : kind === 'shop' ? 'shop' : 'chest';
    const space = next.board.spaces.find(
      (space) => space.kind === (kind === 'shop' ? 'shop' : 'chest'),
    )!;
    guide.update({
      ...input(next),
      events: [{ type: 'Moved', seat: 0, params: { to: space.id, remaining: 0 } }],
    });
    expect(find('dicey-tip')?.dataset.topic).toBe(topic);
    const snapshot = JSON.stringify(next);
    const sent: ClientMsg[] = [];
    const controller = new OnlineController({
      state: next,
      socket: { send: (message) => sent.push(message) },
      onEvents: async () => {},
    });
    const actions = legalActions(next, 0);
    const dispatch = (action: (typeof actions)[number]) => void controller.dispatch(action);
    if (kind === 'reward') showActionDialog(root(), actions, dispatch);
    else showPhaseDialog(root(), next, actions, dispatch);
    const choice = root().querySelector<HTMLButtonElement>('[data-choice="0"]')!;
    const label = document.createElement('span');
    label.textContent = 'Choose';
    choice.append(label);
    label.click();
    expect(find('dicey-tip')).toBeNull();
    expect(loadTips().seen).toContain(topic);
    expect(sent).toEqual([{ type: 'action', action: actions[0], turn: 0 }]);
    expect(controller.hudOnlineState.awaitingView).toBe(true);
    expect(JSON.stringify(controller.state)).toBe(snapshot);
    expect(root().querySelector('.dialog-shade')).toBeNull();
  },
);
it('does not treat a menu press as acknowledgement or a game action', () => {
  const guide = createDiceyGuide(root());
  cleanups.push(() => guide.destroy());
  guide.update(input());
  const menu = document.createElement('button');
  menu.dataset.testid = 'menu-button';
  menu.textContent = 'Menu';
  root().append(menu);
  menu.click();
  expect(find('dicey-tip')?.dataset.topic).toBe('roll');
  expect(loadTips().seen).toEqual([]);
  find('dicey-tip-ok')!.click();
  expect(find('dicey-tip')).toBeNull();
  expect(loadTips().seen).toEqual(['roll']);
});
// Break caught: readable tip copy still promises a rule the engine does not offer.
it.each(['en', 'th'] as const)('explains the castle healing exception in %s', (lang) => {
  setLang(lang);
  cleanups.push(showDiceyTip(root(), 'castle', () => {}));
  const text = find('dicey-tip')!.querySelector('.dicey-text')!.textContent!;
  expect(text).toContain('50%');
  expect(text).toContain(lang === 'en' ? 'Cursed Capital' : 'เมืองหลวงต้องคำสาป');
  expect(text).toContain(lang === 'en' ? 'max HP' : 'เลือดสูงสุด');
});
it.each(['en', 'th'] as const)('explains the alternative chest rewards in %s', (lang) => {
  setLang(lang);
  cleanups.push(showDiceyTip(root(), 'chest', () => {}));
  const text = find('dicey-tip')!.querySelector('.dicey-text')!.textContent!;
  expect(text).toContain(lang === 'en' ? 'gold or an item' : 'ทองหรือไอเทม');
  expect(text).not.toContain(lang === 'en' ? 'too' : 'ด้วย');
});
it.each(['en', 'th'] as const)('explains immediate monster battle without a toll in %s', (lang) => {
  setLang(lang);
  cleanups.push(showDiceyTip(root(), 'monster', () => {}));
  const text = find('dicey-tip')!.querySelector('.dicey-text')!.textContent!;
  expect(text).toContain(lang === 'en' ? 'Battle starts' : 'เริ่มต่อสู้');
  expect(text).not.toContain(lang === 'en' ? 'toll' : 'ค่าผ่านทาง');
});
it('removes the visible tip and subscriptions on game teardown', () => {
  const guide = createDiceyGuide(root());
  guide.update(input());
  guide.destroy();
  resetTips();
  setEnabled(true);
  expect(find('dicey-tip')).toBeNull();
});
