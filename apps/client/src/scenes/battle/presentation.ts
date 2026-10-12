import type { Combatant, GameEvent, GameState } from '@dice-bandits/engine';
import { damageTargets, type DamageEvent } from './effects';

type Side = 'a' | 'b';

export type BattleBeat = {
  kind: 'reveal' | 'anticipation' | 'lunge' | 'impact' | 'damage' | 'drain' | 'result';
  duration: number;
  targets: Array<{ side: Side; amount: number; fromHp: number; toHp: number }>;
  result: 'nextHalf' | 'nextExchange' | 'win' | 'loss' | 'draw' | null;
  attacker?: Side | null;
  outcome?: 'hit' | 'miss' | 'blocked' | 'countered' | 'mutual' | null;
  revealed?: Array<{ side: Side; secretId: string }>;
  winner?: Side | null;
  commands?: Partial<Record<Side, 'attack' | 'strike' | 'defend' | 'counter' | 'secret'>>;
  skills?: Partial<Record<Side, 'bulwark' | 'pickpocket' | 'firestorm' | 'sanctuary'>>;
  stolenGold?: Partial<Record<Side, number>>;
  /** Changed display maxima, reconciled with HP at drain/static result only. */
  maxHp?: Partial<Record<Side, number>>;
};

const SIDES = ['a', 'b'] as const;
const TIMINGS: ReadonlyArray<readonly [BattleBeat['kind'], number]> = [
  ['reveal', 200],
  ['anticipation', 260],
  ['lunge', 180],
  ['impact', 90],
  ['damage', 430],
  ['drain', 300],
  ['result', 540],
];

const identity = (fighter: Combatant): string | number | null =>
  fighter.kind === 'player' ? fighter.seat : fighter.monsterId;
const opposite = (side: Side): Side => (side === 'a' ? 'b' : 'a');
const positive = (value: string | number | undefined): number => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};
const clampHp = (hp: number, maxHp: number): number => Math.max(0, Math.min(maxHp, hp));

/** Ordered fighter ownership, not the reusable presentation sides a/b. */
export function battleIdentity(state: GameState): string | null {
  if (state.phase.kind !== 'battle') return null;
  const battle = state.phase.battle;
  return JSON.stringify([
    battle.context,
    battle.spaceId,
    ...SIDES.map((side) => {
      const fighter = battle[side];
      return [fighter.kind, fighter.seat, fighter.monsterId];
    }),
  ]);
}

/** Coalesced bot batches lack per-battle snapshots. Old beats cannot own a new HUD. */
export function crossesBattleBoundary(
  previous: GameState,
  next: GameState,
  events: readonly GameEvent[],
): boolean {
  return (
    events.some((event) => event.type === 'BattleStarted') ||
    (next.phase.kind === 'battle' && battleIdentity(previous) !== battleIdentity(next))
  );
}

/**
 * Pure event-to-presentation adapter. Pending picks are deliberately never read.
 * `win`/`loss` are side a's perspective; consumers use the winner's name.
 * R2-C passes reduced || speed <= 0 and owns all waits/cancellation/online detachment.
 */
export function planBattle(
  previous: GameState,
  next: GameState,
  events: readonly GameEvent[],
  mode: 'human' | 'bot' | 'online',
  reduced: boolean,
): BattleBeat[] {
  if (crossesBattleBoundary(previous, next, events)) return [];
  const before = previous.phase.kind === 'battle' ? previous.phase.battle : null;
  const after = next.phase.kind === 'battle' ? next.phase.battle : null;
  const battle = before ?? after;
  if (!battle) return [];

  const ids = { a: identity(battle.a), b: identity(battle.b) };
  const sideOf = (id: string | number | undefined): Side | null =>
    id === undefined
      ? null
      : (SIDES.find((side) => ids[side] !== null && String(ids[side]) === String(id)) ?? null);
  const fromHp = {
    a: clampHp(battle.a.hp, battle.a.stats.maxHp),
    b: clampHp(battle.b.hp, battle.b.stats.maxHp),
  };
  const presented = { ...fromHp };
  const amounts = { a: 0, b: 0 };
  const healed = new Set<Side>();
  const revealed: NonNullable<BattleBeat['revealed']> = [];
  const commands: NonNullable<BattleBeat['commands']> = {};
  const skills: NonNullable<BattleBeat['skills']> = {};
  const stolenGold: NonNullable<BattleBeat['stolenGold']> = {};
  let attacker: Side | null = null;
  let resolved = false;
  let blocked = false;
  let hasConsequence = false;
  let ended: string | number | undefined;
  const addDamage = (side: Side, amount: number): void => {
    amounts[side] += amount;
    presented[side] = clampHp(presented[side] - amount, battle[side].stats.maxHp);
  };

  // Only this resolved batch can publish a command. Role and seat validation
  // prevents foreign/redacted picks from selecting a cosmetic action.
  for (const event of events) {
    const { side, pick, role } = event.params;
    if (event.type !== 'BattlePick' || (side !== 'a' && side !== 'b')) continue;
    const fighter = battle[side];
    if (event.seat !== (fighter.kind === 'player' ? fighter.seat : null)) continue;
    const attacking = side === battle.attackerSide;
    if (role !== (attacking ? 'attack' : 'defense')) continue;
    if (
      (attacking && (pick === 'attack' || pick === 'strike')) ||
      (!attacking && (pick === 'defend' || pick === 'counter'))
    )
      commands[side] = pick;
  }
  for (const event of events) {
    const params = event.params;
    if (event.type === 'DamageDealt') {
      const actor = sideOf(params.attacker);
      const defender = sideOf(params.defender);
      if (!actor || !defender || actor === defender) continue;
      attacker ??= actor;
      resolved = hasConsequence = true;
      blocked ||= params.outcome === 'blocked' || params.outcome === 'guard';
      const damage: DamageEvent = {
        attacker: params.attacker!,
        defender: params.defender!,
        toAttacker: positive(params.toAttacker),
        toDefender: positive(params.toDefender),
      };
      for (const target of damageTargets(damage, ids.a!, ids.b!))
        addDamage(target.side, target.amount);
    } else if (event.type === 'SecretUsed') {
      const side = params.side;
      if (
        (side !== 'a' && side !== 'b') ||
        typeof params.secret !== 'string' ||
        !params.secret ||
        battle[side].kind !== 'player' ||
        battle[side].seat !== event.seat
      )
        continue;
      resolved = hasConsequence = true;
      revealed.push({ side, secretId: params.secret });
      if (
        params.secret === 'bulwark' ||
        params.secret === 'pickpocket' ||
        params.secret === 'firestorm' ||
        params.secret === 'sanctuary'
      ) {
        skills[side] = params.secret;
        commands[side] = 'secret';
        if (params.secret === 'pickpocket' && positive(params.stolen) > 0)
          stolenGold[side] = positive(params.stolen);
      }
      // These are already-resolved engine event amounts, not combat calculations.
      addDamage(opposite(side), positive(params.damage) + positive(params.reflected));
      const healing = positive(params.healed);
      if (healing > 0) {
        healed.add(side);
        presented[side] = clampHp(presented[side] + healing, battle[side].stats.maxHp);
      }
      blocked ||= params.secret === 'bulwark' || params.secret === 'sanctuary';
    } else if (event.type === 'PoisonDamage') {
      const side =
        SIDES.find(
          (candidate) =>
            battle[candidate].kind === 'player' && battle[candidate].seat === event.seat,
        ) ??
        (event.seat === null
          ? SIDES.find((candidate) => battle[candidate].kind === 'monster')
          : undefined);
      if (!side) continue;
      resolved = hasConsequence = true;
      addDamage(side, positive(params.amount));
    } else if (event.type === 'BattleEnded') {
      if (params.result !== 'aWin' && params.result !== 'bWin' && params.result !== 'draw')
        continue;
      ended = params.result;
      resolved = true;
    }
  }
  if (!resolved) return [];
  // Secret events name their caster, not necessarily the original attacking side.
  if (hasConsequence) attacker ??= battle.attackerSide;

  const outcome: BattleBeat['outcome'] =
    amounts.a > 0 && amounts.b > 0
      ? 'mutual'
      : attacker && amounts[attacker] > 0
        ? 'countered'
        : amounts.a > 0 || amounts.b > 0
          ? 'hit'
          : !hasConsequence
            ? null
            : blocked
              ? 'blocked'
              : 'miss';
  const result: BattleBeat['result'] =
    ended === 'aWin'
      ? 'win'
      : ended === 'bWin'
        ? 'loss'
        : ended === 'draw'
          ? 'draw'
          : before && after && after.exchange > before.exchange
            ? 'nextExchange'
            : before && after && after.half !== before.half
              ? 'nextHalf'
              : null;
  const winner: BattleBeat['winner'] = ended === 'aWin' ? 'a' : ended === 'bWin' ? 'b' : null;
  const endpoint = (side: Side, final: boolean): { hp: number; maxHp: number } => {
    // Only a combat KO stays at zero during animation; static playback uses
    // respawn HP. All non-KO player endpoints use next.players after battle end.
    const fighter = after?.[side];
    const combatKo = winner !== null && winner !== side && presented[side] === 0;
    const player =
      !fighter && battle[side].kind === 'player' && (final || !combatKo)
        ? next.players.find((value) => value.seat === battle[side].seat)
        : undefined;
    return {
      hp: fighter
        ? clampHp(fighter.hp, fighter.stats.maxHp)
        : player
          ? clampHp(player.hp, player.stats.maxHp)
          : presented[side],
      maxHp: fighter?.stats.maxHp ?? player?.stats.maxHp ?? battle[side].stats.maxHp,
    };
  };
  const target = (side: Side, final: boolean): BattleBeat['targets'][number] => ({
    side,
    amount: amounts[side],
    fromHp: fromHp[side],
    toHp: endpoint(side, final).hp,
  });
  const maxHp = Object.fromEntries(
    SIDES.map((side) => [side, endpoint(side, reduced).maxHp] as const).filter(
      ([side, maximum]) => maximum !== battle[side].stats.maxHp,
    ),
  );
  const maxChange = Object.keys(maxHp).length > 0 ? { maxHp } : {};
  const damageSides = SIDES.filter((side) => amounts[side] > 0);
  // HP-only reconciliation carries amount=0 in drain/static, never as a hit.
  const drainSides = SIDES.filter(
    (side) => amounts[side] > 0 || healed.has(side) || fromHp[side] !== target(side, false).toHp,
  );
  if (reduced) {
    const finalTargets = SIDES.map((side) => target(side, true)).filter(
      (value) => value.amount > 0 || healed.has(value.side) || value.fromHp !== value.toHp,
    );
    return [
      {
        kind: 'result',
        duration: 0,
        targets: finalTargets,
        ...maxChange,
        attacker,
        outcome,
        revealed,
        result,
        winner,
      },
    ];
  }
  const heavy = attacker !== null && commands[attacker] === 'strike';
  const metadata = {
    ...(Object.keys(commands).length ? { commands } : {}),
    ...(Object.keys(skills).length ? { skills } : {}),
    ...(Object.keys(stolenGold).length ? { stolenGold } : {}),
  };
  return TIMINGS.map(([kind, baseDuration]): BattleBeat => {
    const duration =
      heavy && kind === 'anticipation' ? 320 : heavy && kind === 'result' ? 480 : baseDuration;
    return {
      kind,
      duration: mode === 'human' ? duration : Math.floor((duration * 600) / 2000),
      ...metadata,
      targets:
        kind === 'damage'
          ? damageSides.map((side) => target(side, false))
          : kind === 'drain'
            ? drainSides.map((side) => target(side, false))
            : [],
      ...(kind === 'drain' ? maxChange : {}),
      result: kind === 'result' ? result : null,
      ...(kind === 'reveal' && revealed.length > 0 ? { revealed } : {}),
      ...(kind === 'anticipation' || kind === 'lunge' || kind === 'impact' ? { attacker } : {}),
      ...(kind === 'lunge' || kind === 'impact' || kind === 'damage' ? { outcome } : {}),
      ...(kind === 'result' ? { winner } : {}),
    };
  });
}
