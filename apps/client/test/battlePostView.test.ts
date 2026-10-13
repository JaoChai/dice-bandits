import { createGame, legalActions, type Action } from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import { createBattlePost } from '../src/ui/battlePost';

const make = () =>
  createGame({
    seed: 'post-view',
    rounds: 8,
    seats: [
      { name: 'Ada', classId: 'thief', control: 'human', personality: null },
      { name: 'Ben', classId: 'knight', control: 'human', personality: null },
    ],
  });

describe('post-battle choice view', () => {
  // Breaks caught: automatic human picks, duplicate dispatch, lost legal action
  // identity, actionable loser cards, and leaked DOM after exit.
  it('waits for a human, dispatches the offered perk once, and destroys all owned UI', async () => {
    const state = make();
    state.phase = {
      kind: 'levelUp',
      seat: 0,
      choices: ['hpUp', 'atkUp', 'looter'],
      then: 'endTurn',
    };
    const root = document.createElement('div');
    document.body.append(root);
    const view = createBattlePost(root);
    const sent: Action[] = [];
    view.mountChoices(state, { viewer: 0, dispatch: (action) => sent.push(action), reduced: true });
    expect(root.querySelectorAll('[data-post-choice]')).toHaveLength(3);
    expect(sent).toEqual([]);
    const button = root.querySelector<HTMLButtonElement>('[data-testid="perk-atkUp"]')!;
    button.click();
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual([{ type: 'pickPerk', perk: 'atkUp' }]);
    view.destroy();
    expect(root.querySelector('[data-testid="battle-post"]')).toBeNull();
    root.remove();
  });
  it('shows every item, town and prank in a read-only loser view without any dispatch', () => {
    const state = make();
    state.phase = { kind: 'pvpReward', winner: 0, loser: 1 };
    state.players[1]!.items = ['steelSword', 'potion'];
    state.players[1]!.weapon = 'steelSword';
    state.towns[0]!.owner = 1;
    const root = document.createElement('div');
    const view = createBattlePost(root);
    const sent: Action[] = [];
    view.mountChoices(state, { viewer: 1, dispatch: (action) => sent.push(action), reduced: true });
    expect(root.querySelectorAll('[data-post-choice]')).toHaveLength(legalActions(state, 0).length);
    expect(root.querySelector('[data-testid="post-waiting"]')?.textContent).toContain('Ada');
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-post-choice]')) {
      expect(button.tagName).toBe('DIV');
      expect(button.hasAttribute('tabindex')).toBe(false);
      button.click();
    }
    expect(sent).toEqual([]);
    expect(root.querySelector('[data-equipped="true"]')).not.toBeNull();
    view.destroy();
  });
});
