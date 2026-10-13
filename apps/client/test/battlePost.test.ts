import { createGame, legalActions, step, type GameState } from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import { renderHud } from '../src/ui/hud';

function game(): GameState {
  return createGame({
    seed: 'post-test',
    rounds: 8,
    seats: [
      { name: 'Winner', classId: 'thief', control: 'human', personality: null },
      { name: 'Loser', classId: 'knight', control: 'human', personality: null },
    ],
  });
}

describe('battle post choice ownership', () => {
  // Break caught: board perk/reward modal duplicates the held battle's choices.
  it.each(['levelUp', 'pvpReward'] as const)(
    'suppresses the board %s modal while battle owns the choice',
    (kind) => {
      const state = game();
      state.phase =
        kind === 'levelUp'
          ? { kind, seat: 0, choices: ['hpUp', 'atkUp', 'looter'], then: 'endTurn' }
          : { kind, winner: 0, loser: 1 };
      const root = document.createElement('div');
      renderHud(root, state, () => {}, { battlePost: true });
      expect(root.querySelector('.dialog-shade')).toBeNull();
      expect(root.querySelector('.action-tray')?.hasAttribute('inert')).toBe(true);
      expect(root.querySelector('.game-shell')?.classList.contains('post-active')).toBe(true);
      renderHud(root, state, () => {});
      expect(root.querySelector('.dialog-shade')).not.toBeNull();
    },
  );
});

describe('engine-derived post-battle rewards', () => {
  // Breaks caught: guessed gold/XP, side-a-only winner, pre-KO robbery math,
  // missing equipped inventory, or a choice not present in the legal list.
  it('uses events for gold/XP and resolves the real winning side without mutating state', async () => {
    const { postResult } = await import('../src/ui/battlePostModel');
    let previous = game();
    previous.phase = { kind: 'duelOffer', remaining: 1, targets: [1] };
    previous = step(previous, { type: 'duel', target: 1 }).state;
    const next = structuredClone(previous);
    next.phase = {
      kind: 'levelUp',
      seat: 1,
      choices: ['hpUp', 'atkUp', 'looter'],
      then: 'endTurn',
    };
    const frozen = JSON.stringify([previous, next]);
    expect(
      postResult(previous, next, [
        { type: 'BattleEnded', seat: 1, params: { result: 'bWin' } },
        { type: 'GoldGained', seat: 1, params: { amount: 32 } },
        { type: 'XpGained', seat: 1, params: { amount: 20 } },
      ]),
    ).toMatchObject({ winner: 'b', seat: 1, gold: 32, xp: 20, pending: true });
    expect(postResult(previous, next, [])).toBeNull();
    expect(JSON.stringify([previous, next])).toBe(frozen);
  });
  it.each([false, true])(
    'shows post-KO rob amount, equipped items, owned towns and every legal prank (looter=%s)',
    async (looter) => {
      const { postChoices } = await import('../src/ui/battlePostModel');
      const state = game();
      state.phase = { kind: 'pvpReward', winner: 0, loser: 1 };
      state.players[1]!.gold = 241;
      state.players[1]!.items = ['steelSword', 'potion', 'mapScroll'];
      state.players[1]!.weapon = 'steelSword';
      state.towns[0]!.owner = 1;
      if (looter) state.players[0]!.perks.push('looter');
      const choices = postChoices(state);
      expect(choices.map((choice) => choice.action)).toEqual(legalActions(state, 0));
      expect(choices[0]?.amount).toBe(looter ? 96 : 72);
      expect(
        choices.find(
          (choice) => choice.action.type === 'pvpReward' && choice.action.item === 'steelSword',
        ),
      ).toMatchObject({ icon: 'sword', equipped: true });
      expect(
        choices.find(
          (choice) => choice.action.type === 'pvpReward' && choice.action.item === 'potion',
        ),
      ).toMatchObject({ icon: 'heart', equipped: false });
    },
  );
});
