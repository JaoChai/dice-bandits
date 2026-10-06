import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, type GameEvent } from '@dice-bandits/engine';
import { createDiceRoll, readRollResult } from '../../src/ui/diceRoll';
import { renderHud } from '../../src/ui/hud';
import { setLang } from '../../src/i18n';

const event = (params: GameEvent['params'], seat: number | null = 0): GameEvent => ({
  type: 'DiceRolled',
  seat,
  params,
});
const roll = { seat: 0, total: 5, count: 1, sides: 6 };
const find = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
let dice: ReturnType<typeof createDiceRoll>;
let root: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  setLang('en');
  document.body.innerHTML =
    '<div id="app"><header class="game-topline"></header><button id="focus">Menu</button></div>';
  root = document.getElementById('app')!;
  document.getElementById('focus')!.focus();
  dice = createDiceRoll(root);
});
afterEach(() => {
  dice.destroy();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// Breaks caught: coercion/malformed telemetry, treating dice count as faces,
// inventing a face for a total, wrong timing branches, stale timers/language,
// focus theft, and clickable actions while presentation is busy.
describe('authoritative roll payload', () => {
  it('reads the real single-die result, not movement distance', () => {
    expect(readRollResult(event({ value: 5, dice: 1, sides: 6 }))).toEqual(roll);
    expect(readRollResult(event({ value: 9, dice: 2, sides: 6 }, null))).toEqual({
      seat: null,
      total: 9,
      count: 2,
      sides: 6,
    });
  });
  it.each([
    { value: '5', dice: 1, sides: 6 },
    { value: NaN, dice: 1, sides: 6 },
    { value: 2.5, dice: 1, sides: 6 },
    { value: 5, dice: 0, sides: 6 },
    { value: 5, dice: 1.5, sides: 6 },
    { value: 5, dice: 1, sides: Infinity },
    { value: 5, dice: 1, sides: -1 },
    { value: 5 },
  ])('rejects malformed payload %j without guessing', (params) => {
    expect(readRollResult(event(params as GameEvent['params']))).toBeNull();
  });
  it('ignores other events', () => {
    expect(
      readRollResult({ type: 'Moved', seat: 0, params: { value: 5, dice: 1, sides: 6 } }),
    ).toBeNull();
  });
});

it('holds movement through 900 ms tumble and 1400 ms readable result', async () => {
  const order: string[] = [];
  const pending = dice
    .play(roll, { speed: 1, reduced: false, waitBeforeMovement: true })
    .then(() => order.push('movement'));
  expect(find('dice-roll')?.dataset.stage).toBe('rolling');
  expect(find('dice-roll')?.textContent).toContain('Rolling…');
  expect(find('last-roll-chip')?.textContent).toBe('Rolled 5');
  expect(document.activeElement?.id).toBe('focus');
  await vi.advanceTimersByTimeAsync(899);
  expect(order).toEqual([]);
  expect(find('dice-roll')?.dataset.stage).toBe('rolling');
  await vi.advanceTimersByTimeAsync(1);
  expect(find('dice-roll')?.dataset.stage).toBe('result');
  expect(find('dice-roll')?.textContent).toContain('Rolled 5');
  expect(document.querySelectorAll('.dice-pip')).toHaveLength(5);
  await vi.advanceTimersByTimeAsync(1399);
  expect(order).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(order).toEqual(['movement']);
  expect(find('dice-roll')).toBeNull();
  expect(find('last-roll-chip')?.textContent).toBe('Rolled 5');
});

it('scales both local-human stages by speed', async () => {
  let settled = false;
  const pending = dice
    .play(roll, { speed: 0.5, reduced: false, waitBeforeMovement: true })
    .then(() => {
      settled = true;
    });
  await vi.advanceTimersByTimeAsync(450);
  expect(find('dice-roll')?.dataset.stage).toBe('result');
  await vi.advanceTimersByTimeAsync(699);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(settled).toBe(true);
});

it.each([
  ['reduced motion', 1, true, true],
  ['speed zero', 0, false, true],
  ['bot', 1, false, false],
  ['online', 1, false, false],
] as const)(
  'shows a static badge with no awaited timer for %s',
  async (_mode, speed, reduced, waitBeforeMovement) => {
    await dice.play(roll, { speed, reduced, waitBeforeMovement });
    expect(vi.getTimerCount()).toBe(0);
    expect(find('dice-roll')?.dataset.stage).toBe('result');
    expect(find('dice-roll')?.textContent).toContain('Rolled 5');
    expect(find('last-roll-chip')?.getAttribute('role')).toBe('status');
    expect(find('dice-roll')?.hasAttribute('aria-modal')).toBe(false);
  },
);

it.each([
  [1, 3, 3, 3],
  [1, 6, 6, 6],
  [2, 6, 9, 0],
  [1, 8, 7, 0],
  [1, 3, 5, 0],
  [1, 6, 0, 0],
])('draws truthful pips only for %i × d%i total %i', async (count, sides, total, pips) => {
  await dice.play(
    { seat: 0, count, sides, total },
    { speed: 0, reduced: false, waitBeforeMovement: true },
  );
  expect(find('dice-roll')?.textContent).toContain(`Rolled ${total}`);
  expect(document.querySelectorAll('.dice-pip')).toHaveLength(pips);
  if (!pips) expect(find('dice-roll')?.textContent).toContain(`${count} × d${sides}`);
});

it('replaces pending rolls without old cleanup erasing a newer result', async () => {
  const first = dice.play(roll, { speed: 1, reduced: false, waitBeforeMovement: true });
  await vi.advanceTimersByTimeAsync(900);
  await dice.play({ ...roll, total: 3 }, { speed: 0, reduced: false, waitBeforeMovement: false });
  await first;
  await vi.advanceTimersByTimeAsync(3000);
  expect(find('last-roll-chip')?.textContent).toBe('Rolled 3');
  expect(document.querySelectorAll('[data-testid="dice-roll"]')).toHaveLength(1);
  expect(find('dice-roll')?.textContent).toContain('Rolled 3');
});

it.each([100, 1000])(
  'destroy at %i ms settles play and removes all owned UI/listeners',
  async (elapsed) => {
    const pending = dice.play(roll, { speed: 1, reduced: false, waitBeforeMovement: true });
    await vi.advanceTimersByTimeAsync(elapsed);
    dice.destroy();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
    setLang('th');
    await dice.play(roll, { speed: 1, reduced: false, waitBeforeMovement: true });
    expect(find('dice-roll')).toBeNull();
    expect(find('last-roll-chip')).toBeNull();
  },
);

it('refreshes chip and result language without restarting presentation', async () => {
  const pending = dice.play(roll, { speed: 1, reduced: false, waitBeforeMovement: true });
  await vi.advanceTimersByTimeAsync(900);
  setLang('th');
  expect(find('last-roll-chip')?.textContent).toBe('ทอยได้ 5');
  expect(find('dice-roll')?.textContent).toContain('ทอยได้ 5');
  await vi.advanceTimersByTimeAsync(1400);
  await pending;
  expect(find('last-roll-chip')?.textContent).toBe('ทอยได้ 5');
});

it('starts empty and never infers a fresh roll from saved state', () => {
  expect(find('last-roll-chip')).toBeNull();
  expect(find('dice-roll')).toBeNull();
});

it.each(['awaitRoll', 'shop', 'levelUp', 'pvpReward'] as const)(
  'presentation busy disables %s tray/dialog actions',
  (phase) => {
    const state = createGame({
      seed: 'dice-hud',
      rounds: 12,
      seats: [
        { name: 'A', classId: 'knight', control: 'human', personality: null },
        { name: 'B', classId: 'thief', control: 'human', personality: null },
      ],
    });
    const legal =
      phase === 'awaitRoll'
        ? [{ type: 'roll' as const }]
        : phase === 'shop'
          ? [{ type: 'leave' as const }]
          : phase === 'levelUp'
            ? [{ type: 'pickPerk' as const, perk: 'quickFeet' as const }]
            : [
                {
                  type: 'pvpReward' as const,
                  reward: 'rob' as const,
                  item: null,
                  townId: null,
                  alias: null,
                },
              ];
    if (phase === 'shop') state.phase = { kind: 'shop', stock: [] };
    if (phase === 'levelUp')
      state.phase = { kind: 'levelUp', seat: 0, choices: ['quickFeet'], then: 'endTurn' };
    if (phase === 'pvpReward') state.phase = { kind: 'pvpReward', winner: 0, loser: 1 };
    let dispatched = 0;
    renderHud(
      root,
      state,
      () => {
        dispatched++;
      },
      { legal, presentationBusy: true },
    );
    const buttons = [
      ...root.querySelectorAll<HTMLButtonElement>('[data-action-index], [data-choice]'),
    ];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    buttons.forEach((button) => button.click());
    expect(dispatched).toBe(0);
  },
);
