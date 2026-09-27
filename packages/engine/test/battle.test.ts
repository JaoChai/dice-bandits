import { describe, it, expect } from 'vitest';
import {
  createGame,
  startBattle,
  applyBattlePick,
  resolveHalf,
  damage,
  step,
  legalActions,
} from '../src/index';
import { BALANCE, MONSTERS } from '../src/data/index';
import { IllegalActionError } from '../src/types';
import type {
  AttackPick,
  BattleState,
  ClassId,
  Combatant,
  DefensePick,
  GameConfig,
  GameEvent,
  GameState,
  Stats,
} from '../src/types';
import { assertInvariants } from './invariants';

const cfg = (classA: ClassId, seed = 'battle'): GameConfig => ({
  seed,
  rounds: 12,
  seats: [
    { name: 'A', classId: classA, control: 'human', personality: null },
    { name: 'B', classId: 'knight', control: 'bot', personality: 'greedy' },
  ],
});

const stats = (over: Partial<Stats> = {}): Stats => ({
  maxHp: 50,
  atk: 12,
  def: 12,
  spd: 10,
  mag: 4,
  ...over,
});

const mkPlayer = (seat: number, st: Stats, over: Partial<Combatant> = {}): Combatant => ({
  kind: 'player',
  seat,
  monsterId: null,
  level: 1,
  hp: st.maxHp,
  stats: { ...st },
  secretUsed: false,
  buffs: { ironSkin: false, poison: false, halveNext: false },
  ...over,
});

const mkMonster = (id: string, level = 1, hp?: number): Combatant => {
  const def = MONSTERS[id]!;
  const scale = (k: keyof Stats) => def.base[k] + def.growth[k] * (level - 1);
  const st: Stats = {
    maxHp: scale('maxHp'),
    atk: scale('atk'),
    def: scale('def'),
    spd: scale('spd'),
    mag: scale('mag'),
  };
  return {
    kind: 'monster',
    seat: null,
    monsterId: id,
    level,
    hp: hp ?? st.maxHp,
    stats: st,
    secretUsed: false,
    buffs: { ironSkin: false, poison: false, halveNext: false },
  };
};

const battleOf = (s: GameState): BattleState => {
  if (s.phase.kind !== 'battle') throw new Error(`expected battle phase, got ${s.phase.kind}`);
  return s.phase.battle;
};

const other = (side: 'a' | 'b'): 'a' | 'b' => (side === 'a' ? 'b' : 'a');

interface FixtureOpts {
  classA?: ClassId;
  opponent: Combatant;
  context?: 'monster' | 'town' | 'pvp';
  hp?: number;
  gold?: number;
  atk?: number;
  seed?: string;
}

/** A game with seat 0 (turnSeat) in an active battle against `opponent`. */
const fixture = (opts: FixtureOpts): GameState => {
  const s = createGame(cfg(opts.classA ?? 'knight', opts.seed));
  if (opts.hp !== undefined) s.players[0]!.hp = opts.hp;
  if (opts.gold !== undefined) s.players[0]!.gold = opts.gold;
  if (opts.atk !== undefined) s.players[0]!.stats.atk = opts.atk;
  startBattle(s, {
    context: opts.context ?? 'monster',
    spaceId: s.players[0]!.pos,
    opponent: opts.opponent,
  });
  return s;
};

/** Min/max damage across the [0.9, 1.1] variance band. */
const dmgRange = (atk: number, def: number, mult: number): [number, number] => [
  Math.max(1, Math.round((atk * mult - def / 2) * BALANCE.damageVariance[0])),
  Math.max(1, Math.round((atk * mult - def / 2) * BALANCE.damageVariance[1])),
];

/** Drive a battle to completion: monster picks are engine-drawn, players use fixed picks. */
const drive = (
  s: GameState,
  pickFor: (side: 'a' | 'b', attacking: boolean) => AttackPick | DefensePick,
): { state: GameState; events: GameEvent[] } => {
  const events: GameEvent[] = [];
  let st = s;
  for (let i = 0; i < 40 && st.phase.kind === 'battle'; i++) {
    const bt = battleOf(st);
    const side = bt.pending.attack === null ? bt.attackerSide : other(bt.attackerSide);
    const attacking = side === bt.attackerSide;
    const pick = pickFor(side, attacking);
    const r = step(st, { type: 'battlePick', side, pick });
    events.push(...r.events);
    st = r.state;
  }
  return { state: st, events };
};

describe('damage formula', () => {
  it('matches the spec formula max(1, round((atk*mult - def/2) * variance))', () => {
    expect(damage(12, 6, 1, 1)).toBe(9);
    expect(damage(12, 6, 1.5, 1)).toBe(15);
    expect(damage(15, 9, 2, 1)).toBe(26);
  });
  it('floors at 1', () => {
    expect(damage(1, 100, 1, 1)).toBe(1);
    expect(damage(2, 2, 1, 0.9)).toBe(1);
    expect(damage(5, 8, 0.5, 0.9)).toBe(1);
  });
});

describe('§5.5 matrix via resolveHalf (variance forced to 1)', () => {
  // attacker atk 12, defender def 12 → base attack damage 6, base strike damage 12
  const atk = mkPlayer(0, stats({ atk: 12, def: 8 }));
  const def = mkPlayer(1, stats({ atk: 10, def: 12 }));

  it('attack × defend deals half damage to the defender', () => {
    expect(resolveHalf(atk, def, 'attack', 'defend', 1)).toEqual({ toAttacker: 0, toDefender: 3 });
  });
  it('attack × counter deals full damage to the defender', () => {
    expect(resolveHalf(atk, def, 'attack', 'counter', 1)).toEqual({ toAttacker: 0, toDefender: 6 });
  });
  it('strike × defend breaks the guard: strike mult applies inside the formula', () => {
    // (12 × 1.5 − 12/2) = 12; the defend halving does not apply (guard broken)
    expect(resolveHalf(atk, def, 'strike', 'defend', 1)).toEqual({ toAttacker: 0, toDefender: 12 });
  });
  it('strike × counter: attacker takes its own strike, defender unharmed', () => {
    expect(resolveHalf(atk, def, 'strike', 'counter', 1)).toEqual({
      toAttacker: 12,
      toDefender: 0,
    });
  });
  it('halveNext on a combatant halves the damage it takes', () => {
    const guarded = mkPlayer(1, stats(), {
      buffs: { ironSkin: false, poison: false, halveNext: true },
    });
    expect(resolveHalf(atk, guarded, 'attack', 'defend', 1).toDefender).toBe(1); // (6×0.5)/2
    const cautious = mkPlayer(0, stats({ atk: 12, def: 8 }), {
      buffs: { ironSkin: false, poison: false, halveNext: true },
    });
    expect(resolveHalf(cautious, def, 'strike', 'counter', 1).toAttacker).toBe(6); // 12/2
  });
  it('rejects secret picks (secrets resolve in applyBattlePick)', () => {
    expect(() => resolveHalf(atk, def, 'secret', 'defend', 1)).toThrow(TypeError);
    expect(() => resolveHalf(atk, def, 'attack', 'secret', 1)).toThrow(TypeError);
  });
});

describe('startBattle', () => {
  it('sets the battle phase with the initiator as side a', () => {
    const s = createGame(cfg('knight'));
    const r = startBattle(s, { context: 'monster', spaceId: 3, opponent: mkMonster('goldSlime') });
    expect(r.state).toBe(s); // rule functions mutate the clone their caller made
    expect(s.phase.kind).toBe('battle');
    const bt = battleOf(s);
    expect(bt.context).toBe('monster');
    expect(bt.spaceId).toBe(3);
    expect(bt.a.seat).toBe(0);
    expect(bt.a.stats).toEqual(s.players[0]!.stats);
    expect(bt.b.monsterId).toBe('goldSlime');
    expect(bt.exchange).toBe(1);
    expect(bt.half).toBe(1);
    expect(bt.pending).toEqual({ attack: null, defense: null });
    expect(r.events.map((e) => e.type)).toEqual(['BattleStarted']);
  });
  it('the higher-SPD side attacks first; ties go to the initiator', () => {
    expect(battleOf(fixture({ opponent: mkMonster('shadowImp') })).attackerSide).toBe('b'); // 10 > 6
    expect(battleOf(fixture({ opponent: mkMonster('mimic') })).attackerSide).toBe('a'); // 6 == 6
  });
  it('does not mutate the opponent passed to startBattle during combat', () => {
    const s = createGame(cfg('knight'));
    s.players[1]!.classId = 'cleric';
    const opponent = mkPlayer(1, s.players[1]!.stats, { hp: 20 });
    const original = structuredClone(opponent);
    startBattle(s, { context: 'pvp', spaceId: 0, opponent });
    applyBattlePick(s, 'a', 'attack');
    applyBattlePick(s, 'b', 'secret');
    expect(opponent).toEqual(original);
  });
  it('refunds the attacker secret when both pvp sides pick secret in one half', () => {
    const s = createGame(cfg('knight', 'clashing-secrets'));
    startBattle(s, {
      context: 'pvp',
      spaceId: 0,
      opponent: mkPlayer(1, s.players[1]!.stats),
    });
    const r1 = step(s, { type: 'battlePick', side: 'a', pick: 'secret' });
    const r2 = step(r1.state, { type: 'battlePick', side: 'b', pick: 'secret' });
    const bt = battleOf(r2.state);
    expect(bt.a.secretUsed).toBe(false);
    expect(bt.b.secretUsed).toBe(true);
    expect(r2.events.filter((event) => event.type === 'SecretUsed')).toEqual([
      expect.objectContaining({
        seat: 1,
        params: expect.objectContaining({ side: 'b', secret: 'bulwark' }),
      }),
    ]);
    const r3 = step(r2.state, { type: 'battlePick', side: 'b', pick: 'attack' });
    expect(
      legalActions(r3.state, 0).map((action) =>
        action.type === 'battlePick' ? action.pick : null,
      ),
    ).toEqual(['defend', 'counter', 'secret']);
  });
  it('supports pvp context (Task 7 wires the entry point)', () => {
    const s = createGame(cfg('knight', 'pvp'));
    const r = startBattle(s, {
      context: 'pvp',
      spaceId: 0,
      opponent: mkPlayer(1, s.players[1]!.stats),
    });
    const bt = battleOf(r.state);
    expect(bt.context).toBe('pvp');
    expect(bt.b.seat).toBe(1);
    assertInvariants(r.state);
  });
});

describe('battle picks and legal actions', () => {
  it('offers actions to the player while monster picks are engine-drawn', () => {
    const s = fixture({ opponent: mkMonster('goldSlime') }); // knight 6 > slime 4 → a picks first
    const picks = (st: GameState, seat: number) =>
      legalActions(st, seat).map((a) => (a.type === 'battlePick' ? a.pick : null));
    expect(picks(s, 0)).toEqual(['attack', 'strike', 'secret']);
    const r = step(s, { type: 'battlePick', side: 'a', pick: 'attack' });
    expect(['attack', 'strike']).toContain(battleOf(r.state).pending.attack); // monster opens half 2 with a pre-drawn pick
    expect(picks(r.state, 0)).toEqual(['defend', 'counter', 'secret']); // player can immediately defend
    expect(picks(r.state, 1)).toEqual([]); // seat 1 is not in this battle
    expect(() => step(r.state, { type: 'battlePick', side: 'a', pick: 'strike' })).toThrow(
      IllegalActionError,
    );
  });
  it('legalActions offers defend/counter/secret to a player defender (pvp)', () => {
    const s = createGame(cfg('knight', 'pvp2'));
    startBattle(s, { context: 'pvp', spaceId: 0, opponent: mkPlayer(1, s.players[1]!.stats) });
    const r = step(s, { type: 'battlePick', side: 'a', pick: 'attack' });
    const picks = legalActions(r.state, 1).map((a) => (a.type === 'battlePick' ? a.pick : null));
    expect(picks).toEqual(['defend', 'counter', 'secret']);
  });
  it('a used secret is neither offered nor accepted again', () => {
    const s = fixture({ opponent: mkMonster('shadowImp') }); // imp picks first
    const r2 = step(s, { type: 'battlePick', side: 'a', pick: 'secret' }); // bulwark resolves against pre-drawn attack
    expect(battleOf(r2.state).a.secretUsed).toBe(true);
    // half 2: the knight is now the attacker; secret must not be offered
    const offered = legalActions(r2.state, 0).map((a) => (a.type === 'battlePick' ? a.pick : null));
    expect(offered).toEqual(['attack', 'strike']);
    expect(() => step(r2.state, { type: 'battlePick', side: 'a', pick: 'secret' })).toThrow(
      IllegalActionError,
    );
  });
  it('step does not mutate the input during battle picks', () => {
    const s = fixture({ opponent: mkMonster('goldSlime') });
    const snap = structuredClone(s);
    step(s, { type: 'battlePick', side: 'a', pick: 'attack' });
    expect(s).toEqual(snap);
  });
});

describe('secrets', () => {
  it('firestorm deals 2×mag ignoring the defender pick, caster unharmed', () => {
    const s = fixture({ classA: 'mage', opponent: mkMonster('rockGolem') }); // mage 9 > golem 3
    const golem0 = battleOf(s).b.hp;
    const mage0 = battleOf(s).a.hp;
    const r1 = step(s, { type: 'battlePick', side: 'a', pick: 'secret' }); // firestorm
    const r2 = r1; // the faster mage's pick resolves against the pre-drawn defense
    const bt2 = battleOf(r2.state);
    const [lo, hi] = dmgRange(bt2.a.stats.mag, bt2.b.stats.def, 2);
    expect(golem0 - bt2.b.hp).toBeGreaterThanOrEqual(lo);
    expect(golem0 - bt2.b.hp).toBeLessThanOrEqual(hi);
    expect(bt2.a.hp).toBe(mage0); // matrix skipped: no counter damage
    expect(bt2.a.secretUsed).toBe(true);
  });
  it('bulwark: knight takes 0 and reflects half of the incoming attack×counter', () => {
    const s = fixture({ opponent: mkMonster('shadowImp') }); // imp 10 > knight 6
    const knight0 = battleOf(s).a.hp;
    const imp0 = battleOf(s).b.hp;
    const r2 = step(s, { type: 'battlePick', side: 'a', pick: 'secret' }); // bulwark resolves against pre-drawn attack
    const bt2 = battleOf(r2.state);
    expect(bt2.a.hp).toBe(knight0); // takes 0 this half
    const [lo, hi] = dmgRange(bt2.b.stats.atk, bt2.a.stats.def, BALANCE.attackMult);
    const rlo = Math.max(1, Math.round(lo * 0.5));
    const rhi = Math.max(1, Math.round(hi * 0.5));
    expect(imp0 - bt2.b.hp).toBeGreaterThanOrEqual(rlo);
    expect(imp0 - bt2.b.hp).toBeLessThanOrEqual(rhi);
    expect(bt2.a.secretUsed).toBe(true);
  });
  it('pickpocket steals 0 from monsters but still attacks (attack×counter)', () => {
    const s = fixture({ classA: 'thief', opponent: mkMonster('goldSlime') }); // thief 13 > slime 4
    const slime0 = battleOf(s).b.hp;
    const r1 = step(s, { type: 'battlePick', side: 'a', pick: 'secret' }); // pickpocket
    const r2 = r1; // the faster thief's pick resolves against the pre-drawn defense
    const bt2 = battleOf(r2.state);
    expect(r2.state.players[0]!.gold).toBe(300); // monsters carry no gold
    const [lo, hi] = dmgRange(bt2.a.stats.atk, bt2.b.stats.def, BALANCE.attackMult);
    expect(slime0 - bt2.b.hp).toBeGreaterThanOrEqual(lo);
    expect(slime0 - bt2.b.hp).toBeLessThanOrEqual(hi);
  });
  it('pickpocket in pvp steals 15% of the target gold', () => {
    const s = createGame(cfg('thief', 'pvp3'));
    s.players[0]!.gold = 300;
    s.players[1]!.gold = 200;
    startBattle(s, { context: 'pvp', spaceId: 0, opponent: mkPlayer(1, s.players[1]!.stats) });
    const target0 = battleOf(s).b.hp;
    const r1 = step(s, { type: 'battlePick', side: 'a', pick: 'secret' }); // pickpocket
    const r2 = step(r1.state, { type: 'battlePick', side: 'b', pick: 'defend' });
    expect(r2.state.players[0]!.gold).toBe(330); // +floor(200 × 0.15)
    expect(r2.state.players[1]!.gold).toBe(170);
    const bt2 = battleOf(r2.state);
    const [lo, hi] = dmgRange(bt2.a.stats.atk, bt2.b.stats.def, BALANCE.attackMult);
    expect(target0 - bt2.b.hp).toBeGreaterThanOrEqual(lo);
    expect(target0 - bt2.b.hp).toBeLessThanOrEqual(hi);
  });
  it('sanctuary heals 40% maxHp, sets halveNext; the next hit taken is halved once', () => {
    const s = fixture({ classA: 'cleric', opponent: mkMonster('goldSlime'), hp: 20 }); // cleric 8 > slime 4
    const slime0 = battleOf(s).b.hp;
    const r1 = step(s, { type: 'battlePick', side: 'a', pick: 'secret' }); // sanctuary
    const r2 = r1; // the faster cleric's pick resolves against the pre-drawn defense
    const bt2 = battleOf(r2.state);
    const heal = Math.min(Math.round(bt2.a.stats.maxHp * 0.4), bt2.a.stats.maxHp - 20);
    expect(bt2.a.hp).toBe(20 + heal);
    expect(bt2.a.buffs.halveNext).toBe(true);
    expect(bt2.b.hp).toBe(slime0);
    // half 2: slime attacks the halved cleric — any pick, damage strictly under the unhalved band
    const r4 = step(r2.state, { type: 'battlePick', side: 'a', pick: 'defend' });
    const bt4 = battleOf(r4.state);
    expect(bt4.a.buffs.halveNext).toBe(false); // consumed
    const loss = 20 + heal - bt4.a.hp;
    expect(loss).toBeGreaterThanOrEqual(1);
    expect(loss).toBeLessThanOrEqual(6); // halved: best case defend 1, worst strike×defend floor(12/2)
  });
});

describe('battle end', () => {
  it('ends in a draw after 3 exchanges with no rewards', () => {
    const s = fixture({ opponent: mkMonster('rockGolem', 1, 500) }); // nobody can KO
    const gold0 = s.players[0]!.gold;
    const xp0 = s.players[0]!.xp;
    const { state, events } = drive(s, (side, attacking) =>
      attacking ? (side === 'a' ? 'attack' : 'strike') : 'defend',
    );
    expect(state.phase.kind).toBe('awaitRoll'); // turn ended after the draw
    const ended = events.find((e) => e.type === 'BattleEnded');
    expect(ended && ended.params.result).toBe('draw');
    expect(events.some((e) => e.type === 'GoldGained')).toBe(false);
    expect(events.some((e) => e.type === 'XpGained')).toBe(false);
    expect(state.players[0]!.gold).toBe(gold0);
    expect(state.players[0]!.xp).toBe(xp0);
    expect(state.turnSeat).toBe(1);
    assertInvariants(state);
  });
  it('monster win grants the monster xp + gold without a level-up', () => {
    // slime hp 5: the knight's opening attack (≥12 with atk 30) KOs it before it ever acts
    const s = fixture({ opponent: mkMonster('goldSlime', 1, 5), atk: 30 });
    const { state, events } = drive(s, (side, attacking) =>
      attacking ? (side === 'a' ? 'attack' : 'strike') : 'defend',
    );
    const ended = events.find((e) => e.type === 'BattleEnded');
    expect(ended && ended.params.result).toBe('aWin');
    const xp = events.find((e) => e.type === 'XpGained');
    const gold = events.find((e) => e.type === 'GoldGained');
    expect(xp && xp.params.amount).toBe(MONSTERS['goldSlime']!.xp);
    expect(gold && gold.params.amount).toBe(MONSTERS['goldSlime']!.gold);
    expect(state.players[0]!.xp).toBe(MONSTERS['goldSlime']!.xp);
    expect(state.players[0]!.gold).toBe(300 + MONSTERS['goldSlime']!.gold);
    expect(state.players[0]!.level).toBe(1); // Task 6 adds the levelUp phase
    expect(state.players[0]!.hp).toBe(48); // slime never got to act
    expect(state.phase.kind).toBe('awaitRoll');
    expect(state.turnSeat).toBe(1);
    assertInvariants(state);
  });
  it('KO by monster: lose 20% gold, respawn at castle, hp maxHp, skip next turn', () => {
    const s = fixture({ opponent: mkMonster('shadowImp'), hp: 5 }); // imp outdamages 5 hp fast
    const { state, events } = drive(s, (side, attacking) =>
      attacking ? (side === 'a' ? 'attack' : 'strike') : 'defend',
    );
    const ended = events.find((e) => e.type === 'BattleEnded');
    expect(ended && ended.params.result).toBe('bWin');
    expect(events.some((e) => e.type === 'PlayerKO')).toBe(true);
    const p = state.players[0]!;
    expect(p.gold).toBe(240); // 300 − floor(300 × 0.2)
    expect(p.pos).toBe(state.board.castleId);
    expect(p.hp).toBe(p.stats.maxHp);
    expect(p.skipTurns).toBe(1);
    expect(state.stats.kos[0]).toBe(1); // counts times KO'd
    expect(state.phase.kind).toBe('awaitRoll');
    expect(state.turnSeat).toBe(1);
    assertInvariants(state);
  });
  it('pvp KO applies the penalty, counts stats.kos, and opens PvP reward selection', () => {
    const s = createGame(cfg('knight', 'pvp4'));
    s.players[0]!.stats.atk = 40; // a KOs b by exchange 3 at the latest
    startBattle(s, { context: 'pvp', spaceId: 0, opponent: mkPlayer(1, s.players[1]!.stats) });
    const { state, events } = drive(s, (_side, attacking) => (attacking ? 'attack' : 'defend'));
    const ended = events.find((e) => e.type === 'BattleEnded');
    expect(ended && ended.params.result).toBe('aWin');
    const loser = state.players[1]!;
    expect(loser.gold).toBe(240);
    expect(loser.pos).toBe(state.board.castleId);
    expect(loser.hp).toBe(loser.stats.maxHp);
    expect(state.phase.kind).toBe('pvpReward');
    expect(loser.skipTurns).toBe(1);
    expect(state.stats.kos[1]).toBe(1); // b was KO'd once
    expect(state.stats.kos[0]).toBe(0);
    expect(state.players[0]!.gold).toBe(300); // reward is selected in the pvpReward phase
    expect(events.some((e) => e.type === 'TurnSkipped')).toBe(false);
    expect(state.turnSeat).toBe(0);
    assertInvariants(state);
  });
});

describe('rng discipline', () => {
  it('monster picks are drawn at battle start and variance draws advance state.rng', () => {
    const s = createGame(cfg('knight', 'monster-rng'));
    const rng0 = structuredClone(s.rng);
    startBattle(s, {
      context: 'monster',
      spaceId: 0,
      opponent: mkMonster('shadowImp'),
    }); // imp attacks first
    const rng1 = structuredClone(s.rng);
    expect(rng1).not.toEqual(rng0); // opening monster pick is drawn before player defense

    const r2 = step(s, { type: 'battlePick', side: 'a', pick: 'defend' });
    expect(r2.state.rng).not.toEqual(rng1); // pick resolution draws damage variance
    const rng2 = structuredClone(r2.state.rng);
    const r3 = step(r2.state, { type: 'battlePick', side: 'a', pick: 'attack' });
    expect(r3.state.rng).not.toEqual(rng2); // next monster pick plus variance are drawn
  });
  it('monster picks are engine-drawn, role-appropriate, and never secret', () => {
    for (let i = 0; i < 20; i++) {
      const s = fixture({ seed: `mp${i}`, opponent: mkMonster('shadowImp') });
      const picks: string[] = [];
      let st = s;
      for (let j = 0; j < 12 && st.phase.kind === 'battle'; j++) {
        const bt = battleOf(st);
        const side = bt.pending.attack === null ? bt.attackerSide : other(bt.attackerSide);
        const attacking = side === bt.attackerSide;
        const r = applyBattlePick(st, side, attacking ? 'attack' : 'defend');
        for (const e of r.events) {
          if (e.type === 'BattlePick' && e.params.side === 'b') picks.push(String(e.params.pick));
        }
        st = r.state;
      }
      expect(picks.length).toBeGreaterThanOrEqual(4);
      for (const pick of picks) {
        expect(['attack', 'strike', 'defend', 'counter']).toContain(pick);
        expect(pick).not.toBe('secret');
      }
    }
  });
});
