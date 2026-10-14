import { createGame, legalActions, type GameState } from '@dice-bandits/engine';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { setLang } from '../src/i18n';
import { renderBattleUi } from '../src/ui/battleUi';
import { CARD_ICON } from '../src/ui/artFrames';
import { battleLayout } from '../src/scenes/battle/layout';
import { renderHud } from '../src/ui/hud';
import { observeBattlePicker, type PickerSnapshot } from '../src/scenes/battle/camera';

function fixture(): GameState {
  const state = createGame({
    seed: 'turn-b1',
    rounds: 12,
    seats: [
      { name: 'Hero', classId: 'knight', control: 'human', personality: null },
      { name: 'Rival', classId: 'thief', control: 'human', personality: null },
    ],
  });
  const fighter = (seat: number) => ({
    kind: 'player' as const,
    seat,
    monsterId: null,
    level: 1,
    hp: state.players[seat]!.hp,
    stats: state.players[seat]!.stats,
    secretUsed: false,
    buffs: { ironSkin: false, poison: false, halveNext: false },
  });
  state.phase = {
    kind: 'battle',
    battle: {
      context: 'pvp',
      spaceId: 0,
      a: fighter(0),
      b: fighter(1),
      exchange: 1,
      half: 1,
      attackerSide: 'a',
      pending: { attack: null, defense: null },
    },
  };
  return state;
}
function draw(state: GameState, seat: number, human = true, online = true, busy = false) {
  const root = document.createElement('div');
  root.innerHTML = '<section class="game-shell"><nav class="action-bar"></nav></section>';
  renderBattleUi(
    root,
    state,
    legalActions(state, seat),
    seat,
    vi.fn(),
    (a) => (a.type === 'battlePick' ? a.pick : a.type),
    human,
    online,
    busy,
  );
  return root;
}
afterEach(() => setLang('en'));

// Removing the stance/description markup must fail these observable DOM checks.
it('names the attacker, half and translated card descriptions', () => {
  setLang('th');
  const root = draw(fixture(), 0);
  expect(root.querySelector('[data-testid="stance-banner"]')?.textContent).toContain(
    'ตาบุก · Hero',
  );
  expect(root.querySelector('[data-testid="stance-banner"]')?.textContent).toContain(
    'ยกที่ 1 · ตา 1/2',
  );
  expect(root.querySelector('[data-testid="pick-strike"] .card-description')?.textContent).toBe(
    'พลังโจมตี ×1.5',
  );
  expect(root.querySelector('.battle-portrait')).not.toBeNull();
});
it('renders a non-interactive patterned face-down card with a banner text alternative', () => {
  setLang('th');
  const state = fixture();
  if (state.phase.kind !== 'battle') throw Error('fixture');
  state.phase.battle.pending.attack = 'secret';
  const root = draw(state, 1);
  const back = root.querySelector('[data-testid="chosen-card"]')!;
  expect(back.classList.contains('card-back')).toBe(true);
  expect(back.tagName).not.toBe('BUTTON');
  expect(back.getAttribute('aria-hidden')).toBe('true');
  expect(back.getAttribute('tabindex')).toBeNull();
  expect(back.textContent).toContain('การ์ด Hero (คว่ำอยู่)');
  expect(root.querySelector('[data-testid="stance-banner"]')?.textContent).toContain(
    'การ์ด Hero (คว่ำอยู่)',
  );
  expect(back.textContent).not.toContain('secret');
});
it('uses a shield counter icon, never a skull, on the blue defence frame', () => {
  const state = fixture();
  if (state.phase.kind !== 'battle') throw Error('fixture');
  state.phase.battle.pending.attack = 'attack';
  const root = draw(state, 1);
  expect(CARD_ICON.counter).toBe('shield');
  expect(root.querySelector('[data-testid="pick-counter"]')?.classList.contains('cool')).toBe(true);
  expect(root.querySelector('[data-testid="pick-counter"] .counter-sword')).not.toBeNull();
  expect(root.querySelector('[data-testid="pick-secret"]')?.classList.contains('cool')).toBe(true);
});
it('names the waiting remote human without displaying a pick', () => {
  setLang('th');
  const root = draw(fixture(), 1, false);
  expect(root.querySelector('[data-testid="stance-banner"]')?.textContent).toContain(
    'Hero กำลังเลือก…',
  );
  expect(root.querySelectorAll('[data-action-index]')).toHaveLength(0);
  expect(root.querySelector('[data-testid="chosen-card"]')).toBeNull();
});
it('keeps the locked card and text alternative off the hot-seat privacy screen', () => {
  setLang('th');
  const state = fixture();
  if (state.phase.kind !== 'battle') throw Error('fixture');
  state.phase.battle.pending.attack = 'secret';
  const root = draw(state, 1, true, false);
  expect(root.querySelector('[data-testid="pass-screen"]')).not.toBeNull();
  expect(root.querySelector('[data-testid="chosen-card"]')).toBeNull();
  expect(root.querySelector('[data-testid="stance-banner"]')?.textContent).not.toContain(
    'คว่ำอยู่',
  );
});
it('uses the real monster name in the HP card', () => {
  setLang('th');
  const state = fixture();
  if (state.phase.kind !== 'battle') throw Error('fixture');
  Object.assign(state.phase.battle.b, { kind: 'monster', seat: null, monsterId: 'jellyBun' });
  expect(draw(state, 0).querySelector('.battle-hp-card.right strong')?.textContent).toBe(
    'เจลลี่บัน',
  );
});

it('uses authoritative online defense legality when the pending attack is redacted', () => {
  const state = fixture();
  if (state.phase.kind !== 'battle') throw Error('fixture');
  state.phase.battle.pending.attack = 'secret';
  const defense = legalActions(state, 1);
  state.phase.battle.pending.attack = null; // Same privacy projection as Worker view.
  const root = document.createElement('div');
  root.innerHTML = '<section class="game-shell"><nav class="action-bar"></nav></section>';
  renderBattleUi(
    root,
    state,
    defense,
    1,
    vi.fn(),
    (a) => (a.type === 'battlePick' ? a.pick : a.type),
    true,
    true,
    false,
  );
  expect(root.querySelector('[data-testid="stance-banner"]')?.textContent).toContain(
    'DEFEND TURN · Rival',
  );
  expect(root.querySelector('[data-testid="chosen-card"]')?.textContent).toContain(
    "Hero's card (face down)",
  );
});

// Dropping the public flag at the HUD boundary incorrectly names a redacted
// bot attacker instead of the human defender to an uninvolved online observer.
for (const attackerSide of ['a', 'b'] as const) {
  it(`uses public lock state for an uninvolved observer of bot ${attackerSide} attacking a human`, () => {
    setLang('th');
    const state = fixture();
    if (state.phase.kind !== 'battle') throw Error('fixture');
    state.phase.battle.attackerSide = attackerSide;
    const attacker = attackerSide === 'a' ? 0 : 1;
    const defender = attackerSide === 'a' ? 1 : 0;
    state.players[attacker]!.control = 'bot';
    state.players.push({ ...structuredClone(state.players[0]!), seat: 2, name: 'Observer' });
    const snapshot = structuredClone(state);
    const root = document.createElement('div');
    const render = (opponentPicked: boolean) =>
      renderHud(root, state, vi.fn(), {
        legal: [],
        online: {
          you: 2,
          seats: [],
          opponentPicked,
          socketStatus: 'open',
          awaitingView: false,
          reclaim: vi.fn(),
        },
      });
    render(true);
    expect(root.querySelector('[data-testid="stance-banner"]')?.textContent).toContain(
      `ตารับ · ${state.players[defender]!.name} กำลังเลือก…`,
    );
    expect(root.querySelector('[data-testid="chosen-card"]')?.textContent).toContain(
      `การ์ด ${state.players[attacker]!.name} (คว่ำอยู่)`,
    );
    expect(root.querySelectorAll('[data-action-index]')).toHaveLength(0);
    let picker: PickerSnapshot | null = null;
    const off = observeBattlePicker(root.querySelector('.game-shell')!, (value) => {
      picker = value;
    });
    expect(picker).toMatchObject({
      side: attackerSide === 'a' ? 'b' : 'a',
      role: 'defense',
      ownership: 'remote-human',
    });
    render(false);
    expect(root.querySelector('[data-testid="chosen-card"]')).toBeNull();
    expect(picker).toMatchObject({ side: attackerSide, role: 'attack', ownership: 'bot' });
    expect(state).toEqual(snapshot);
    off();
  });
}

// Reverting the new ground/height lane causes head pixels to enter the 114px HP lane.
for (const viewport of [
  { width: 1280, height: 720 },
  { width: 915, height: 412 },
]) {
  it(`clears the HP lane at maximum zoom for every atlas ${viewport.width}x${viewport.height}`, () => {
    const height = 720;
    const width = (viewport.width * height) / viewport.height;
    const layout = battleLayout(width, height);
    const files = [
      'hero-knight',
      'hero-thief',
      'hero-mage',
      'hero-cleric',
      'monster-jellyBun',
      'monster-mushroomBonk',
      'monster-cactusPunch',
      'monster-coinScorpion',
      'monster-yetiBunny',
      'monster-penguinKnight',
      'monster-lavaImp',
      'monster-maskGoon',
    ];
    for (const file of files) {
      const atlas = JSON.parse(readFileSync(`public/art/${file}.json`, 'utf8'));
      const idle = atlas.frames.idle;
      // Uniform scale is based on idle height; include actual frame dimensions and 3% idle breathing.
      const spriteHeight = idle.h * (layout.fighterHeight / idle.h) * 1.03;
      const cssTop =
        (((layout.groundY - spriteHeight - height / 2) * 1.12 + height / 2) * viewport.height) /
        height;
      expect(cssTop, file).toBeGreaterThan(114);
    }
  });
}
