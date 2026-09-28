import { describe, expect, it } from 'vitest';
import { createGame } from '../src/index';
import { grantXp, pickPerk } from '../src/rules/leveling';
import { CLASSES } from '../src/data/index';
import type { GameConfig } from '../src/types';
const config: GameConfig = {
  seed: 'level6',
  rounds: 12,
  seats: [
    { name: 'A', classId: 'knight', control: 'human', personality: null },
    { name: 'B', classId: 'mage', control: 'bot', personality: 'greedy' },
  ],
};

describe('Task 6 leveling', () => {
  it('offers three distinct random perks, advances RNG, grows class stats, and fully heals', () => {
    const s = createGame(config);
    s.players[0]!.hp = 1;
    const rng = s.rng;
    const result = grantXp(s, 0, 30);
    expect(result.state.rng).not.toEqual(rng);
    expect(result.state.phase.kind).toBe('levelUp');
    const phase = result.state.phase;
    if (phase.kind !== 'levelUp') throw new Error('expected levelUp');
    expect(new Set(phase.choices).size).toBe(3);
    expect(result.state.players[0]!.level).toBe(2);
    expect(result.state.players[0]!.stats.atk).toBe(
      CLASSES.knight.base.atk + CLASSES.knight.growth.atk,
    );
    expect(result.state.players[0]!.hp).toBe(result.state.players[0]!.stats.maxHp);
  });

  it('applies the selected stat perk and exits level-up to end-of-turn', () => {
    const s = createGame(config);
    const atk = s.players[0]!.stats.atk;
    s.phase = { kind: 'levelUp', seat: 0, choices: ['atkUp', 'taxman', 'looter'], then: 'endTurn' };
    const chosen = pickPerk(s, 0, 'atkUp');
    expect(chosen.state.players[0]!.stats.atk).toBe(atk + 3);
    expect(chosen.state.players[0]!.perks).toContain('atkUp');
    expect(chosen.state.phase.kind).toBe('endOfTurn');
  });

  it('does not level beyond the balance cap', () => {
    const s = createGame(config);
    s.players[0]!.level = 15;
    s.players[0]!.xp = 5000;
    const result = grantXp(s, 0, 5000);
    expect(result.state.phase.kind).not.toBe('levelUp');
    expect(result.state.players[0]!.level).toBe(15);
  });
});
