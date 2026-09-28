import {
  chooseAction,
  createGame,
  data,
  legalActions,
  step,
  type GameConfig,
  type GameState,
} from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import { needsPassScreen } from '../src/ui/passDevice';
import { buildResultsModel } from '../src/ui/results';

function battleState(controls: Array<'human' | 'bot'>): GameState {
  const state = createGame({
    seed: `task12-${controls.join('-')}`,
    rounds: 12,
    seats: controls.map((control, seat) => ({
      name: `Seat ${seat + 1}`,
      classId: seat === 0 ? 'knight' : 'thief',
      control,
      personality: control === 'bot' ? 'greedy' : null,
    })),
  } satisfies GameConfig);
  state.phase = { kind: 'duelOffer', remaining: 1, targets: [1] };
  state.turnSeat = 0;
  return step(state, { type: 'duel', target: 1 }).state;
}

function finishedBotGame(): GameState {
  let state = createGame({
    seed: 'task12-results',
    rounds: 12,
    seats: [0, 1, 2].map((seat) => ({
      name: `Bot ${seat + 1}`,
      classId: (['knight', 'thief', 'mage'] as const)[seat]!,
      control: 'bot' as const,
      personality: 'greedy' as const,
    })),
  });
  for (let turn = 0; turn < 2000 && state.phase.kind !== 'gameOver'; turn += 1) {
    const actor = state.players.find((player) => legalActions(state, player.seat).length > 0)?.seat;
    if (actor === undefined) throw new Error(`no legal actor in ${state.phase.kind}`);
    const action = chooseAction(state, actor);
    state = step(state, action).state;
  }
  expect(state.phase.kind).toBe('gameOver');
  return state;
}

describe('pass-device and results models', () => {
  it('shows the pass screen for either human side in a real PvP battle only', () => {
    const pvp = battleState(['human', 'human']);
    const mixed = battleState(['human', 'bot']);
    expect(pvp.phase.kind).toBe('battle');
    expect(mixed.phase.kind).toBe('battle');
    expect(needsPassScreen(pvp, 'a')).toBe(true);
    expect(needsPassScreen(pvp, 'b')).toBe(true);
    expect(needsPassScreen(mixed, 'a')).toBe(false);
    expect(needsPassScreen(mixed, 'b')).toBe(false);
  });

  it('lists every seat by final ranking and exposes all three engine highlights', () => {
    const state = finishedBotGame();
    if (state.phase.kind !== 'gameOver') throw new Error('expected finished game');
    state.players[0]!.items = ['potion'];
    const results = buildResultsModel(state);
    const itemRow = results.rows.find((row) => row.seat === 0)!;
    const townWorth = state.towns
      .filter((town) => town.owner === 0)
      .reduce((sum, town) => sum + town.value, 0);
    const itemWorth = Math.floor(data.ITEM_BY_ID.potion!.price * data.BALANCE.resaleRatio);
    expect(itemRow.netWorth).toBe(state.players[0]!.gold + townWorth + itemWorth);
    expect(results.rows.map((row) => row.seat)).toEqual(state.phase.ranking);
    expect(results.rows).toHaveLength(state.players.length);
    expect(results.highlights.map((highlight) => highlight.key)).toEqual([
      'biggestRobbery',
      'mostKod',
      'hotTown',
    ]);
  });
});
