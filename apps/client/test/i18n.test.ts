import { describe, expect, it } from 'vitest';
import { createGame, data, legalActions, step } from '@dice-bandits/engine';
import { getLang, setLang, t } from '../src/i18n';
import th from '../src/i18n/th.json';
import en from '../src/i18n/en.json';

function observedEventTypes(): Set<string> {
  const state = createGame({
    seed: 'i18n-events',
    rounds: 12,
    seats: [
      { name: 'A', classId: 'knight', control: 'bot', personality: 'greedy' },
      { name: 'B', classId: 'mage', control: 'bot', personality: 'vengeful' },
    ],
  });
  let current = state;
  const eventTypes = new Set<string>();
  for (let i = 0; i < 5000 && current.phase.kind !== 'gameOver'; i += 1) {
    const action = legalActions(current, current.turnSeat)[0];
    if (!action) break;
    const result = step(current, action);
    current = result.state;
    result.events.forEach((event) => eventTypes.add(event.type));
  }
  return eventTypes;
}

describe('i18n', () => {
  it('has matching non-empty Thai and English translations', () => {
    expect(Object.keys(th).sort()).toEqual(Object.keys(en).sort());
    expect(Object.values(th).every((value) => value.trim().length > 0)).toBe(true);
    expect(Object.values(en).every((value) => value.trim().length > 0)).toBe(true);
  });

  it('interpolates named parameters and persists language changes', () => {
    setLang('en');
    expect(t('title.welcome', { name: 'Mali' })).toContain('Mali');
    setLang('th');
    expect(getLang()).toBe('th');
  });

  it('translates all engine data ids and observed engine event types', () => {
    const keys = [
      ...data.ITEMS.map((item) => `item.${item.id}`),
      ...data.PERKS.map((perk) => `perk.${perk.id}`),
      ...Object.keys(data.WORLD_RULES).map((rule) => `worldRule.${rule}`),
      ...data.PRANK_ALIASES,
      ...[...observedEventTypes()].map((type) => `event.${type}`),
    ];
    for (const key of keys) {
      expect(t(key), `Missing translation: ${key}`).not.toBe(key);
    }
  });
});
