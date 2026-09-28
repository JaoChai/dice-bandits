import type { GameEvent } from '@dice-bandits/engine';
import { createRoom } from './model';
import type { Room } from './model';
import { viewForSeat } from './play';
import { roomStep } from './roomStep';
import type { Outbound, RoomStepResult } from './roomStep';

export interface RoomSimulationOptions {
  games: number;
  seed: string;
}

export interface RoomSimReport {
  games: number;
  finished: number;
  crashes: number;
  stuck: number;
  alarmInvariantViolations: number;
  maxInputs: number;
  avgInputs: number;
}

const INPUT_LIMIT = 5_000;
const ALARM_STREAK_LIMIT = 50;

/** True when the reducer schedules work in the past or an invalid immediate alarm. */
export function hasAlarmInvariantViolation(result: RoomStepResult, now: number): boolean {
  return (
    result.nextAlarmAt !== null &&
    (result.nextAlarmAt < now ||
      (result.nextAlarmAt === now &&
        !(result.room?.pendingBotWork === true && result.room.botRetryAt === null)))
  );
}

function seededRandom(seed: string): () => number {
  let state = 0x811c9dc5;
  for (const character of seed) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 0x01000193);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function leaksRedaction(out: Outbound[], room: Room | null): boolean {
  for (const { to, msg } of out) {
    if (typeof to !== 'number') continue;
    if (msg.type === 'view') {
      if (msg.state.config.seed !== '' || msg.state.rng.some((value) => value !== 0)) return true;
      const full = room?.game;
      if (full?.phase.kind !== 'battle' || msg.state.phase.kind !== 'battle') continue;
      const battle = full.phase.battle;
      for (const [side, role] of [
        ['a', battle.attackerSide === 'a' ? 'attack' : 'defense'],
        ['b', battle.attackerSide === 'b' ? 'attack' : 'defense'],
      ] as const) {
        const pick = role === 'attack' ? battle.pending.attack : battle.pending.defense;
        const combatant = side === 'a' ? battle.a : battle.b;
        if (pick === null || combatant.seat === msg.you) continue;
        const viewCombatant = side === 'a' ? msg.state.phase.battle.a : msg.state.phase.battle.b;
        if (
          (role === 'attack'
            ? msg.state.phase.battle.pending.attack
            : msg.state.phase.battle.pending.defense) !== null ||
          msg.opponentPicked !== true ||
          (pick === 'secret' && viewCombatant.secretUsed)
        )
          return true;
      }
    } else if (msg.type === 'events' && room?.game?.phase.kind === 'battle') {
      const battle = room.game.phase.battle;
      for (const [side, role] of [
        ['a', battle.attackerSide === 'a' ? 'attack' : 'defense'],
        ['b', battle.attackerSide === 'b' ? 'attack' : 'defense'],
      ] as const) {
        const pick = role === 'attack' ? battle.pending.attack : battle.pending.defense;
        const combatant = side === 'a' ? battle.a : battle.b;
        if (pick === null || combatant.seat === to) continue;
        const event = (msg.events as GameEvent[]).findLast(
          (candidate) => candidate.type === 'BattlePick' && candidate.params.role === role,
        );
        if (event && event.params.pick !== 'hidden') return true;
      }
    }
  }
  return false;
}

function recordResult(result: RoomStepResult, now: number, report: RoomSimReport): void {
  if (hasAlarmInvariantViolation(result, now)) report.alarmInvariantViolations += 1;
  if (leaksRedaction(result.out, result.room)) report.crashes += 1;
}

export function runRoomSimulation(options: RoomSimulationOptions): RoomSimReport {
  if (!Number.isInteger(options.games) || options.games < 1)
    throw new Error('--games must be a positive integer');
  const report: RoomSimReport = {
    games: options.games,
    finished: 0,
    crashes: 0,
    stuck: 0,
    alarmInvariantViolations: 0,
    maxInputs: 0,
    avgInputs: 0,
  };
  let totalInputs = 0;

  for (let gameIndex = 0; gameIndex < options.games; gameIndex += 1) {
    const random = seededRandom(`${options.seed}${gameIndex}`);
    const roomCode = `S${String(gameIndex).padStart(4, '0')}`;
    let room: Room | null = createRoom(roomCode, 'Player 1', `hash-${gameIndex}`, 0);
    let now = 0;
    let nextAlarmAt: number | null;
    let inputs = 0;
    let consecutiveAlarms = 0;

    try {
      const joinCount = Math.floor(random() * 4);
      for (let index = 0; index < joinCount; index += 1) {
        const joined = roomStep(
          room!,
          {
            kind: 'msg',
            seat: null,
            conn: `seat-${index + 1}`,
            msg: { type: 'join', name: `Player ${index + 2}` },
            newTokenHash: `hash-${gameIndex}-${index + 1}`,
          },
          now,
        );
        room = joined.room;
        nextAlarmAt = joined.nextAlarmAt;
        inputs += 1;
        recordResult(joined, now, report);
      }
      const started = roomStep(
        room!,
        {
          kind: 'msg',
          seat: 0,
          conn: 'seat-0',
          msg: { type: 'start' },
          seed: `${options.seed}${gameIndex}`,
        },
        now,
      );
      room = started.room;
      nextAlarmAt = started.nextAlarmAt;
      inputs += 1;
      recordResult(started, now, report);

      while (room?.status !== 'finished' && inputs < INPUT_LIMIT) {
        // Durable Objects fire every overdue alarm before delivering the next socket input.
        now += Math.floor(random() * 20_001);
        let alarmStreak = 0;
        while (room !== null && nextAlarmAt !== null && nextAlarmAt <= now) {
          const alarmTime = nextAlarmAt;
          const fired = roomStep(room, { kind: 'alarm' }, alarmTime);
          room = fired.room;
          nextAlarmAt = fired.nextAlarmAt;
          inputs += 1;
          alarmStreak += 1;
          consecutiveAlarms += 1;
          recordResult(fired, alarmTime, report);
          if (consecutiveAlarms > ALARM_STREAK_LIMIT) {
            report.alarmInvariantViolations += 1;
            room = null;
            break;
          }
          if (inputs >= INPUT_LIMIT || alarmStreak > ALARM_STREAK_LIMIT) break;
        }
        if (room === null || room.status === 'finished' || inputs >= INPUT_LIMIT) break;

        const seat = Math.floor(random() * room.seats.length);
        const choice = random();
        let input: Parameters<typeof roomStep>[1];
        if (choice < 0.12) {
          input = { kind: 'disconnect', seat, conn: `seat-${seat}` };
        } else if (choice < 0.24) {
          input = { kind: 'connect', seat, conn: `seat-${seat}` };
        } else if (choice < 0.34) {
          input = { kind: 'msg', seat, conn: `seat-${seat}`, msg: { type: 'reclaim' } };
        } else if (choice < 0.44) {
          const takeover = room.seats.find(
            (candidate) => candidate.kind === 'human' && candidate.controller === 'botTakeover',
          );
          input = takeover
            ? {
                kind: 'msg',
                seat: null,
                conn: 'visitor',
                msg: { type: 'claim', seat: takeover.seat },
                newTokenHash: `claim-${gameIndex}-${inputs}-${random()}`,
              }
            : { kind: 'connect', seat, conn: `seat-${seat}` };
        } else {
          const view = viewForSeat(room, seat);
          const legal = view.type === 'view' ? view.legal : [];
          const phase = room.game?.phase;
          const actions =
            phase?.kind === 'battle'
              ? legal.filter((action) => action.type === 'battlePick')
              : legal;
          const battleActorMatches =
            phase?.kind !== 'battle' ||
            (() => {
              const battle = phase.battle;
              const side =
                battle.pending.attack === null
                  ? battle.attackerSide
                  : battle.attackerSide === 'a'
                    ? 'b'
                    : 'a';
              const actor = side === 'a' ? battle.a : battle.b;
              return actor.kind === 'player' && actor.seat === seat;
            })();
          const seatState = room.seats.find((candidate) => candidate.seat === seat);
          input =
            actions.length > 0 &&
            battleActorMatches &&
            seatState?.kind === 'human' &&
            seatState.controller === 'player'
              ? {
                  kind: 'msg',
                  seat,
                  conn: `seat-${seat}`,
                  msg: {
                    type: 'action',
                    action: actions[Math.floor(random() * actions.length)]!,
                    turn: room.turn,
                  },
                }
              : { kind: 'connect', seat, conn: `seat-${seat}` };
        }
        const stepped = roomStep(room, input, now);
        room = stepped.room;
        nextAlarmAt = stepped.nextAlarmAt;
        inputs += 1;
        consecutiveAlarms = 0;
        recordResult(stepped, now, report);
      }
    } catch {
      report.crashes += 1;
    }

    if (room?.status === 'finished') report.finished += 1;
    else report.stuck += 1;
    totalInputs += inputs;
    report.maxInputs = Math.max(report.maxInputs, inputs);
  }
  report.avgInputs = totalInputs / (options.games || 1);
  return report;
}

function cliArgs(args: string[]): RoomSimulationOptions {
  let games = 200;
  let seed = 'room-sim-';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--games') games = Number(args[++index]);
    if (args[index] === '--seed') seed = args[++index] ?? '';
  }
  if (!Number.isInteger(games) || games < 1) throw new Error('--games must be a positive integer');
  return { games, seed };
}

if (process.argv[1]?.endsWith('/sim.ts')) {
  try {
    const report = runRoomSimulation(cliArgs(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
    if (report.crashes + report.stuck + report.alarmInvariantViolations > 0) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
