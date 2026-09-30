import type { GameEvent, GameState } from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import { EVENT_SFX, SFX_IDS, musicForState, sfxForEvents } from '../../src/audio/events';

const event = (type: string): GameEvent => ({ type, seat: null, params: {} });

const mappings = [
  ['DiceRolled', 'dice'],
  ['Moved', 'step'],
  ['BattleStarted', 'battleStart'],
  ['DamageDealt', 'hit'],
  ['PlayerKO', 'ko'],
  ['GoldGained', 'coin'],
  ['BountyClaimed', 'coin'],
  ['GoldStolen', 'stolen'],
  ['LevelUp', 'levelUp'],
  ['ItemBought', 'item'],
  ['ItemUsed', 'item'],
  ['TownClaimed', 'town'],
  ['TownFlipped', 'town'],
  ['GameEnded', 'win'],
] as const;

describe('sfxForEvents', () => {
  it.each(mappings)('maps %s to %s', (type, sound) => {
    expect(sfxForEvents([event(type)])).toEqual([sound]);
    expect(EVENT_SFX[type]).toBe(sound);
  });

  it('ignores unmapped event types', () => {
    expect(sfxForEvents([event('TurnEnded')])).toEqual([]);
  });

  it('deduplicates sounds in their first-appearance order', () => {
    expect(
      sfxForEvents([
        event('DiceRolled'),
        event('Moved'),
        event('Moved'),
        event('DamageDealt'),
        event('DamageDealt'),
      ]),
    ).toEqual(['dice', 'step', 'hit']);
  });

  it('deduplicates different events that share the same sound', () => {
    expect(sfxForEvents([event('BountyClaimed'), event('GoldGained')])).toEqual(['coin']);
  });

  it('exposes the twelve sound effect ids, including the UI click', () => {
    expect(SFX_IDS).toEqual([
      'click',
      'dice',
      'step',
      'battleStart',
      'hit',
      'ko',
      'coin',
      'stolen',
      'levelUp',
      'item',
      'town',
      'win',
    ]);
    expect(SFX_IDS).toHaveLength(12);
  });
});

describe('musicForState', () => {
  it('uses battle music during a battle', () => {
    expect(musicForState({ phase: { kind: 'battle' } as GameState['phase'] })).toBe('battle');
  });

  const boardPhases: GameState['phase'][] = [
    { kind: 'awaitRoll' },
    { kind: 'shop', stock: [] },
    { kind: 'gameOver', ranking: [], winners: [], highlights: [] },
  ];
  it.each(boardPhases)('uses board music during %s', (phase) => {
    expect(musicForState({ phase })).toBe('board');
  });
});
