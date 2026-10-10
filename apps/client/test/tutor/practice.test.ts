import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, legalActions, step, type Action } from '@dice-bandits/engine';
import { createPractice } from '../../src/tutor/practice';
import { TUTORIAL_SCRIPT, type TutorialScript } from '../../src/tutor/script';

const topics = ['roll', 'move', 'fork', 'chest', 'battle', 'shop', 'town', 'steal'];
const saveKey = 'diceBandits.save';
let sentinel: string;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sentinel = `  ${JSON.stringify({ version: 2, state: createGame(TUTORIAL_SCRIPT.config) })}\n`;
  localStorage.setItem(saveKey, sentinel);
  localStorage.setItem('diceBandits.session', 'existing online session');
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

function expectStorage(): void {
  expect(localStorage.getItem(saveKey)).toBe(sentinel);
  expect(localStorage.getItem('diceBandits.session')).toBe('existing online session');
  expect(localStorage.length).toBe(2);
}

async function act(practice: ReturnType<typeof createPractice>, action: Action): Promise<void> {
  const pending = practice.dispatch(action);
  await vi.runAllTimersAsync();
  await pending;
  expectStorage();
}

describe('isolated on-rails practice', () => {
  it('waits for human input and exposes only the legal canonical action', async () => {
    const seen: string[] = [];
    const practice = createPractice(TUTORIAL_SCRIPT, (topic) => seen.push(topic));
    expectStorage();
    const initial = structuredClone(practice.controller.state);
    expect(practice.topic).toBe('roll');
    expect(practice.allowedActions()).toEqual([{ type: 'roll' }]);
    expect(initial.players.map((player) => player.control)).toEqual(['human', 'bot']);
    await vi.runAllTimersAsync();
    expect(practice.controller.state).toEqual(initial);
    expect(seen).toEqual([]);
    practice.destroy();
    expectStorage();
  });

  it('rejects illegal actions, extra payload fields and legal noncanonical choices without mutation', async () => {
    const practice = createPractice(TUTORIAL_SCRIPT, () => undefined);
    const initial = structuredClone(practice.controller.state);
    await act(practice, { type: 'endTurn' });
    await act(practice, { type: 'roll', extra: true } as Action);
    expect(practice.controller.state).toEqual(initial);
    await act(practice, { type: 'roll' });
    expect(practice.topic).toBe('fork');
    expect(practice.allowedActions()).toEqual([{ type: 'roll' }]);
    await act(practice, { type: 'roll' });
    const fork = structuredClone(practice.controller.state);
    expect(practice.allowedActions()).toEqual([{ type: 'chooseBranch', to: 34 }]);
    expect(legalActions(fork, 0)).toContainEqual({ type: 'chooseBranch', to: 11 });
    await act(practice, { type: 'chooseBranch', to: 11 });
    expect(practice.controller.state).toEqual(fork);
    expect(practice.error).toBeNull();
    practice.destroy();
  });

  it('does not expose mutable canonical actions', async () => {
    const practice = createPractice(TUTORIAL_SCRIPT, () => undefined);
    const actions = practice.allowedActions();
    Object.assign(actions[0]!, { type: 'endTurn' });
    expect(practice.allowedActions()).toEqual([{ type: 'roll' }]);
    await act(practice, { type: 'endTurn' });
    expect(practice.controller.state).toEqual(createGame(TUTORIAL_SCRIPT.config));
    practice.destroy();
  });

  it('consumes paired engine milestones once and ignores double clicks during bot pacing', async () => {
    const seen: string[] = [];
    const practice = createPractice(TUTORIAL_SCRIPT, (topic) => seen.push(topic));
    const first = practice.dispatch({ type: 'roll' });
    expect(seen).toEqual(['roll', 'move']);
    expect(practice.allowedActions()).toEqual([]);
    await practice.dispatch({ type: 'roll' });
    await vi.runAllTimersAsync();
    await first;
    expect(seen).toEqual(['roll', 'move']);
    expect(practice.controller.state.round).toBe(2);
    expect(practice.controller.state.phase.kind).toBe('awaitRoll');
    await act(practice, { type: 'roll' });
    await act(practice, { type: 'chooseBranch', to: 34 });
    expect(seen).toEqual(['roll', 'move', 'fork', 'chest']);
    expect(practice.topic).toBe('battle');
    practice.destroy();
  });

  it('replays every real human and bot result, completes eight goals once and stops at robbery', async () => {
    const seen: string[] = [];
    const practice = createPractice(TUTORIAL_SCRIPT, (topic) => {
      seen.push(topic);
      expectStorage();
    });
    let expected = createGame(TUTORIAL_SCRIPT.config);
    let index = 0;
    let humanDecisions = 0;
    while (index < TUTORIAL_SCRIPT.replay.length) {
      const entry = TUTORIAL_SCRIPT.replay[index]!;
      expect(entry.seat).toBe(0);
      expect(practice.controller.state).toEqual(expected);
      expect(practice.allowedActions()).toEqual([entry.action]);
      const pending = practice.dispatch(entry.action);
      expected = step(expected, entry.action).state;
      expect(practice.controller.state).toEqual(expected);
      expectStorage();
      index += 1;
      humanDecisions += 1;
      while (TUTORIAL_SCRIPT.replay[index]?.seat === 1) {
        await vi.advanceTimersByTimeAsync(100);
        expected = step(expected, TUTORIAL_SCRIPT.replay[index]!.action).state;
        expect(practice.controller.state).toEqual(expected);
        expectStorage();
        index += 1;
      }
      await pending;
    }
    expect(humanDecisions).toBe(31);
    expect(seen).toEqual(topics);
    expect(practice.completed).toBe(true);
    expect(practice.error).toBeNull();
    expect(practice.topic).toBe('steal');
    expect(practice.allowedActions()).toEqual([]);
    // Robbery is chosen in round 8; that same engine step performs end-turn
    // bookkeeping and enters round 9. Practice must not play a round-9 action.
    expect(practice.controller.state.round).toBe(9);
    expect(practice.controller.state.stats.robbedGold[0]).toBe(15);
    expect(practice.controller.state.players[0]!.weapon).toBe('crystalWand');
    expect(practice.controller.state.towns.find((town) => town.spaceId === 27)?.owner).toBe(0);
    expect(
      createHash('sha256').update(JSON.stringify(practice.controller.state)).digest('hex'),
    ).toBe('4efe0d322813ce023b0c15c2149bdb040c5b6731f7a3e476ea2b5439245d8caf');
    const finished = structuredClone(practice.controller.state);
    await act(practice, { type: 'roll' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(practice.controller.state).toEqual(finished);
    expect(seen).toEqual(topics);
    practice.restart();
    expect(practice.completed).toBe(false);
    expect(practice.topic).toBe('roll');
    expect(practice.controller.state).toEqual(createGame(TUTORIAL_SCRIPT.config));
    expectStorage();
    await act(practice, { type: 'roll' });
    expect(seen).toEqual([...topics, 'roll', 'move']);
    practice.destroy();
    expectStorage();
  });

  it('stops with an error on a legal but noncanonical bot replay rather than skipping it', async () => {
    const script: TutorialScript = structuredClone(TUTORIAL_SCRIPT);
    script.replay[1]!.action = { type: 'roll' };
    const seen: string[] = [];
    const practice = createPractice(script, (topic) => seen.push(topic));
    await act(practice, { type: 'roll' });
    expect(practice.error?.message).toMatch(/bot.*1/i);
    expect(practice.completed).toBe(false);
    expect(practice.allowedActions()).toEqual([]);
    const failed = structuredClone(practice.controller.state);
    await act(practice, { type: 'roll' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(practice.controller.state).toEqual(failed);
    expect(seen).toEqual(['roll', 'move']);
    practice.restart();
    expect(practice.error).toBeNull();
    expect(practice.topic).toBe('roll');
    practice.destroy();
    expectStorage();
  });

  it('does not complete lessons merely because the cursor passed their configured index', async () => {
    const script: TutorialScript = structuredClone(TUTORIAL_SCRIPT);
    script.lessons[0]!.topic = 'shop';
    const seen: string[] = [];
    const practice = createPractice(script, (topic) => seen.push(topic));
    await act(practice, { type: 'roll' });
    expect(seen).toEqual([]);
    expect(practice.error?.message).toMatch(/milestone/i);
    expect(practice.completed).toBe(false);
    practice.destroy();
    expectStorage();
  });

  it('rejects an illegal canonical payload instead of relying on the engine battlePick exemption', async () => {
    const script: TutorialScript = structuredClone(TUTORIAL_SCRIPT);
    script.replay[0]!.action = { type: 'battlePick', side: 'a', pick: 'secret' };
    const practice = createPractice(script, () => undefined);
    const initial = structuredClone(practice.controller.state);
    expect(practice.allowedActions()).toEqual([]);
    await act(practice, script.replay[0]!.action);
    expect(practice.controller.state).toEqual(initial);
    expect(practice.error).not.toBeNull();
    practice.destroy();
  });

  it('ignores retired callbacks and settles pending dispatch on destroy, including a bot timer', async () => {
    const seen: string[] = [];
    const practice = createPractice(TUTORIAL_SCRIPT, (topic) => seen.push(topic));
    const pending = practice.dispatch({ type: 'roll' });
    practice.destroy();
    await pending;
    const progress = [...seen];
    await vi.runAllTimersAsync();
    expect(seen).toEqual(progress);
    expect(practice.allowedActions()).toEqual([]);
    const retired = structuredClone(practice.controller.state);
    await act(practice, { type: 'roll' });
    practice.restart();
    expect(practice.controller.state).toEqual(retired);
    expectStorage();
  });

  it('restarts during pending bot work without callbacks or state from the old generation', async () => {
    const seen: string[] = [];
    const practice = createPractice(TUTORIAL_SCRIPT, (topic) => seen.push(topic));
    const oldController = practice.controller;
    const pending = practice.dispatch({ type: 'roll' });
    practice.restart();
    await pending;
    expect(practice.controller).not.toBe(oldController);
    expect(practice.topic).toBe('roll');
    await vi.runAllTimersAsync();
    expect(practice.controller.state).toEqual(createGame(TUTORIAL_SCRIPT.config));
    expect(seen).toEqual(['roll', 'move']);
    await act(practice, { type: 'roll' });
    expect(seen).toEqual(['roll', 'move', 'roll', 'move']);
    practice.destroy();
    expectStorage();
  });

  it('settles the old dispatch when a progress callback restarts synchronously', async () => {
    const seen: string[] = [];
    const practice = createPractice(TUTORIAL_SCRIPT, (topic) => {
      seen.push(topic);
      if (seen.length === 1) practice.restart();
    });
    await act(practice, { type: 'roll' });
    expect(seen).toEqual(['roll']);
    expect(practice.topic).toBe('roll');
    expect(practice.controller.state).toEqual(createGame(TUTORIAL_SCRIPT.config));
    await act(practice, { type: 'roll' });
    expect(seen).toEqual(['roll', 'roll', 'move']);
    practice.destroy();
  });

  it('honours destroy from a progress callback before consuming further paired milestones', async () => {
    const seen: string[] = [];
    const practice = createPractice(TUTORIAL_SCRIPT, (topic) => {
      seen.push(topic);
      practice.destroy();
    });
    await act(practice, { type: 'roll' });
    expect(seen).toEqual(['roll']);
    expect(practice.completed).toBe(false);
    expect(practice.allowedActions()).toEqual([]);
  });
});
