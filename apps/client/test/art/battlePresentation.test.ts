import { createGame, type Combatant, type GameEvent, type GameState } from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import { planBattle, type BattleBeat } from '../../src/scenes/battle/presentation';

function fixture(monster = true): GameState {
  const state = createGame({
    seed: 'battle-plan',
    rounds: 12,
    seats: [
      { name: 'Hero', classId: 'knight', control: 'human', personality: null },
      { name: 'Other', classId: 'cleric', control: 'human', personality: null },
    ],
  });
  for (const player of state.players) {
    player.hp = 30;
    player.stats = { atk: 12, def: 4, spd: 6, mag: 5, maxHp: 40 };
  }
  const fighter = (seat: number): Combatant => ({
    kind: 'player',
    seat,
    monsterId: null,
    level: 1,
    hp: 30,
    stats: { atk: 12, def: 4, spd: 6, mag: 5, maxHp: 40 },
    secretUsed: false,
    buffs: { ironSkin: false, poison: false, halveNext: false },
  });
  state.phase = {
    kind: 'battle',
    battle: {
      context: monster ? 'monster' : 'pvp',
      spaceId: 1,
      a: fighter(0),
      b: monster
        ? { ...fighter(1), kind: 'monster', seat: null, monsterId: 'jellyBun' }
        : fighter(1),
      exchange: 1,
      half: 1,
      attackerSide: 'a',
      pending: { attack: null, defense: null },
    },
  };
  return state;
}

function battle(state: GameState) {
  if (state.phase.kind !== 'battle') throw new Error('fixture must be a battle');
  return state.phase.battle;
}

function event(type: string, params: GameEvent['params'], seat: number | null = null): GameEvent {
  return { type, seat, params };
}

function hit(
  attacker: string | number = 0,
  defender: string | number = 'jellyBun',
  toDefender = 7,
  toAttacker = 0,
) {
  return event('DamageDealt', { attacker, defender, toAttacker, toDefender, exchange: 1, half: 1 });
}

function after(previous: GameState, aHp = 30, bHp = 23): GameState {
  const next = structuredClone(previous);
  Object.assign(battle(next).a, { hp: aHp });
  Object.assign(battle(next).b, { hp: bHp });
  Object.assign(battle(next), { half: 2, attackerSide: 'b' });
  return next;
}

function beat(plan: BattleBeat[], kind: BattleBeat['kind']) {
  const found = plan.find((value) => value.kind === kind);
  expect(found, `missing ${kind} beat`).toBeDefined();
  return found!;
}

// Mutations caught: a-always-attacks, swapped recipients, HP-delta-as-damage,
// duplicate consequence waits, premature victory/secret reveal, and budget overruns.
describe('pure battle presentation', () => {
  it('plans one ordered human exchange with the approved 2220ms budget', () => {
    const previous = fixture();
    const plan = planBattle(previous, after(previous), [hit()], 'human', false);
    expect(plan.map(({ kind, duration }) => [kind, duration])).toEqual([
      ['reveal', 240],
      ['anticipation', 220],
      ['lunge', 160],
      ['impact', 100],
      ['damage', 500],
      ['drain', 350],
      ['result', 650],
    ]);
    expect(plan.reduce((sum, value) => sum + value.duration, 0)).toBe(2220);
    expect(beat(plan, 'anticipation').attacker).toBe('a');
    expect(beat(plan, 'lunge').attacker).toBe('a');
    expect(beat(plan, 'impact')).toMatchObject({ attacker: 'a', outcome: 'hit' });
    expect(beat(plan, 'damage').targets).toEqual([{ side: 'b', amount: 7, fromHp: 30, toHp: 23 }]);
    expect(beat(plan, 'drain').targets).toEqual([{ side: 'b', amount: 7, fromHp: 30, toHp: 23 }]);
    expect(beat(plan, 'result')).toMatchObject({ result: 'nextHalf', winner: null });
    expect(plan.slice(0, 4).every((value) => value.targets.length === 0)).toBe(true);
    expect(plan.slice(0, 6).every((value) => value.result === null)).toBe(true);
  });

  it('resolves a monster attacking a, not the turn seat', () => {
    const previous = fixture();
    battle(previous).attackerSide = 'b';
    const plan = planBattle(
      previous,
      after(previous, 21, 30),
      [hit('jellyBun', 0, 9)],
      'human',
      false,
    );
    expect(beat(plan, 'lunge').attacker).toBe('b');
    expect(beat(plan, 'damage').targets).toEqual([{ side: 'a', amount: 9, fromHp: 30, toHp: 21 }]);
  });

  it('resolves player b by seat identity even when event IDs are strings', () => {
    const previous = fixture(false);
    const plan = planBattle(previous, after(previous, 26, 30), [hit('1', '0', 4)], 'human', false);
    expect(beat(plan, 'impact').attacker).toBe('b');
    expect(beat(plan, 'damage').targets).toEqual([{ side: 'a', amount: 4, fromHp: 30, toHp: 26 }]);
  });

  it('keeps the original attacker when a counter damages that attacker', () => {
    const previous = fixture();
    const plan = planBattle(
      previous,
      after(previous, 19, 30),
      [hit(0, 'jellyBun', 0, 11)],
      'human',
      false,
    );
    expect(beat(plan, 'impact')).toMatchObject({ attacker: 'a', outcome: 'countered' });
    expect(beat(plan, 'damage')).toMatchObject({
      outcome: 'countered',
      targets: [{ side: 'a', amount: 11, fromHp: 30, toHp: 19 }],
    });
    expect(plan).toHaveLength(7);
  });

  it('carries mutual damage in one damage beat and one drain beat', () => {
    const previous = fixture();
    const plan = planBattle(
      previous,
      after(previous, 25, 23),
      [hit(0, 'jellyBun', 7, 5)],
      'human',
      false,
    );
    const targets = [
      { side: 'a', amount: 5, fromHp: 30, toHp: 25 },
      { side: 'b', amount: 7, fromHp: 30, toHp: 23 },
    ];
    expect(beat(plan, 'damage')).toMatchObject({ outcome: 'mutual', targets });
    expect(beat(plan, 'drain').targets).toEqual(targets);
    expect(plan.filter((value) => value.kind === 'damage')).toHaveLength(1);
    expect(plan.filter((value) => value.kind === 'drain')).toHaveLength(1);
    expect(plan.reduce((sum, value) => sum + value.duration, 0)).toBe(2220);
  });

  it('uses event damage but authoritative next HP (not inferred damage)', () => {
    const previous = fixture();
    const plan = planBattle(previous, after(previous, 30, 25), [hit()], 'human', false);
    expect(beat(plan, 'damage').targets).toEqual([{ side: 'b', amount: 7, fromHp: 30, toHp: 25 }]);
  });

  it('clamps overkill at zero without changing the reported damage', () => {
    const previous = fixture();
    const plan = planBattle(
      previous,
      after(previous, 30, -70),
      [hit(0, 'jellyBun', 100)],
      'human',
      false,
    );
    expect(beat(plan, 'drain').targets).toEqual([{ side: 'b', amount: 100, fromHp: 30, toHp: 0 }]);
    expect(beat(plan, 'result').result).toBe('nextHalf');
  });

  it('clamps presented and final HP using each authoritative maxHp', () => {
    const previous = fixture();
    battle(previous).b.hp = 90;
    const next = after(previous, 30, 70);
    battle(next).b.stats.maxHp = 45;
    const plan = planBattle(previous, next, [hit()], 'human', false);
    expect(beat(plan, 'drain').targets).toEqual([{ side: 'b', amount: 7, fromHp: 40, toHp: 45 }]);
  });

  it('shows an explicit miss with no zero-damage target', () => {
    const previous = fixture();
    const plan = planBattle(
      previous,
      after(previous, 30, 30),
      [hit(0, 'jellyBun', 0)],
      'human',
      false,
    );
    expect(beat(plan, 'impact').outcome).toBe('miss');
    expect(beat(plan, 'damage')).toMatchObject({ outcome: 'miss', targets: [] });
    expect(beat(plan, 'drain').targets).toEqual([]);
  });

  it('shows blocked when the event explicitly states a block', () => {
    const previous = fixture();
    const zero = hit(0, 'jellyBun', 0);
    zero.params.outcome = 'blocked';
    const plan = planBattle(previous, after(previous, 30, 30), [zero], 'human', false);
    expect(beat(plan, 'damage')).toMatchObject({ outcome: 'blocked', targets: [] });
  });

  it('does not publish a pending secret or a BattlePick as a revealed secret', () => {
    const previous = fixture();
    battle(previous).pending.attack = 'secret';
    const next = after(previous);
    battle(next).pending.defense = 'secret';
    const pick = event('BattlePick', { side: 'a', pick: 'secret', role: 'attack' }, 0);
    expect(planBattle(previous, previous, [pick], 'human', false)).toEqual([]);
    const plan = planBattle(previous, next, [pick, hit()], 'human', false);
    expect(beat(plan, 'reveal').revealed ?? []).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain('secret');
  });

  it('reveals only this batch SecretUsed event, preserving the secret side', () => {
    const previous = fixture(false);
    const plan = planBattle(
      previous,
      after(previous, 22, 30),
      [event('SecretUsed', { side: 'b', secret: 'firestorm', damage: 8 }, 1)],
      'human',
      false,
    );
    expect(beat(plan, 'reveal').revealed).toEqual([{ side: 'b', secretId: 'firestorm' }]);
    expect(beat(plan, 'lunge').attacker).toBe('a');
    expect(beat(plan, 'damage').targets).toEqual([{ side: 'a', amount: 8, fromHp: 30, toHp: 22 }]);
    expect(plan.slice(1).every((value) => !value.revealed?.length)).toBe(true);
  });

  it('derives bulwark reflection from its SecretUsed event only', () => {
    const previous = fixture(false);
    const plan = planBattle(
      previous,
      after(previous, 24, 30),
      [event('SecretUsed', { side: 'b', secret: 'bulwark', reflected: 6 }, 1)],
      'human',
      false,
    );
    expect(beat(plan, 'damage')).toMatchObject({
      outcome: 'countered',
      targets: [{ side: 'a', amount: 6, fromHp: 30, toHp: 24 }],
    });
  });

  it('allows sanctuary healing in drain, never as a zero damage hit', () => {
    const previous = fixture(false);
    const plan = planBattle(
      previous,
      after(previous, 30, 40),
      [event('SecretUsed', { side: 'b', secret: 'sanctuary', healed: 10 }, 1)],
      'human',
      false,
    );
    expect(beat(plan, 'damage')).toMatchObject({ outcome: 'blocked', targets: [] });
    expect(beat(plan, 'drain').targets).toEqual([{ side: 'b', amount: 0, fromHp: 30, toHp: 40 }]);
  });

  it('does not turn stolen gold into HP damage or a healing target', () => {
    const previous = fixture(false);
    const plan = planBattle(
      previous,
      after(previous),
      [event('SecretUsed', { side: 'a', secret: 'pickpocket', stolen: 15 }, 0), hit(0, 1)],
      'human',
      false,
    );
    expect(beat(plan, 'damage').targets).toEqual([{ side: 'b', amount: 7, fromHp: 30, toHp: 23 }]);
  });

  it('combines poison and direct damage without adding another consequence wait', () => {
    const previous = fixture();
    const plan = planBattle(
      previous,
      after(previous, 27, 23),
      [hit(), event('PoisonDamage', { amount: 3, exchange: 1 }, 0)],
      'human',
      false,
    );
    expect(beat(plan, 'damage')).toMatchObject({
      outcome: 'mutual',
      targets: [
        { side: 'a', amount: 3, fromHp: 30, toHp: 27 },
        { side: 'b', amount: 7, fromHp: 30, toHp: 23 },
      ],
    });
    expect(plan).toHaveLength(7);
  });

  it.each(['empty', 'unrelated', 'pending', 'start'] as const)(
    'ignores a %s batch rather than inventing an exchange',
    (kind) => {
      const previous = fixture();
      const events =
        kind === 'empty'
          ? []
          : kind === 'unrelated'
            ? [event('GoldGained', { amount: 9 }, 0)]
            : kind === 'start'
              ? [event('BattleStarted', { context: 'monster', first: 'a' }, 0)]
              : [event('BattlePick', { side: 'a', pick: 'attack', role: 'attack' }, 0)];
      expect(planBattle(previous, previous, events, 'human', false)).toEqual([]);
      expect(planBattle(previous, previous, events, 'human', true)).toEqual([]);
    },
  );

  it('ignores battle-looking events without a previous or next battle identity', () => {
    const state = fixture();
    state.phase = { kind: 'awaitRoll' };
    expect(planBattle(state, state, [hit()], 'human', false)).toEqual([]);
  });

  it('ignores unresolved attacker/defender IDs instead of assigning them to a', () => {
    const previous = fixture();
    expect(
      planBattle(previous, after(previous), [hit('unknown', 'missing')], 'human', false),
    ).toEqual([]);
  });

  it('does not reveal a malformed secret side as a', () => {
    const previous = fixture();
    const plan = planBattle(
      previous,
      after(previous),
      [hit(), event('SecretUsed', { side: 'unknown', secret: 'firestorm', damage: 500 })],
      'human',
      false,
    );
    expect(beat(plan, 'reveal').revealed ?? []).toEqual([]);
    expect(beat(plan, 'damage').targets).toEqual([{ side: 'b', amount: 7, fromHp: 30, toHp: 23 }]);
  });

  it('returns nextExchange, never victory, when the battle advances an exchange', () => {
    const previous = fixture();
    battle(previous).half = 2;
    const next = after(previous);
    battle(next).half = 1;
    battle(next).exchange = 2;
    expect(beat(planBattle(previous, next, [hit()], 'human', false), 'result')).toMatchObject({
      result: 'nextExchange',
      winner: null,
    });
  });

  it.each([
    ['aWin', 'win', 'a'],
    ['bWin', 'loss', 'b'],
    ['draw', 'draw', null],
  ] as const)('maps %s from side a perspective, only at BattleEnded', (ended, result, winner) => {
    const previous = fixture();
    const next = after(previous);
    next.phase = { kind: 'awaitRoll' };
    const plan = planBattle(
      previous,
      next,
      [hit(0, 'jellyBun', 100), event('BattleEnded', { result: ended }, null)],
      'human',
      false,
    );
    expect(beat(plan, 'result')).toMatchObject({ result, winner });
    expect(beat(plan, 'drain').targets).toEqual([{ side: 'b', amount: 100, fromHp: 30, toHp: 0 }]);
  });

  it('preserves an end-only draw event with no fictitious hit', () => {
    const previous = fixture();
    const next = after(previous);
    next.phase = { kind: 'awaitRoll' };
    const plan = planBattle(
      previous,
      next,
      [event('BattleEnded', { result: 'draw' })],
      'human',
      false,
    );
    expect(beat(plan, 'damage')).toMatchObject({ outcome: null, targets: [] });
    expect(beat(plan, 'result')).toMatchObject({ result: 'draw', winner: null });
  });

  it.each(['bot', 'online'] as const)('proportionally caps %s presentation at 600ms', (mode) => {
    const previous = fixture();
    const plan = planBattle(previous, after(previous), [hit()], mode, false);
    expect(plan.map((value) => value.duration)).toEqual([64, 59, 43, 27, 135, 94, 175]);
    expect(plan.reduce((sum, value) => sum + value.duration, 0)).toBeLessThanOrEqual(600);
    expect(plan).toHaveLength(7);
  });

  it.each([true, false])(
    'returns one static result for reduced motion or speed zero (%s)',
    (reduced) => {
      const previous = fixture(false);
      const events = [
        hit(0, 1),
        event('SecretUsed', { side: 'a', secret: 'pickpocket', stolen: 5 }, 0),
      ];
      // R2-C passes reduced || speed <= 0 to this fixed-signature pure API.
      const speed = 0;
      const plan = planBattle(previous, after(previous), events, 'human', reduced || speed <= 0);
      expect(plan).toEqual([
        {
          kind: 'result',
          duration: 0,
          targets: [{ side: 'b', amount: 7, fromHp: 30, toHp: 23 }],
          attacker: 'a',
          outcome: 'hit',
          revealed: [{ side: 'a', secretId: 'pickpocket' }],
          result: 'nextHalf',
          winner: null,
        },
      ]);
    },
  );

  it('static result reconciles a KO player to final authoritative HP after respawn', () => {
    const previous = fixture(false);
    const next = after(previous);
    next.phase = { kind: 'awaitRoll' };
    next.players[0]!.stats.maxHp = 40;
    next.players[0]!.hp = 40;
    const events = [hit(1, 0, 100), event('BattleEnded', { result: 'bWin' }, 1)];
    const animated = planBattle(previous, next, events, 'human', false);
    expect(beat(animated, 'drain').targets).toEqual([
      { side: 'a', amount: 100, fromHp: 30, toHp: 0 },
    ]);
    const staticPlan = planBattle(previous, next, events, 'human', true);
    expect(staticPlan).toHaveLength(1);
    expect(staticPlan[0]).toMatchObject({
      duration: 0,
      result: 'loss',
      winner: 'b',
      targets: [{ side: 'a', amount: 100, fromHp: 30, toHp: 40 }],
    });
  });

  it('static end-only result reconciles authoritative HP even without a damage event', () => {
    const previous = fixture(false);
    const next = after(previous);
    next.phase = { kind: 'awaitRoll' };
    next.players[0]!.hp = 35;
    next.players[0]!.stats.maxHp = 40;
    next.players[1]!.hp = 30;
    next.players[1]!.stats.maxHp = 40;
    const plan = planBattle(
      previous,
      next,
      [event('BattleEnded', { result: 'draw' })],
      'human',
      true,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      duration: 0,
      result: 'draw',
      targets: [{ side: 'a', amount: 0, fromHp: 30, toHp: 35 }],
    });
  });

  it('is deterministic, never mutates frozen input, and returns detached targets', () => {
    const previous = fixture();
    const next = after(previous);
    const events = [hit()];
    function freeze(value: object) {
      Object.freeze(value);
      for (const child of Object.values(value))
        if (child && typeof child === 'object') freeze(child);
    }
    freeze(previous);
    freeze(next);
    freeze(events);
    const first = planBattle(previous, next, events, 'human', false);
    const second = planBattle(previous, next, events, 'human', false);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first).toHaveLength(7);
    beat(first, 'damage').targets[0]!.amount = 999;
    expect(beat(second, 'damage').targets[0]!.amount).toBe(7);
    expect(events[0]!.params.toDefender).toBe(7);
  });
});
