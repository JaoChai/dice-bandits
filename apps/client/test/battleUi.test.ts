import { createGame, type Action, type GameState } from '@dice-bandits/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLang, t } from '../src/i18n';
import * as battleUi from '../src/ui/battleUi';
import { renderBattleUi } from '../src/ui/battleUi';
import { planBattle, type BattleBeat } from '../src/scenes/battle/presentation';

function battleState(): GameState {
  const state = createGame({
    seed: 'battle-ui',
    rounds: 12,
    seats: [
      { name: 'Hero', classId: 'knight', control: 'human', personality: null },
      { name: 'Rival', classId: 'thief', control: 'human', personality: null },
    ],
  });
  const a = state.players[0]!;
  const b = state.players[1]!;
  state.phase = {
    kind: 'battle',
    battle: {
      context: 'pvp',
      spaceId: a.pos,
      a: {
        kind: 'player',
        seat: 0,
        monsterId: null,
        level: a.level,
        hp: 38,
        stats: a.stats,
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
      b: {
        kind: 'player',
        seat: 1,
        monsterId: null,
        level: b.level,
        hp: 12,
        stats: b.stats,
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
      exchange: 1,
      half: 1,
      attackerSide: 'a',
      pending: { attack: null, defense: null },
    },
  };
  return state;
}

const actions: Action[] = [
  { type: 'battlePick', side: 'a', pick: 'attack' },
  { type: 'battlePick', side: 'a', pick: 'strike' },
  { type: 'battlePick', side: 'a', pick: 'secret' },
  { type: 'useItem', item: 'potion', target: null },
];

function render(state = battleState(), awaitingView = false) {
  const root = document.createElement('div');
  root.innerHTML =
    '<section class="game-shell"><header class="game-topline"><button data-action="exit">Back to title</button></header><nav class="action-bar"></nav></section>';
  const dispatch = vi.fn();
  renderBattleUi(
    root,
    state,
    actions,
    0,
    dispatch,
    (action) =>
      action.type === 'battlePick'
        ? t(`action.${action.pick}`)
        : `${t('action.item')} · ${t('item.potion')}`,
    true,
    true,
    awaitingView,
  );
  return { root, dispatch };
}

afterEach(() => {
  setLang('en');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const beat = (kind: BattleBeat['kind'], duration = 350): BattleBeat => ({
  kind,
  duration,
  result: kind === 'result' ? 'nextHalf' : null,
  targets:
    kind === 'damage' || kind === 'drain' || duration === 0
      ? [{ side: 'a', amount: 7, fromHp: 38, toHp: 31 }]
      : [],
  outcome: 'hit',
  attacker: 'b',
});

// A premature HP commit, missing aria updates, uncancelled rAF or reading
// pending picks instead of revealed events must fail these real DOM assertions.
describe('battle presented HP and readout', () => {
  // Reverting post-battle max reconciliation must clamp 54 back to 48 here.
  for (const reduced of [false, true]) {
    it(`reconciles winning level-up text, aria and fill to 54/54 (${reduced ? 'static' : 'animated'})`, () => {
      const previous = battleState();
      if (previous.phase.kind !== 'battle') throw new Error('battle');
      previous.phase.battle.a.hp = 46;
      previous.players[0]!.hp = 46;
      const next = structuredClone(previous);
      next.phase = { kind: 'awaitRoll' };
      next.players[0]!.hp = 54;
      next.players[0]!.stats.maxHp = 54;
      const snapshot = structuredClone({ previous, next });
      const plan = planBattle(
        previous,
        next,
        [
          {
            type: 'DamageDealt',
            seat: 0,
            params: { attacker: 0, defender: 1, toDefender: 12, toAttacker: 0 },
          },
          { type: 'LevelUp', seat: 0, params: { level: 2 } },
          { type: 'BattleEnded', seat: 0, params: { result: 'aWin' } },
        ],
        'human',
        reduced,
      );
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
        frames.push(fn);
        return frames.length;
      });
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
      const { root } = render(previous);
      const readout = battleUi.createBattleReadout(root);
      readout.reset(previous);
      for (const entry of plan) {
        readout.showBeat(entry);
        if (entry.kind === 'damage') {
          expect(root.querySelector('[data-testid="hp-left"]')?.textContent).toBe('46/48');
        }
      }
      expect(root.querySelector('[data-testid="hp-left"]')?.textContent).toBe('54/54');
      const meter = root.querySelector('.left [role="meter"]')!;
      expect(meter.getAttribute('aria-valuenow')).toBe('54');
      expect(meter.getAttribute('aria-valuemax')).toBe('54');
      expect(meter.querySelector<HTMLElement>('span')?.style.width).toBe('100%');
      // Animated KO stays zero; static playback uses the authoritative respawn.
      expect(root.querySelector('.right [role="meter"]')?.getAttribute('aria-valuenow')).toBe(
        reduced ? String(next.players[1]!.hp) : '0',
      );
      readout.reset(next);
      for (const callback of frames) callback(99999);
      expect(root.querySelector('[data-testid="hp-left"]')?.textContent).toBe('54/54');
      expect({ previous, next }).toEqual(snapshot);
      readout.destroy();
    });

    for (const side of ['a', 'b'] as const) {
      it(`reconciles a max-only ended change on side ${side} (${reduced ? 'static' : 'animated'})`, () => {
        const previous = battleState();
        if (previous.phase.kind !== 'battle') throw new Error('battle');
        previous.players[0]!.hp = previous.phase.battle.a.hp;
        previous.players[1]!.hp = previous.phase.battle.b.hp;
        const next = structuredClone(previous);
        next.phase = { kind: 'awaitRoll' };
        const seat = side === 'a' ? 0 : 1;
        next.players[seat]!.stats.maxHp += 6;
        const { root } = render(previous);
        const readout = battleUi.createBattleReadout(root);
        readout.reset(previous);
        for (const entry of planBattle(
          previous,
          next,
          [{ type: 'BattleEnded', seat: 0, params: { result: 'draw' } }],
          'human',
          reduced,
        ))
          readout.showBeat(entry);
        const meter = root.querySelector(`.${side === 'a' ? 'left' : 'right'} [role="meter"]`)!;
        const player = next.players[seat]!;
        expect(meter.getAttribute('aria-valuemax')).toBe(String(player.stats.maxHp));
        expect(meter.getAttribute('aria-valuenow')).toBe(String(player.hp));
        expect(meter.querySelector<HTMLElement>('span')?.style.width).toBe(
          `${(player.hp / player.stats.maxHp) * 100}%`,
        );
        readout.destroy();
      });
    }
  }

  // Literal user-facing names catch t(key)'s raw-key fallback, unlike t-vs-t assertions.
  for (const [lang, names] of [
    ['en', ['Bulwark', 'Pickpocket', 'Firestorm', 'Sanctuary']],
    ['th', ['กำแพงเหล็ก', 'ล้วงกระเป๋า', 'พายุเพลิง', 'แดนศักดิ์สิทธิ์']],
  ] as const) {
    for (const [index, secretId] of ['bulwark', 'pickpocket', 'firestorm', 'sanctuary'].entries()) {
      it(`renders the public ${secretId} reveal in ${lang} without leaking it before reveal`, () => {
        setLang(lang);
        const { root } = render();
        const readout = battleUi.createBattleReadout(root);
        readout.reset(battleState());
        readout.showBeat(beat('reveal'));
        expect(root.textContent).not.toContain(names[index]);
        readout.showBeat({ ...beat('reveal'), revealed: [{ side: 'a', secretId }] });
        expect(root.querySelector('[data-testid="battle-readout"]')?.textContent).toContain(
          names[index],
        );
        expect(root.textContent).not.toContain('secret.');
        readout.destroy();
      });
    }
  }

  it('holds both text and meter until drain, including an authoritative HUD rerender', () => {
    const previous = battleState();
    const next = structuredClone(previous);
    if (next.phase.kind !== 'battle') throw new Error('battle');
    next.phase.battle.a.hp = 31;
    const { root } = render(previous);
    const readout = battleUi.createBattleReadout(root);
    readout.reset(previous);
    readout.showBeat(beat('reveal'));
    renderBattleUi(root, next, actions, 0, vi.fn(), () => 'pick', true, true);
    readout.showBeat(beat('damage', 500));
    expect(root.querySelector('[data-testid="hp-left"]')?.textContent).toBe('38/48');
    expect(root.querySelector('.left [role="meter"]')?.getAttribute('aria-valuenow')).toBe('38');
    expect(root.querySelector('[data-testid="battle-readout"]')?.textContent).toContain('7');
    readout.destroy();
  });

  it('interpolates the number, aria meter and fill together then reaches exact next HP', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
      frames.push(fn);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const { root } = render();
    const readout = battleUi.createBattleReadout(root);
    readout.reset(battleState());
    readout.showBeat(beat('drain'));
    expect(frames).toHaveLength(1);
    frames.shift()!(1175);
    expect(root.querySelector('[data-testid="hp-left"]')?.textContent).toBe('35/48');
    expect(root.querySelector('.left [role="meter"]')?.getAttribute('aria-valuenow')).toBe('35');
    frames.shift()!(1350);
    expect(root.querySelector('[data-testid="hp-left"]')?.textContent).toBe('31/48');
    expect(root.querySelector<HTMLElement>('.left .battle-hp-track span')?.style.width).toBe(
      `${(31 / 48) * 100}%`,
    );
    readout.destroy();
  });

  it('finishes a drain exactly at the result boundary even if the last frame has not fired', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
      frames.push(fn);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const { root } = render();
    const readout = battleUi.createBattleReadout(root);
    readout.reset(battleState());
    readout.showBeat(beat('drain'));
    frames.shift()!(1300);
    readout.showBeat(beat('result'));
    expect(root.querySelector('[data-testid="hp-left"]')?.textContent).toBe('31/48');
    expect(root.querySelector('.left [role="meter"]')?.getAttribute('aria-valuenow')).toBe('31');
    readout.destroy();
  });

  it('resets synchronously to final HP and fences stale animation callbacks', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
      frames.push(fn);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const previous = battleState();
    const next = structuredClone(previous);
    if (next.phase.kind !== 'battle') throw new Error('battle');
    next.phase.battle.a.hp = 31;
    const { root } = render(previous);
    const readout = battleUi.createBattleReadout(root);
    readout.reset(previous);
    readout.showBeat(beat('drain'));
    readout.reset(next);
    expect(frames).toHaveLength(1);
    frames[0]!(99999);
    expect(root.querySelector('[data-testid="hp-left"]')?.textContent).toBe('31/48');
    expect(root.querySelector('[data-testid="battle-readout"]')).toBeNull();
    expect(previous.phase.kind === 'battle' && previous.phase.battle.a.hp).toBe(38);
    readout.destroy();
  });

  it('shows a static consequence without scheduling frames and renders winner by name', () => {
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    const { root } = render();
    const readout = battleUi.createBattleReadout(root);
    readout.reset(battleState());
    readout.showBeat({ ...beat('result', 0), result: 'loss', winner: 'b' });
    expect(root.querySelector('[data-testid="hp-left"]')?.textContent).toBe('31/48');
    expect(root.querySelector('[data-testid="battle-readout"]')?.textContent).toContain('Rival');
    expect(raf).not.toHaveBeenCalled();
    readout.destroy();
  });

  it('never exposes a pending secret and reveals only event-provided secret identifiers', () => {
    const state = battleState();
    if (state.phase.kind !== 'battle') throw new Error('battle');
    state.phase.battle.pending.attack = 'secret';
    const { root } = render(state);
    const readout = battleUi.createBattleReadout(root);
    readout.reset(state);
    readout.showBeat(beat('reveal'));
    expect(root.querySelector('[data-testid="battle-readout"]')?.textContent).not.toContain(
      t('secret.bulwark'),
    );
    readout.showBeat({ ...beat('reveal'), revealed: [{ side: 'a', secretId: 'bulwark' }] });
    expect(root.querySelector('[data-testid="battle-readout"]')?.textContent).toContain(
      t('secret.bulwark'),
    );
    readout.destroy();
  });

  it('uses explicit miss text, not a zero damage hit or a premature victory', () => {
    const { root } = render();
    const readout = battleUi.createBattleReadout(root);
    readout.reset(battleState());
    readout.showBeat({ ...beat('damage'), outcome: 'miss', targets: [] });
    expect(root.querySelector('[data-testid="battle-readout"]')?.textContent).toBe(
      t('battle.outcome.miss'),
    );
    readout.showBeat(beat('result'));
    expect(root.querySelector('[data-testid="battle-readout"]')?.textContent).toBe(
      t('battle.result.nextHalf'),
    );
    readout.destroy();
  });

  it('clears transient readout on pass screen and releases its lifecycle on destroy', () => {
    const { root } = render();
    const readout = battleUi.createBattleReadout(root);
    readout.reset(battleState());
    readout.showBeat(beat('anticipation'));
    const state = battleState();
    if (state.phase.kind !== 'battle') throw new Error('battle');
    state.phase.battle.pending.attack = 'attack';
    renderBattleUi(root, state, actions, 1, vi.fn(), () => 'pick', true, false);
    expect(root.querySelector('[data-testid="pass-screen"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="battle-readout"]')).toBeNull();
    readout.destroy();
    readout.showBeat(beat('damage'));
    expect(root.querySelector('[data-testid="battle-readout"]')).toBeNull();
  });
});

describe('renderBattleUi', () => {
  it('marks the board stage as the contained battle panel only during battle', () => {
    const state = battleState();
    const root = document.createElement('div');
    root.innerHTML =
      '<section class="game-shell"><div class="board-stage"></div><nav class="action-bar"></nav></section>';
    const args = [root, state, actions, 0, vi.fn(), () => 'pick', true, true] as const;
    renderBattleUi(...args);
    expect(root.querySelector('.board-stage')?.classList.contains('battle-panel')).toBe(true);
    state.phase = createGame({
      seed: 'panel-reset',
      rounds: 12,
      seats: [
        { name: 'Hero', classId: 'knight', control: 'human', personality: null },
        { name: 'Rival', classId: 'thief', control: 'bot', personality: null },
      ],
    }).phase;
    renderBattleUi(...args);
    expect(root.querySelector('.board-stage')?.classList.contains('battle-panel')).toBe(false);
  });

  it('shows exact HP from both combatants as DOM text, not canvas glyphs', () => {
    const state = battleState();
    if (state.phase.kind !== 'battle') throw new Error('expected battle');
    state.phase.battle.a.hp = 36;
    const { root } = render(state);
    expect(root.querySelector('[data-testid="hp-left"]')?.textContent).toBe(
      `36/${state.phase.battle.a.stats.maxHp}`,
    );
    expect(root.querySelector('[data-testid="hp-right"]')?.textContent).toBe(
      `12/${state.phase.battle.b.stats.maxHp}`,
    );
  });

  it('renders three translated pick cards with icons and retained pick IDs', () => {
    setLang('th');
    const { root, dispatch } = render();
    const cards = root.querySelectorAll<HTMLButtonElement>('.command-card');
    expect(cards).toHaveLength(3);
    for (const [index, pick] of ['attack', 'strike', 'secret'].entries()) {
      expect(cards[index]?.dataset.testid).toBe(`pick-${pick}`);
      expect(cards[index]?.querySelector('.card-icon')).not.toBeNull();
      expect(cards[index]?.querySelector('.card-label')?.textContent).toBe(t(`action.${pick}`));
    }
    cards[0]?.click();
    expect(dispatch).toHaveBeenCalledWith(actions[0]);
  });

  it('marks the chosen card with a cursor and never preselects the other side secret', () => {
    const state = battleState();
    if (state.phase.kind !== 'battle') throw new Error('expected battle');
    state.phase.battle.pending.attack = 'attack';
    const { root } = render(state);
    expect(root.querySelector('[data-testid="chosen-card"]')).not.toBeNull();
    expect(root.querySelector('.command-card.selected')).toBeNull();
    state.phase.battle.pending.attack = 'secret';
    const defender = document.createElement('div');
    defender.innerHTML = '<section class="game-shell"><nav class="action-bar"></nav></section>';
    renderBattleUi(
      defender,
      state,
      [
        { type: 'battlePick', side: 'b', pick: 'defend' },
        { type: 'battlePick', side: 'b', pick: 'counter' },
        { type: 'battlePick', side: 'b', pick: 'secret' },
      ],
      1,
      vi.fn(),
      (action) => (action.type === 'battlePick' ? t(`action.${action.pick}`) : ''),
      true,
      true,
    );
    expect(defender.querySelectorAll('.command-card.selected')).toHaveLength(0);
  });

  it('keeps a playable pick mounted across repeated online snapshots', () => {
    const state = battleState();
    const { root, dispatch } = render(state);
    const pick = root.querySelector<HTMLButtonElement>('[data-testid="pick-attack"]')!;
    const draw = () =>
      renderBattleUi(
        root,
        state,
        actions,
        0,
        dispatch,
        (action) =>
          action.type === 'battlePick'
            ? t(`action.${action.pick}`)
            : `${t('action.item')} · ${t('item.potion')}`,
        true,
        true,
      );
    draw();
    draw();
    expect(root.querySelector('[data-testid="pick-attack"]')).toBe(pick);
    pick.click();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('updates the battle exit control when switching to Thai', () => {
    setLang('th');
    const { root } = render();
    expect(root.querySelector('[data-action="exit"]')?.textContent).toBe(t('setup.back'));
  });

  it('renders smaller item cards with retained IDs and disables all cards while awaiting a view', () => {
    const { root, dispatch } = render(battleState(), true);
    const item = root.querySelector<HTMLButtonElement>('[data-testid="action-useItem-potion"]');
    expect(item?.classList.contains('item-card')).toBe(true);
    expect(item?.querySelector('.card-icon')).not.toBeNull();
    expect(root.querySelectorAll<HTMLButtonElement>('.command-card:disabled')).toHaveLength(3);
    expect(item?.disabled).toBe(true);
    item?.click();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
