import { describe, expect, it } from 'vitest';
import { damageTargets } from '../../src/scenes/battle/effects';

describe('battle effects', () => {
  it('maps counter damage to the attacker and hit damage to the defender', () => {
    expect(
      damageTargets(
        { attacker: 0, defender: 'cactusPunch', toAttacker: 2, toDefender: 7 },
        0,
        'cactusPunch',
      ),
    ).toEqual([
      { side: 'a', amount: 2 },
      { side: 'b', amount: 7 },
    ]);
  });
  it('reverses the visual sides when the defender attacks next', () => {
    expect(
      damageTargets(
        { attacker: 'cactusPunch', defender: 0, toAttacker: 0, toDefender: 4 },
        0,
        'cactusPunch',
      ),
    ).toEqual([{ side: 'a', amount: 4 }]);
  });
});
