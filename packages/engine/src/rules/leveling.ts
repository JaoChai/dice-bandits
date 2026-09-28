import type { GameEvent, GameState, StepResult } from '../types';
import { BALANCE, CLASSES, PERKS } from '../data/index';
import { shuffle } from '../rng';

export function grantXp(
  state: GameState,
  seat: number,
  xp: number,
  then: 'endTurn' | 'continue' = 'endTurn',
): StepResult {
  const player = state.players[seat]!;
  player.xp += xp;
  const events: GameEvent[] = [{ type: 'XpGained', seat, params: { amount: xp } }];
  if (player.level >= BALANCE.levelCap || player.xp < (BALANCE.xpToLevel[player.level] ?? Infinity))
    return { state, events };
  const [shuffled, rng] = shuffle(
    state.rng,
    PERKS.map((perk) => perk.id),
  );
  state.rng = rng;
  const choices = shuffled.slice(0, 3);
  const growth = CLASSES[player.classId].growth;
  for (const key of ['maxHp', 'atk', 'def', 'spd', 'mag'] as const)
    player.stats[key] += growth[key];
  player.level += 1;
  player.hp = player.stats.maxHp;
  state.phase = { kind: 'levelUp', seat, choices, then };
  events.push({ type: 'LevelUp', seat, params: { level: player.level } });
  return { state, events };
}

export function pickPerk(state: GameState, seat: number, perk: string): StepResult {
  if (
    state.phase.kind !== 'levelUp' ||
    state.phase.seat !== seat ||
    !state.phase.choices.includes(perk)
  )
    throw new Error('perk not offered');
  const then = state.phase.then;
  const player = state.players[seat]!;
  player.perks.push(perk);
  if (perk === 'hpUp') {
    player.stats.maxHp += 10;
    player.hp += 10;
  } else if (perk === 'atkUp') player.stats.atk += 3;
  else if (perk === 'defUp') player.stats.def += 3;
  else if (perk === 'spdUp') player.stats.spd += 3;
  else if (perk === 'magUp') player.stats.mag += 3;
  state.phase = then === 'endTurn' ? { kind: 'endOfTurn' } : { kind: 'awaitRoll' };
  return { state, events: [{ type: 'PerkChosen', seat, params: { perk } }] };
}
