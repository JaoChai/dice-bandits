import { beforeEach, expect, it, vi } from 'vitest';
import {
  createGame,
  type GameEvent,
  type GameState,
  type Phase,
  type SpaceKind,
} from '@dice-bandits/engine';
import {
  createTipQueue,
  loadTips,
  markSeen,
  resetTips,
  setEnabled,
  topicsFor,
} from '../../src/tutor/tips';

const key = 'dice-bandits:tips';
function state(): GameState {
  return createGame({
    seed: 'dicey',
    rounds: 12,
    seats: [
      { name: 'A', classId: 'knight', control: 'human', personality: null },
      { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' },
    ],
  });
}
function topics(
  next: GameState,
  events: GameEvent[] = [],
  isLocalHuman: (seat: number) => boolean = (seat) => seat === 0,
) {
  return topicsFor({ prev: state(), next, events, isLocalHuman });
}
beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  resetTips();
});

// Breaks caught: wrong phase actor, treating a remote fighter/monster as local,
// traversal mistaken for landing, and using array index rather than space id.
it.each([
  [{ kind: 'awaitRoll' }, 'roll'],
  [{ kind: 'chooseBranch', remaining: 3, options: [2, 3] }, 'fork'],
  [{ kind: 'duelOffer', remaining: 2, targets: [1] }, 'duel'],
  [{ kind: 'levelUp', seat: 0, choices: ['quickFeet'], then: 'endTurn' }, 'levelUp'],
  [{ kind: 'townManage', spaceId: 2 }, 'townManage'],
] as [Phase, string][])('triggers %s for its local human actor', (phase, want) => {
  const next = state();
  next.phase = phase;
  expect(topics(next)).toEqual([want]);
  expect(topics(next, [], () => false)).toEqual([]);
});

it('uses the level-up seat rather than the turn seat', () => {
  const next = state();
  next.turnSeat = 1;
  next.phase = { kind: 'levelUp', seat: 0, choices: [], then: 'endTurn' };
  expect(topics(next)).toEqual(['levelUp']);
  next.turnSeat = 0;
  next.phase.seat = 1;
  expect(topics(next)).toEqual([]);
});

function battle(): GameState {
  const next = state();
  const fighter = {
    kind: 'player' as const,
    seat: 0,
    monsterId: null,
    level: 1,
    hp: 20,
    stats: next.players[0]!.stats,
    secretUsed: false,
    buffs: { ironSkin: false, poison: false, halveNext: false },
  };
  next.phase = {
    kind: 'battle',
    battle: {
      context: 'pvp',
      spaceId: 2,
      a: { ...fighter, seat: 1 },
      b: fighter,
      exchange: 1,
      attackerSide: 'a',
      half: 1,
      pending: { attack: null, defense: null },
    },
  };
  next.turnSeat = 1;
  return next;
}
it('teaches battle to a local defender, not only the turn seat', () => {
  expect(topics(battle())).toEqual(['battle']);
  expect(topics(battle(), [], () => false)).toEqual([]);
});
it('does not treat a monster null seat as a local player', () => {
  const next = battle();
  if (next.phase.kind !== 'battle') throw new Error('fixture');
  next.phase.battle.b = { ...next.phase.battle.b, kind: 'monster', seat: null, monsterId: 'slime' };
  expect(topics(next)).toEqual([]);
});

it.each(['castle', 'town', 'shop', 'chest', 'monster', 'event', 'trap'] as SpaceKind[])(
  'triggers only the final %s landing by id',
  (kind) => {
    const next = state();
    next.phase = { kind: 'endOfTurn' };
    next.board.spaces = [
      { id: 51, kind: 'castle', region: 'meadow', next: [91], x: 0, y: 0 },
      { id: 91, kind, region: 'meadow', next: [51], x: 1, y: 1 },
    ];
    const events: GameEvent[] = [
      { type: 'Moved', seat: 0, params: { to: 51, remaining: 2 } },
      { type: 'Moved', seat: 0, params: { to: 91, remaining: 0 } },
    ];
    expect(topics(next, events)).toEqual([kind]);
    expect(topics(next, events, () => false)).toEqual([]);
  },
);
it('does not teach a space passed on the way to a fork or duel', () => {
  const next = state();
  next.phase = { kind: 'chooseBranch', remaining: 2, options: [3, 4] };
  expect(topics(next, [{ type: 'Moved', seat: 0, params: { to: 0, remaining: 2 } }])).toEqual([
    'fork',
  ]);
});
it('orders phase topics before landing topics without duplicates or state mutation', () => {
  const next = battle();
  next.board.spaces[0]!.kind = 'monster';
  const snapshot = JSON.stringify(next);
  expect(topics(next, [{ type: 'Moved', seat: 0, params: { to: 0, remaining: 0 } }])).toEqual([
    'battle',
    'monster',
  ]);
  expect(JSON.stringify(next)).toBe(snapshot);
});
it('ignores malformed or unknown movement targets', () => {
  const next = state();
  next.phase = { kind: 'endOfTurn' };
  expect(topics(next, [{ type: 'Moved', seat: 0, params: { to: 9999, remaining: 0 } }])).toEqual(
    [],
  );
});

it.each([null, 'broken', '{}', '{"enabled":"yes","seen":[]}', '{"enabled":true,"seen":[2]}'])(
  'defaults safely for absent/corrupt storage %s',
  (value) => {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    expect(loadTips()).toEqual({ enabled: true, seen: [] });
  },
);
it('remembers a dismissed topic once and preserves enabled on reset', () => {
  markSeen('roll');
  markSeen('roll');
  expect(loadTips()).toEqual({ enabled: true, seen: ['roll'] });
  setEnabled(false);
  resetTips();
  expect(loadTips()).toEqual({ enabled: false, seen: [] });
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ enabled: false, seen: [] });
});
it('filters unknown stored topics while keeping valid ones', () => {
  localStorage.setItem(key, '{"enabled":true,"seen":["roll","future","roll"]}');
  expect(loadTips()).toEqual({ enabled: true, seen: ['roll'] });
});
it('survives storage reads and writes throwing and remembers in-page dismissals', () => {
  vi.stubGlobal('localStorage', {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('quota');
    },
  });
  expect(() => markSeen('roll')).not.toThrow();
  expect(loadTips().seen).toEqual(['roll']);
  setEnabled(false);
  expect(loadTips().enabled).toBe(false);
});

it('keeps in-page changes when writes alone fail against an existing stored value', () => {
  localStorage.setItem(key, '{"enabled":true,"seen":[]}');
  const stored = localStorage.getItem(key);
  vi.stubGlobal('localStorage', {
    getItem: () => stored,
    setItem() {
      throw new Error('quota');
    },
  });
  markSeen('roll');
  expect(loadTips().seen).toEqual(['roll']);
  setEnabled(false);
  expect(loadTips()).toEqual({ enabled: false, seen: ['roll'] });
});

it('queues at most two tips per human turn and carries the rest, including across bot turns', () => {
  const queue = createTipQueue();
  queue.enqueue(['roll', 'fork', 'town', 'battle'], '1:0');
  expect(queue.next()).toBe('roll');
  markSeen('roll');
  expect(queue.next()).toBe('fork');
  markSeen('fork');
  expect(queue.next()).toBeUndefined();
  queue.enqueue([], null);
  expect(queue.next()).toBeUndefined();
  queue.enqueue([], '2:0');
  expect(queue.next()).toBe('town');
  markSeen('town');
  expect(queue.next()).toBe('battle');
});
it('deduplicates pending topics and does not repeat seen tips', () => {
  const queue = createTipQueue();
  markSeen('roll');
  queue.enqueue(['roll', 'fork', 'fork'], '1:0');
  expect(queue.next()).toBe('fork');
  markSeen('fork');
  queue.enqueue(['fork'], '1:0');
  expect(queue.next()).toBeUndefined();
});
it('shows nothing when disabled, then permits fresh topics after re-enabling', () => {
  const queue = createTipQueue();
  setEnabled(false);
  queue.enqueue(['roll'], '1:0');
  expect(queue.next()).toBeUndefined();
  setEnabled(true);
  queue.enqueue(['roll'], '1:0');
  expect(queue.next()).toBe('roll');
});
