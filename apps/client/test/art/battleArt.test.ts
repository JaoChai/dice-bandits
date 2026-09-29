import { createGame } from '@dice-bandits/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { battleRegion } from '../../src/scenes/battle/backdrop';
import { drawFighters, fighterKey } from '../../src/scenes/battle/fighters';
import { battleLayout } from '../../src/scenes/battle/layout';

const state = createGame({
  seed: 'battle-art',
  rounds: 12,
  seats: [
    { name: 'Hero', classId: 'knight', control: 'human', personality: null },
    { name: 'Other', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
});

describe('battle art selection', () => {
  it('uses the battle space region rather than the current turn position', () => {
    const space = state.board.spaces.find((item) => item.region === 'desert')!;
    expect(battleRegion(state, space.id)).toBe('backdrop-desert');
  });
  it('selects class and monster atlases for opposing fighters', () => {
    expect(fighterKey(state, { kind: 'player', seat: 0, monsterId: null })).toBe('hero-knight');
    expect(fighterKey(state, { kind: 'monster', seat: null, monsterId: 'mimic' })).toBe(
      'monster-mimic',
    );
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('battle fighter motion', () => {
  it('does not start idle loops when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const sprite = {
      setOrigin: vi.fn(),
      setScale: vi.fn(),
      setFlipX: vi.fn(),
      setDepth: vi.fn(),
      play: vi.fn(),
    };
    for (const key of ['setOrigin', 'setScale', 'setFlipX', 'setDepth'] as const)
      sprite[key].mockReturnValue(sprite);
    const scene = {
      textures: { get: () => ({ has: () => true }) },
      anims: { exists: () => true },
      add: { sprite: vi.fn(() => sprite) },
    };
    const battle = structuredClone(state);
    const player = battle.players[0]!;
    battle.phase = {
      kind: 'battle',
      battle: {
        context: 'pvp',
        spaceId: player.pos,
        exchange: 1,
        half: 1,
        attackerSide: 'a',
        pending: { attack: null, defense: null },
        a: {
          kind: 'player',
          seat: 0,
          monsterId: null,
          level: 1,
          hp: player.hp,
          stats: player.stats,
          secretUsed: false,
          buffs: { ironSkin: false, poison: false, halveNext: false },
        },
        b: {
          kind: 'player',
          seat: 1,
          monsterId: null,
          level: 1,
          hp: player.hp,
          stats: player.stats,
          secretUsed: false,
          buffs: { ironSkin: false, poison: false, halveNext: false },
        },
      },
    };
    drawFighters(scene as never, battle, battleLayout());
    expect(sprite.play).not.toHaveBeenCalled();
  });
});
