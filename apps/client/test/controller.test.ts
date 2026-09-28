import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame, legalActions, type GameConfig } from '@dice-bandits/engine';
import { clearSave, loadGame } from '../src/save';
import { GameController } from '../src/controller';

const config: GameConfig = {
  seed: 'controller-test',
  rounds: 12,
  seats: [
    { name: 'Human', classId: 'knight', control: 'human', personality: null },
    { name: 'Greedy', classId: 'thief', control: 'bot', personality: 'greedy' },
    { name: 'Vengeful', classId: 'mage', control: 'bot', personality: 'vengeful' },
    { name: 'Cowardly', classId: 'cleric', control: 'bot', personality: 'cowardly' },
  ],
};

afterEach(() => {
  clearSave();
  vi.restoreAllMocks();
});

describe('GameController', () => {
  it('runs a human and three bots to game over, autosaving every action', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const controller = new GameController({
      state: createGame(config),
      speed: 0,
      onEvents: async () => undefined,
    });
    let actions = 0;

    while (controller.state.phase.kind !== 'gameOver' && actions < 2000) {
      if (controller.isHumanTurn()) {
        const { seat } = controller.pendingHumanSides()[0]!;
        await controller.dispatch(legalActions(controller.state, seat)[0]!);
      } else {
        await Promise.resolve();
      }
      expect(loadGame()).toEqual(controller.state);
      actions += 1;
    }

    expect(controller.state.phase.kind).toBe('gameOver');
    expect(actions).toBeLessThan(2000);
    expect(errors).not.toHaveBeenCalled();
  });

  it('runs the phase seat bot when a level-up is for a seat other than turnSeat', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = createGame(config);
    state.phase = {
      kind: 'levelUp',
      seat: 2,
      choices: ['hpUp', 'atkUp'],
      then: 'continue',
    };
    const controller = new GameController({ state, speed: 0, onEvents: async () => undefined });

    await (controller as unknown as { runBotsIfNeeded: () => Promise<void> }).runBotsIfNeeded();

    expect(controller.state.players[2]!.perks).toHaveLength(1);
    expect(controller.state.phase.kind).toBe('awaitRoll');
    expect(errors).not.toHaveBeenCalled();
  });

  it('logs an illegal action without changing state', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = createGame(config);
    const controller = new GameController({ state, speed: 0, onEvents: async () => undefined });

    await controller.dispatch({ type: 'endTurn' });

    expect(controller.state).toEqual(state);
    expect(loadGame()).toEqual(state);
    expect(errors).toHaveBeenCalledOnce();
  });
});
