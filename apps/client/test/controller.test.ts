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
  it('does not process a second human action while the first event animation is pending', async () => {
    const state = createGame({ ...config, seed: 'review-m4a' });
    let releaseAnimation!: () => void;
    let animationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      animationStarted = resolve;
    });
    const animation = new Promise<void>((resolve) => {
      releaseAnimation = resolve;
    });
    const seen: string[] = [];
    const controller = new GameController({
      state,
      speed: 0,
      onEvents: async (_events, nextState) => {
        seen.push(nextState.phase.kind);
        if (seen.length === 1) {
          animationStarted();
          await animation;
        }
      },
    });
    const first = controller.dispatch(legalActions(state, 0)[0]!);
    await started;
    const actionDuringAnimation = legalActions(controller.state, 0)[0]!;
    expect(actionDuringAnimation).toBeDefined();
    await controller.dispatch(actionDuringAnimation);
    // Fixed map (M5a): the first roll for 'review-m4a' lands on a shop.
    expect(seen).toEqual(['shop']);
    releaseAnimation();
    await first;
    expect(seen).toEqual(['shop']);
  });

  it('runs a human and three bots to game over, autosaving every action', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const phases = new Set<string>(['awaitRoll']);
    const controller = new GameController({
      state: createGame(config),
      speed: 0.01,
      onEvents: async (_events, state) => {
        phases.add(state.phase.kind);
      },
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
    expect(phases).toContain('battle');
    expect(phases).toContain('gameOver');
    expect(actions).toBeLessThan(2000);
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
