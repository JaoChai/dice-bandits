import type { AttackPick, Combatant, DefensePick, GameEvent, GameState } from '../types';
import { IllegalActionError } from '../types';
import { nextFloat } from '../rng';
import { BALANCE, CLASSES, ITEM_BY_ID, MONSTERS } from '../data/index';
import * as leveling from './leveling';
import { endTurn, type RuleResult } from './movement';

export interface HalfDamage {
  toAttacker: number;
  toDefender: number;
}

export interface BattleStartCtx {
  context: 'monster' | 'town' | 'pvp';
  spaceId: number;
  opponent: Combatant;
}

type BattlePhase = Extract<GameState['phase'], { kind: 'battle' }>;
type BattleData = BattlePhase['battle'];

const other = (side: 'a' | 'b'): 'a' | 'b' => (side === 'a' ? 'b' : 'a');

const combatantOf = (bt: BattleData, side: 'a' | 'b'): Combatant => (side === 'a' ? bt.a : bt.b);

/** One draw from the engine's damage-variance band [0.9, 1.1]. */
function varianceDraw(state: GameState): number {
  const [f, next] = nextFloat(state.rng);
  state.rng = next;
  const [lo, hi] = BALANCE.damageVariance;
  return lo + f * (hi - lo);
}

/**
 * §5.5 damage: `max(1, round((atk × mult − def / 2) × variance))`.
 * `mult` from BALANCE (attack 1.0, strike 1.5); variance in [0.9, 1.1].
 */
export function damage(atk: number, def: number, mult: number, variance: number): number {
  return Math.max(1, Math.round((atk * mult - def / 2) * variance));
}

/** Firestorm only: the caster uses `mag` in place of `atk`, at a ×2 multiplier. */
export function magicDamage(mag: number, def: number, variance: number): number {
  return damage(mag, def, 2, variance);
}

/**
 * Pure §5.5 matrix for one half-exchange, variance forced by the caller
 * (tests pass 1). Secrets are excluded — they skip the matrix and resolve in
 * `applyBattlePick` where game state is available. A pre-existing `halveNext`
 * on the side taking damage halves that damage (min 1).
 */
export function resolveHalf(
  attacker: Combatant,
  defender: Combatant,
  atkPick: AttackPick,
  defPick: DefensePick,
  variance: number,
): HalfDamage {
  if (atkPick === 'secret' || defPick === 'secret') {
    // secrets skip the matrix and resolve in applyBattlePick
    throw new TypeError('resolveHalf: secrets skip the matrix');
  }
  let toDefender = 0;
  let toAttacker = 0;
  const strikeMult = BALANCE.strikeMult;
  const attack =
    attacker.stats.atk * (attacker.buffs.rage ? Number(ITEM_BY_ID.rage!.effect.attackMult) : 1);

  if (atkPick === 'strike' && defPick === 'counter') {
    toAttacker = damage(attack, defender.stats.def, strikeMult, variance);
  } else {
    const mult = atkPick === 'strike' ? strikeMult : BALANCE.attackMult;
    toDefender = damage(attack, defender.stats.def, mult, variance);
    if (atkPick === 'attack' && defPick === 'defend') {
      toDefender = Math.max(1, Math.round(toDefender * BALANCE.defendMult));
    }
  }

  if (toDefender > 0 && defender.buffs.halveNext) {
    toDefender = Math.max(1, Math.floor(toDefender / 2));
  }
  if (toAttacker > 0 && attacker.buffs.halveNext) {
    toAttacker = Math.max(1, Math.floor(toAttacker / 2));
  }
  return { toAttacker, toDefender };
}

/** Consume halveNext flags that existed before this half, then apply damage. */
function takeDamage(c: Combatant, amount: number, state?: GameState, source?: Combatant): void {
  if (amount <= 0) return;
  if (
    state &&
    source?.kind === 'monster' &&
    c.kind === 'player' &&
    state.players[c.seat!]!.perks.includes('thickSkin')
  ) {
    amount = Math.max(1, Math.floor(amount * 0.85));
  }
  c.hp = Math.max(0, c.hp - amount);
}

/**
 * Start a battle: phase becomes `battle`, the initiator is side `a`, and the
 * higher-SPD side is the first Attacker (ties: the initiator `a`).
 */
export function startBattle(state: GameState, ctx: BattleStartCtx): RuleResult {
  if (state.phase.kind === 'battle') throw new Error('startBattle: already in a battle');
  const me = state.players[state.turnSeat]!;
  const a: Combatant = {
    kind: 'player',
    seat: me.seat,
    monsterId: null,
    level: me.level,
    hp: me.hp,
    stats: { ...me.stats },
    secretUsed: false,
    buffs: { ironSkin: false, poison: false, halveNext: false },
  };
  const b: Combatant = { ...structuredClone(ctx.opponent), secretUsed: false };
  const attackerSide: 'a' | 'b' = b.stats.spd > a.stats.spd ? 'b' : 'a';
  state.phase = {
    kind: 'battle',
    battle: {
      context: ctx.context,
      spaceId: ctx.spaceId,
      a,
      b,
      exchange: 1,
      attackerSide,
      half: 1,
      pending: { attack: null, defense: null },
    },
  };
  return {
    state,
    events: [
      {
        type: 'BattleStarted',
        seat: me.seat,
        params: {
          context: ctx.context,
          spaceId: ctx.spaceId,
          first: attackerSide,
          opponent: ctx.opponent.monsterId ?? '',
        },
      },
    ],
  };
}

/** Whichever side still has a pending pick picks next. */
function pendingSide(bt: BattleData): 'a' | 'b' {
  return bt.pending.attack === null ? bt.attackerSide : other(bt.attackerSide);
}

/**
 * The battle picks `seat` may take now, as `{ side, pick }` pairs. Non-picking
 * seats get `[]`. The secret is never offered once that side has used it.
 */
export function legalBattlePicks(
  state: GameState,
  seat: number,
): Array<{ side: 'a' | 'b'; pick: AttackPick | DefensePick }> {
  if (state.phase.kind !== 'battle') return [];
  const bt = state.phase.battle;
  const side = pendingSide(bt);
  const c = combatantOf(bt, side);
  if (c.kind !== 'player' || c.seat !== seat) return [];
  if (side === bt.attackerSide) {
    const picks: AttackPick[] = c.secretUsed
      ? ['attack', 'strike']
      : ['attack', 'strike', 'secret'];
    return picks.map((pick) => ({ side, pick }));
  }
  const picks: DefensePick[] = c.secretUsed
    ? ['defend', 'counter']
    : ['defend', 'counter', 'secret'];
  return picks.map((pick) => ({ side, pick }));
}

/** Validate `side`/`pick` for the current half-exchange; throws when illegal. */
function validatePick(state: GameState, side: 'a' | 'b', pick: AttackPick | DefensePick): void {
  if (state.phase.kind !== 'battle') {
    throw new IllegalActionError('battlePick outside battle');
  }
  const bt = state.phase.battle;
  if (side !== pendingSide(bt)) {
    throw new IllegalActionError('battlePick: side does not have the pending pick');
  }
  const c = combatantOf(bt, side);
  if (c.kind === 'player') {
    const legal = legalBattlePicks(state, c.seat!).some((p) => p.pick === pick && p.side === side);
    if (!legal) {
      throw new IllegalActionError(`battlePick: ${pick} not offered to side ${side}`);
    }
  }
  // monster sides: only the structural check above applies — the engine draws
  // the monster's actual pick from rng and ignores the caller's `pick` value
}

/**
 * Monster/town-guardian picks, drawn from the engine rng (state written back).
 * Attacking: 60% attack / 40% strike; defending: 50/50 defend/counter; never secret.
 */
function drawMonsterPick(state: GameState, role: 'attack' | 'defense'): AttackPick | DefensePick {
  const [f, next] = nextFloat(state.rng);
  state.rng = next;
  if (role === 'attack') return f < 0.6 ? 'attack' : 'strike';
  return f < 0.5 ? 'defend' : 'counter';
}

/** Pickpocket: steal 15% of a player target's gold (0 vs monsters), credited to the thief. */
function stealFrom(state: GameState, thief: Combatant, target: Combatant): number {
  let stolen = 0;
  if (target.kind === 'player') {
    const t = state.players[target.seat!]!;
    stolen = Math.floor(t.gold * 0.15);
    t.gold -= stolen;
  }
  if (thief.kind === 'player' && stolen > 0) state.players[thief.seat!]!.gold += stolen;
  return stolen;
}

/** Record a pick; when both attack and defense are set, resolve the half. */
export function applyBattlePick(
  state: GameState,
  side: 'a' | 'b',
  pick: AttackPick | DefensePick,
): RuleResult {
  validatePick(state, side, pick);
  const bt = state.phase.kind === 'battle' ? state.phase.battle : null;
  if (!bt) throw new IllegalActionError('battlePick outside battle');

  const role: 'attack' | 'defense' = side === bt.attackerSide ? 'attack' : 'defense';
  const actor = combatantOf(bt, side);
  if (actor.kind === 'monster') {
    // monsters pick inside the engine: draw from rng (state written back),
    // 60/40 attack/strike when attacking, 50/50 defend/counter when defending
    pick = drawMonsterPick(state, role);
  }
  if (pick === 'secret') actor.secretUsed = true;
  if (role === 'attack') bt.pending.attack = pick as AttackPick;
  else bt.pending.defense = pick as DefensePick;
  const events: GameEvent[] = [
    {
      type: 'BattlePick',
      seat: seatOf(actor),
      params: { side, pick, role },
    },
  ];

  if (bt.pending.attack === null || bt.pending.defense === null) {
    return { state, events }; // wait for the other side's pick
  }
  return resolvePendingHalf(state, events);
}

/** Both picks are in: resolve the half, then advance half/exchange or end. */
function resolvePendingHalf(state: GameState, events: GameEvent[]): RuleResult {
  const bt = state.phase.kind === 'battle' ? state.phase.battle : null;
  if (!bt) throw new Error('resolvePendingHalf outside battle');
  const atk = bt.attackerSide;
  const def = other(atk);
  const attacker = combatantOf(bt, atk);
  const defender = combatantOf(bt, def);
  const atkPick = bt.pending.attack!;
  const defPick = bt.pending.defense!;
  bt.pending = { attack: null, defense: null };

  // pre-existing halveNext protects this half and is consumed by it
  const atkHalved = attacker.buffs.halveNext;
  const defHalved = defender.buffs.halveNext;
  attacker.buffs.halveNext = false;
  defender.buffs.halveNext = false;

  if (atkPick === 'secret' || defPick === 'secret') {
    applySecretHalf(state, bt, atk, def, attacker, defender, atkPick, defPick, events);
  } else {
    const variance = varianceDraw(state);
    const dmg = resolveHalf(attacker, defender, atkPick, defPick, variance);
    if (defender.buffs.ironSkin && dmg.toDefender > 0)
      dmg.toDefender = Math.max(1, Math.floor(dmg.toDefender / 2));
    if (attacker.buffs.ironSkin && dmg.toAttacker > 0)
      dmg.toAttacker = Math.max(1, Math.floor(dmg.toAttacker / 2));
    if (defHalved && dmg.toDefender > 0)
      dmg.toDefender = Math.max(1, Math.floor(dmg.toDefender / 2));
    if (atkHalved && dmg.toAttacker > 0)
      dmg.toAttacker = Math.max(1, Math.floor(dmg.toAttacker / 2));
    takeDamage(attacker, dmg.toAttacker, state, defender);
    takeDamage(defender, dmg.toDefender, state, attacker);
    events.push(damageEvent(bt, attacker, defender, dmg));
  }

  if (bt.half === 2) {
    const poisonPct = Number(ITEM_BY_ID.poisonBlade!.effect.poisonPct);
    for (const poisoned of [bt.a, bt.b]) {
      if (!poisoned.buffs.poison) continue;
      const amount = Math.max(1, Math.ceil((poisoned.stats.maxHp * poisonPct) / 100));
      takeDamage(poisoned, amount);
      events.push({
        type: 'PoisonDamage',
        seat: seatOf(poisoned),
        params: { amount, exchange: bt.exchange },
      });
    }
  }
  const koSide = bt.a.hp <= 0 ? 'a' : bt.b.hp <= 0 ? 'b' : null;
  if (koSide) {
    syncPlayers(state, bt);
    return endBattle(state, bt, koSide === 'a' ? 'bWin' : 'aWin', events);
  }

  if (bt.half === 1) {
    bt.half = 2;
    bt.attackerSide = def; // the other side acts first in the second half
  } else {
    bt.half = 1;
    bt.attackerSide = atk;
    bt.exchange += 1;
  }
  if (bt.exchange > 3) {
    syncPlayers(state, bt);
    return endBattle(state, bt, 'draw', events);
  }
  syncPlayers(state, bt);
  return { state, events };
}

/** Push battle hp back onto the seat players (if any). */
function syncPlayers(state: GameState, bt: BattleData): void {
  for (const c of [bt.a, bt.b]) {
    if (c.kind === 'player') state.players[c.seat!]!.hp = c.hp;
  }
}

function damageEvent(
  bt: BattleData,
  attacker: Combatant,
  defender: Combatant,
  dmg: HalfDamage,
): GameEvent {
  return {
    type: 'DamageDealt',
    seat: attacker.kind === 'player' ? attacker.seat : null,
    params: {
      attacker: attacker.monsterId ?? attacker.seat ?? -1,
      defender: defender.monsterId ?? defender.seat ?? -1,
      toAttacker: dmg.toAttacker,
      toDefender: dmg.toDefender,
      exchange: bt.exchange,
      half: bt.half,
    },
  };
}

function secretEvent(
  seat: number | null,
  side: 'a' | 'b',
  secret: string,
  extra: Record<string, number>,
): GameEvent {
  return {
    type: 'SecretUsed',
    seat,
    params: { side, secret, ...extra },
  };
}

/**
 * Secret half: the matrix is skipped and each secret resolves exactly as its
 * text says. A secret picked as the defender replaces the defense.
 */
function applySecretHalf(
  state: GameState,
  bt: BattleData,
  atk: 'a' | 'b',
  def: 'a' | 'b',
  attacker: Combatant,
  defender: Combatant,
  atkPick: AttackPick,
  defPick: DefensePick,
  events: GameEvent[],
): HalfDamage {
  const atkSecret = atkPick === 'secret' ? secretOf(state, attacker) : null;
  const defSecret = defPick === 'secret' ? secretOf(state, defender) : null;
  if (atkSecret && defPick === 'secret') attacker.secretUsed = false;

  // --- defender secrets replace the defense ---
  if (defSecret === 'bulwark') {
    const variance = varianceDraw(state);
    const incoming = damage(attacker.stats.atk, defender.stats.def, BALANCE.attackMult, variance);
    const reflect = Math.max(1, Math.round(incoming * 0.5));
    takeDamage(attacker, reflect, state, defender); // the knight takes 0 this half
    events.push(secretEvent(seatOf(defender), def, 'bulwark', { reflected: reflect }));
    return { toAttacker: reflect, toDefender: 0 };
  }
  if (defSecret === 'sanctuary') {
    const healed = sanctuaryHeal(defender);
    events.push(secretEvent(seatOf(defender), def, 'sanctuary', { healed }));
    return { toAttacker: 0, toDefender: 0 };
  }
  if (defSecret === 'firestorm') {
    const variance = varianceDraw(state);
    const dealt = magicDamage(defender.stats.mag, attacker.stats.def, variance);
    takeDamage(attacker, dealt, state, defender); // ignores the attacker's pick entirely
    events.push(secretEvent(seatOf(defender), def, 'firestorm', { damage: dealt }));
    return { toAttacker: dealt, toDefender: 0 };
  }
  if (defSecret === 'pickpocket') {
    const stolen = stealFrom(state, defender, attacker);
    events.push(secretEvent(seatOf(defender), def, 'pickpocket', { stolen }));
    // then resolve the attacker's pick as attack×counter
    const variance = varianceDraw(state);
    const dmg = resolveHalf(
      attacker,
      defender,
      atkPick === 'strike' ? 'strike' : 'attack',
      'counter',
      variance,
    );
    takeDamage(attacker, dmg.toAttacker, state, defender);
    takeDamage(defender, dmg.toDefender, state, attacker);
    events.push(damageEvent(bt, attacker, defender, dmg));
    return dmg;
  }

  // --- attacker secrets ---
  if (atkSecret === 'bulwark') {
    // guards this half: take 0 and reflect 50% of the attack×counter baseline
    const variance = varianceDraw(state);
    const incoming = damage(attacker.stats.atk, defender.stats.def, BALANCE.attackMult, variance);
    const reflect = Math.max(1, Math.round(incoming * 0.5));
    takeDamage(defender, reflect, state, attacker);
    events.push(secretEvent(seatOf(attacker), atk, 'bulwark', { reflected: reflect }));
    return { toAttacker: 0, toDefender: reflect };
  }
  if (atkSecret === 'firestorm') {
    const variance = varianceDraw(state);
    const dealt = magicDamage(attacker.stats.mag, defender.stats.def, variance);
    takeDamage(defender, dealt, state, attacker); // ignores the defender's pick
    events.push(secretEvent(seatOf(attacker), atk, 'firestorm', { damage: dealt }));
    return { toAttacker: 0, toDefender: dealt };
  }
  if (atkSecret === 'pickpocket') {
    const stolen = stealFrom(state, attacker, defender);
    events.push(secretEvent(seatOf(attacker), atk, 'pickpocket', { stolen }));
    const variance = varianceDraw(state);
    const dmg = resolveHalf(attacker, defender, 'attack', 'counter', variance);
    takeDamage(attacker, dmg.toAttacker, state, defender);
    takeDamage(defender, dmg.toDefender, state, attacker);
    events.push(damageEvent(bt, attacker, defender, dmg));
    return dmg;
  }
  if (atkSecret === 'sanctuary') {
    const healed = sanctuaryHeal(attacker);
    events.push(secretEvent(seatOf(attacker), atk, 'sanctuary', { healed }));
    return { toAttacker: 0, toDefender: 0 };
  }

  // both sides picked secret (defender non-class secret): the attacker's secret is refunded
  events.push(secretEvent(seatOf(defender), def, defSecret ?? '', {}));
  return { toAttacker: 0, toDefender: 0 };
}

const seatOf = (c: Combatant): number | null => (c.kind === 'player' ? c.seat : null);

/** Sanctuary: heal 40% maxHp (capped at maxHp) and set halveNext. */
function sanctuaryHeal(c: Combatant): number {
  const heal = Math.min(Math.round(c.stats.maxHp * 0.4), c.stats.maxHp - c.hp);
  c.hp += heal;
  c.buffs.halveNext = true;
  return heal;
}

/** Class secret of a player combatant; monsters never cast secrets. */
function secretOf(state: GameState, c: Combatant): string {
  if (c.kind === 'player') return CLASSES[state.players[c.seat!]!.classId].secret;
  return '';
}

/** End the battle: rewards/penalty, then hand the turn to the next seat. */
function endBattle(
  state: GameState,
  bt: BattleData,
  result: 'aWin' | 'bWin' | 'draw',
  events: GameEvent[],
): RuleResult {
  const winner = result === 'aWin' ? bt.a : result === 'bWin' ? bt.b : null;
  const loser = result === 'aWin' ? bt.b : result === 'bWin' ? bt.a : null;
  if (winner && loser) onBattleEnd(state, bt, winner, loser, events);
  events.push({ type: 'BattleEnded', seat: winner ? seatOf(winner) : null, params: { result } });
  if (state.phase.kind === 'levelUp') return { state, events };
  return endTurn(state, events);
}

/**
 * Battle-end hook for town ownership, monster rewards, leveling, and KO penalties.
 * Task 7 adds PvP reward handling.
 */
function onBattleEnd(
  state: GameState,
  bt: BattleData,
  winner: Combatant,
  loser: Combatant,
  events: GameEvent[],
): void {
  if (bt.context === 'town' && winner.kind === 'player') {
    const town = state.towns.find((item) => item.spaceId === bt.spaceId);
    if (town) {
      const previous = town.owner;
      town.owner = winner.seat;
      events.push({
        type: previous === null ? 'TownClaimed' : 'TownFlipped',
        seat: winner.seat,
        params: { spaceId: bt.spaceId, previousOwner: previous ?? -1 },
      });
      if (previous !== null && previous !== winner.seat)
        state.stats.townFlips[bt.spaceId] = (state.stats.townFlips[bt.spaceId] ?? 0) + 1;
    }
  }
  if (winner.kind === 'player' && loser.kind === 'monster' && loser.monsterId) {
    const def = MONSTERS[loser.monsterId];
    if (def) {
      const p = state.players[winner.seat!]!;
      p.gold += def.gold;
      const { grantXp } = leveling;
      const gained = grantXp(state, p.seat, def.xp, 'endTurn');
      events.push(...gained.events);
      events.push({ type: 'GoldGained', seat: p.seat, params: { amount: def.gold } });
    }
  }
  // PvP rewards are added by Task 7.

  // KO penalty applies to any KO'd player regardless of context
  if (loser.kind === 'player') applyKoPenalty(state, loser.seat!, events);
}

/** KO'd player: lose deathGoldLossPct% gold, castle, full hp, skip next turn. */
export function applyKoPenalty(state: GameState, seat: number, events: GameEvent[]): void {
  const p = state.players[seat]!;
  const lost = Math.floor((p.gold * BALANCE.deathGoldLossPct) / 100);
  p.gold -= lost;
  p.pos = state.board.castleId;
  p.hp = p.stats.maxHp;
  p.skipTurns += 1;
  state.stats.kos[seat] = (state.stats.kos[seat] ?? 0) + 1;
  events.push({
    type: 'PlayerKO',
    seat,
    params: { goldLost: lost, pos: state.board.castleId, skipTurns: p.skipTurns },
  });
  // This task owns town flips and monster rewards; Task 7 adds PvP respawn flavor.
}
