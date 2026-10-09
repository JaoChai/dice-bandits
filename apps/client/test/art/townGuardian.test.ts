import { createGame, data, step } from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import { ART } from '../../src/art/manifest';
import { fighterAtlas } from '../../src/scenes/battle/fighters';

const state = createGame({
  seed: 'town-guardian-art',
  rounds: 12,
  seats: [
    { name: 'Hero', classId: 'knight', control: 'human', personality: null },
    { name: 'Owner', classId: 'thief', control: 'human', personality: null },
  ],
});
const town = state.towns[0]!;
town.owner = 1;
state.players[0]!.pos = town.spaceId;
state.phase = { kind: 'townChallenge', spaceId: town.spaceId };
const battle = step(state, { type: 'attackTown' }).state;
if (battle.phase.kind !== 'battle') throw new Error('engine must create town battle');
const guardian = battle.phase.battle.b;

// Removing the townGuardian alias must break both guardian and roster coverage.
describe('engine monster battle art', () => {
  it('uses penguinKnight art for the actual engine town guardian', () => {
    expect(guardian.monsterId).toBe('townGuardian');
    expect(fighterAtlas(battle, guardian)).toBe(ART.monsters.penguinKnight);
  });

  it.each([...Object.keys(data.MONSTERS), guardian.monsterId!])(
    'gives engine monster %s a real atlas rather than icons',
    (monsterId) => {
      const atlas = fighterAtlas(battle, { kind: 'monster', seat: null, monsterId });
      expect(Object.values(ART.monsters)).toContain(atlas);
      expect(atlas).not.toBe(ART.icons);
      if (monsterId in ART.monsters)
        expect(atlas).toBe(ART.monsters[monsterId as keyof typeof ART.monsters]);
    },
  );

  it('retains the icons fallback for truly unknown monster ids', () => {
    expect(
      fighterAtlas(battle, { kind: 'monster', seat: null, monsterId: 'unknown-monster' }),
    ).toBe(ART.icons);
  });
});
