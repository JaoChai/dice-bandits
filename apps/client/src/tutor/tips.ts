import type { GameEvent, GameState } from '@dice-bandits/engine';

export const TIP_TOPICS = [
  'roll',
  'fork',
  'castle',
  'town',
  'shop',
  'chest',
  'monster',
  'event',
  'trap',
  'battle',
  'duel',
  'levelUp',
  'townManage',
] as const;
export type TipTopic = (typeof TIP_TOPICS)[number];
export type TipInput = {
  prev: GameState;
  events: GameEvent[];
  next: GameState;
  isLocalHuman: (seat: number) => boolean;
};
export function topicsFor({ events, next, isLocalHuman }: TipInput): TipTopic[] {
  const result: TipTopic[] = [];
  const phase = next.phase;
  const actor = phase.kind === 'levelUp' ? phase.seat : next.turnSeat;
  if (phase.kind === 'battle') {
    if (
      [phase.battle.a, phase.battle.b].some(
        (fighter) =>
          fighter.kind === 'player' && fighter.seat !== null && isLocalHuman(fighter.seat),
      )
    )
      result.push('battle');
  } else if (isLocalHuman(actor)) {
    switch (phase.kind) {
      case 'awaitRoll':
        result.push('roll');
        break;
      case 'chooseBranch':
        result.push('fork');
        break;
      case 'duelOffer':
        result.push('duel');
        break;
      case 'levelUp':
        result.push('levelUp');
        break;
      case 'townManage':
        result.push('townManage');
        break;
    }
  }
  const lastMoves = new Map<number, GameEvent>();
  for (const event of events) {
    if (event.type === 'Moved' && event.seat !== null && isLocalHuman(event.seat))
      lastMoves.set(event.seat, event);
  }
  for (const event of lastMoves.values()) {
    if (event.params.remaining !== 0) continue;
    const space = next.board.spaces.find((space) => space.id === event.params.to);
    if (space) result.push(space.kind);
  }
  return [...new Set(result)];
}

const storageKey = 'dice-bandits:tips';
type Tips = { enabled: boolean; seen: TipTopic[] };
let memory: Tips = { enabled: true, seen: [] };
let memoryOnlyStorage: Storage | undefined;
const isTopic = (topic: string): topic is TipTopic =>
  (TIP_TOPICS as readonly string[]).includes(topic);
const copy = (tips: Tips): Tips => ({ enabled: tips.enabled, seen: [...tips.seen] });
const listeners = new Set<(change: 'enabled' | 'reset') => void>();

export function loadTips(): Tips {
  let raw: string | null;
  try {
    if (localStorage === memoryOnlyStorage) return copy(memory);
    raw = localStorage.getItem(storageKey);
  } catch {
    return copy(memory);
  }
  try {
    const stored: unknown = JSON.parse(raw ?? 'null');
    if (
      stored &&
      typeof stored === 'object' &&
      'enabled' in stored &&
      typeof stored.enabled === 'boolean' &&
      'seen' in stored &&
      Array.isArray(stored.seen) &&
      stored.seen.every((topic) => typeof topic === 'string')
    ) {
      memory = { enabled: stored.enabled, seen: [...new Set(stored.seen.filter(isTopic))] };
    } else memory = { enabled: true, seen: [] };
  } catch {
    memory = { enabled: true, seen: [] };
  }
  return copy(memory);
}
function persist(tips: Tips): void {
  memory = copy(tips);
  let storage: Storage | undefined;
  try {
    storage = localStorage;
    storage.setItem(storageKey, JSON.stringify(tips));
    memoryOnlyStorage = undefined;
  } catch {
    // Do not overwrite in-page changes by re-reading an old value after a quota failure.
    memoryOnlyStorage = storage;
  }
}
export function markSeen(topic: TipTopic): void {
  const tips = loadTips();
  if (!tips.seen.includes(topic)) persist({ ...tips, seen: [...tips.seen, topic] });
}
export function setEnabled(enabled: boolean): void {
  persist({ ...loadTips(), enabled });
  for (const listener of [...listeners]) listener('enabled');
}
export function resetTips(): void {
  persist({ ...loadTips(), seen: [] });
  for (const listener of [...listeners]) listener('reset');
}
/** Menu changes refresh only the view, never the game/controller. */
export function onTipsChange(listener: (change: 'enabled' | 'reset') => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createTipQueue() {
  const pending: TipTopic[] = [];
  let lastHumanTurn: string | null = null;
  let active = false;
  let shown = 0;
  return {
    enqueue(topics: TipTopic[], turn: string | null): void {
      active = turn !== null;
      if (turn !== null && turn !== lastHumanTurn) {
        lastHumanTurn = turn;
        shown = 0;
      }
      const tips = loadTips();
      if (!tips.enabled) {
        pending.length = 0;
        return;
      }
      for (const topic of topics)
        if (!tips.seen.includes(topic) && !pending.includes(topic)) pending.push(topic);
    },
    next(): TipTopic | undefined {
      const tips = loadTips();
      if (!active || !tips.enabled || shown >= 2) return undefined;
      while (pending.length) {
        const topic = pending.shift()!;
        if (tips.seen.includes(topic)) continue;
        shown += 1;
        return topic;
      }
      return undefined;
    },
  };
}
