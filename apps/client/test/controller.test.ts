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

describe('fixed bot pacing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function checkFirstBotBoundary(speed: number, milliseconds: number): Promise<void> {
    vi.useFakeTimers();
    const state = createGame(config);
    state.phase = { kind: 'endOfTurn' };
    const seen: number[] = [];
    let release!: () => void;
    const presentation = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new GameController({
      state,
      speed,
      onEvents: async (_events, nextState) => {
        seen.push(nextState.turnSeat);
        expect(loadGame()).toEqual(nextState);
        if (seen.length === 2) await presentation;
      },
    });
    const dispatch = controller.dispatch({ type: 'endTurn' });
    try {
      await vi.advanceTimersByTimeAsync(milliseconds - 1);
      expect(seen).toEqual([1]);
      await vi.advanceTimersByTimeAsync(1);
      expect(seen).toEqual([1, 1]);
    } finally {
      release();
      await vi.runAllTimersAsync();
      await dispatch;
    }
  }

  it('waits exactly 100ms before a bot action at speed 1', async () => {
    await checkFirstBotBoundary(1, 100);
  });

  it.each([
    [0.5, 50],
    [2, 200],
  ])('scales the fixed bot pause at speed %s (%s ms)', async (speed, milliseconds) => {
    await checkFirstBotBoundary(speed, milliseconds);
  });

  it('awaits bot presentation before scheduling the next fixed pause', async () => {
    vi.useFakeTimers();
    const state = createGame(config);
    state.phase = { kind: 'endOfTurn' };
    const writes = vi.spyOn(localStorage, 'setItem');
    const seen: string[] = [];
    let release!: () => void;
    const presentation = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new GameController({
      state,
      speed: 1,
      onEvents: async (_events, nextState) => {
        seen.push(nextState.phase.kind);
        expect(loadGame()).toEqual(nextState);
        expect(writes).toHaveBeenCalledTimes(seen.length + 1);
        if (seen.length === 2) await presentation;
      },
    });
    const dispatch = controller.dispatch({ type: 'endTurn' });
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(seen).toHaveLength(2);
      const committed = structuredClone(controller.state);
      await vi.advanceTimersByTimeAsync(1000);
      expect(seen).toHaveLength(2);
      expect(controller.state).toEqual(committed);
      expect(writes).toHaveBeenCalledTimes(3);
      release();
      await vi.advanceTimersByTimeAsync(99);
      expect(seen).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(seen).toHaveLength(3);
      expect(controller.state).not.toEqual(committed);
    } finally {
      release();
      await vi.runAllTimersAsync();
      await dispatch;
    }
  });

  it('ignores human dispatch while a bot presentation is pending', async () => {
    vi.useFakeTimers();
    const state = createGame(config);
    state.phase = { kind: 'endOfTurn' };
    const writes = vi.spyOn(localStorage, 'setItem');
    let callbacks = 0;
    let release!: () => void;
    const presentation = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new GameController({
      state,
      speed: 1,
      onEvents: async () => {
        callbacks += 1;
        if (callbacks === 2) await presentation;
      },
    });
    const dispatch = controller.dispatch({ type: 'endTurn' });
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(callbacks).toBe(2);
      const committed = structuredClone(controller.state);
      const legal = legalActions(controller.state, controller.state.turnSeat)[0]!;
      expect(legal).toBeDefined();
      await controller.dispatch(legal);
      await vi.advanceTimersByTimeAsync(1000);
      expect(controller.state).toEqual(committed);
      expect(loadGame()).toEqual(committed);
      expect(callbacks).toBe(2);
      expect(writes).toHaveBeenCalledTimes(3);
    } finally {
      release();
      await vi.runAllTimersAsync();
      await dispatch;
    }
  });

  it('preserves the seeded journey and every saved state at fixed, zero and negative speeds', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const journeys: string[][] = [];
    for (const speed of [0, 1, -1]) {
      const journey: string[] = [];
      const controller = new GameController({
        state: createGame(config),
        speed,
        onEvents: async (events, nextState) => {
          expect(loadGame()).toEqual(nextState);
          journey.push(JSON.stringify({ events, state: nextState }));
        },
      });
      let actions = 0;
      while (controller.state.phase.kind !== 'gameOver' && actions < 2000) {
        expect(controller.isHumanTurn()).toBe(true);
        const { seat } = controller.pendingHumanSides()[0]!;
        const dispatch = controller.dispatch(legalActions(controller.state, seat)[0]!);
        await vi.runAllTimersAsync();
        await dispatch;
        expect(loadGame()).toEqual(controller.state);
        actions += 1;
      }
      expect(controller.state.phase.kind).toBe('gameOver');
      expect(actions).toBeLessThan(2000);
      expect(journey.length).toBeGreaterThan(actions);
      journeys.push(journey);
    }
    expect(journeys[1]).toEqual(journeys[0]);
    expect(journeys[2]).toEqual(journeys[0]);
    expect(errors).not.toHaveBeenCalled();
  });
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
