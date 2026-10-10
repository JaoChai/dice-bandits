import {
  chooseAction,
  createGame,
  legalActions,
  step,
  type Action,
  type GameEvent,
  type GameState,
} from '@dice-bandits/engine';
import { GameController } from '../controller';
import type { TutorialScript } from './script';

type Topic = TutorialScript['lessons'][number]['topic'];

export interface PracticeSession {
  readonly controller: GameController;
  readonly topic: Topic;
  readonly completed: boolean;
  readonly error: Error | null;
  allowedActions(): Action[];
  dispatch(action: Action): Promise<void>;
  restart(): void;
  destroy(): void;
}

/** A local, disposable session; no saved-game or room/session lifecycle. */
export function createPractice(
  input: TutorialScript,
  onProgress: (topic: Topic) => void,
): PracticeSession {
  const script: TutorialScript = structuredClone(input);
  let controller: GameController;
  let cursor = 0;
  let lessonIndex = 0;
  let completed = false;
  let error: Error | null = null;
  let destroyed = false;
  let busy = false;
  let generation = 0;
  let stopped: Promise<void>;
  let stop: () => void;

  function fail(reason: unknown): void {
    error = reason instanceof Error ? reason : new Error(String(reason));
    stop();
  }

  function start(): void {
    const ownGeneration = ++generation;
    cursor = 0;
    lessonIndex = 0;
    completed = false;
    error = null;
    busy = false;
    stopped = new Promise<void>((resolve) => {
      stop = resolve;
    });
    const isCurrent = (): boolean => !destroyed && ownGeneration === generation;
    // Never reject a bot onEvents callback: the normal controller catches it and
    // continues. Park at its existing presentation boundary instead. The stop
    // signal settles public dispatch promises without releasing retired bots.
    const parked = new Promise<void>(() => undefined);
    let before = createGame(script.config);
    controller = new GameController({
      state: before,
      speed: 1,
      persist: false,
      onEvents: async (events, state) => {
        if (!isCurrent() || error || completed) return parked;
        try {
          const entry = script.replay[cursor];
          if (
            !entry ||
            !legalActions(before, entry.seat).some((a) => sameAction(a, entry.action))
          ) {
            throw new Error(`Illegal practice replay at ${cursor}`);
          }
          const human = before.players[entry.seat]?.control === 'human';
          if (!human && !sameAction(chooseAction(before, entry.seat), entry.action)) {
            throw new Error(`Bot policy diverged at replay ${cursor}`);
          }
          // An oracle only: the state being played is always the controller's
          // real result. Never assign the expected result into the controller.
          const expected = step(before, entry.action);
          if (
            JSON.stringify(state) !== JSON.stringify(expected.state) ||
            JSON.stringify(events) !== JSON.stringify(expected.events)
          ) {
            throw new Error(`Practice result diverged at replay ${cursor}`);
          }
          for (const event of events) {
            const lesson = script.lessons[lessonIndex];
            if (!lesson || lesson.replayIndex !== cursor) continue;
            if (
              !human ||
              lesson.beforePhase !== before.phase.kind ||
              !sameAction(lesson.suggested, entry.action)
            ) {
              throw new Error(`Invalid lesson milestone at replay ${cursor}`);
            }
            if (!isMilestone(lesson.topic, event, events, before, state, entry)) continue;
            if (
              script.lessons.slice(0, lessonIndex).some((prior) => prior.topic === lesson.topic)
            ) {
              throw new Error(`Duplicate lesson milestone: ${lesson.topic}`);
            }
            lessonIndex += 1;
            onProgress(lesson.topic);
            if (!isCurrent()) return parked;
          }
          if (
            script.lessons[lessonIndex]?.replayIndex !== undefined &&
            script.lessons[lessonIndex]!.replayIndex <= cursor
          ) {
            throw new Error(`Missing lesson milestone at replay ${cursor}`);
          }
          cursor += 1;
          before = state;
          if (lessonIndex === script.lessons.length) {
            completed = true;
            stop();
            return parked;
          }
          if (cursor === script.replay.length) {
            throw new Error('Replay ended before the final lesson milestone');
          }
        } catch (reason) {
          if (isCurrent()) fail(reason);
          return parked;
        }
      },
    });
  }

  function allowedActions(): Action[] {
    if (destroyed || completed || error || busy) return [];
    const entry = script.replay[cursor];
    if (!entry || controller.state.players[entry.seat]?.control !== 'human') {
      fail(new Error(`Expected human input at replay ${cursor}`));
      return [];
    }
    const legal = legalActions(controller.state, entry.seat);
    if (!legal.some((action) => sameAction(action, entry.action))) {
      fail(new Error(`Illegal canonical action at replay ${cursor}`));
      return [];
    }
    return [structuredClone(entry.action)];
  }

  start();
  return {
    get controller() {
      return controller;
    },
    get topic() {
      return script.lessons[Math.min(lessonIndex, script.lessons.length - 1)]!.topic;
    },
    get completed() {
      return completed;
    },
    get error() {
      return error;
    },
    allowedActions,
    async dispatch(action) {
      if (!allowedActions().some((allowed) => sameAction(allowed, action))) return;
      busy = true;
      const ownGeneration = generation;
      const index = cursor;
      const ownController = controller;
      const ownStopped = stopped;
      try {
        await Promise.race([ownController.dispatch(action), ownStopped]);
        if (
          ownGeneration === generation &&
          !destroyed &&
          !error &&
          !completed &&
          cursor === index
        ) {
          fail(new Error(`Practice action did not produce a result at replay ${index}`));
        }
      } catch (reason) {
        if (ownGeneration === generation && !destroyed) fail(reason);
      } finally {
        if (ownGeneration === generation) busy = false;
      }
    },
    restart() {
      if (destroyed) return;
      stop();
      start();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      stop();
    },
  };
}

function sameAction(a: Action, b: Action): boolean {
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([key, value]) => b[key as keyof Action] === value)
  );
}

function isMilestone(
  topic: Topic,
  event: GameEvent,
  events: GameEvent[],
  before: GameState,
  after: GameState,
  entry: TutorialScript['replay'][number],
): boolean {
  if (event.seat !== entry.seat) return false;
  switch (topic) {
    case 'roll':
      return event.type === 'DiceRolled';
    case 'move':
      return event.type === 'Moved';
    case 'fork':
      return entry.action.type === 'chooseBranch' && event.type === 'BranchChosen';
    case 'chest':
      return (
        after.board.spaces[after.players[entry.seat]!.pos]?.kind === 'chest' &&
        events.some((e) => e.type === 'Moved' && e.seat === entry.seat) &&
        (event.type === 'GoldGained' || event.type === 'ItemFound')
      );
    case 'battle':
      return (
        before.phase.kind === 'battle' &&
        entry.action.type === 'battlePick' &&
        event.type === 'BattlePick'
      );
    case 'shop':
      return before.phase.kind === 'shop' && event.type === 'ItemBought';
    case 'town':
      return event.type === 'TownClaimed';
    case 'steal':
      return (
        entry.action.type === 'pvpReward' &&
        entry.action.reward === 'rob' &&
        event.type === 'GoldStolen' &&
        Number(event.params.amount) > 0
      );
  }
}
