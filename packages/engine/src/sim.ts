import { createGame } from './setup';
import { legalActions } from './legal';
import { step } from './step';
import { chooseAction } from './bots/index';
import { netWorth } from './rules/pvp';
import { ITEM_BY_ID } from './data/index';
import type { ClassId, GameState, Personality } from './types';

export interface SimulationOptions {
  games: number;
  seedPrefix: string;
  players: 2 | 3 | 4;
}

export interface SimReport {
  games: number;
  crashes: number;
  stuck: number;
  avgRounds: number;
  classWinRate: Record<ClassId, number>;
  comebackRate: number;
  seatWinRate: number[];
  engagement: {
    townsClaimed: number;
    townFlips: number;
    townAttacks: number;
    monsterBattles: number;
    investments: number;
    equipmentBought: number;
    levelUps: number;
    duelsAccepted: number;
    banditCardsUsed: number;
    averageFinalLevel: number;
  };
}

const CLASSES: ClassId[] = ['knight', 'thief', 'mage', 'cleric'];
const PERSONALITIES: Personality[] = ['greedy', 'vengeful', 'cowardly'];

function configFor(seed: string, players: number, gameIndex: number) {
  return {
    seed,
    rounds: 12,
    seats: Array.from({ length: players }, (_, seat) => ({
      name: `Bot ${seat + 1}`,
      classId: CLASSES[(seat + gameIndex) % CLASSES.length]!,
      control: 'bot' as const,
      personality: PERSONALITIES[(seat + gameIndex) % PERSONALITIES.length]!,
    })),
  };
}

function lastPlace(state: GameState): number {
  return state.players.reduce(
    (last, player) => (netWorth(state, player.seat) <= netWorth(state, last) ? player.seat : last),
    0,
  );
}

export function runSimulation(opts: SimulationOptions): SimReport {
  const classWins: Record<ClassId, number> = { knight: 0, thief: 0, mage: 0, cleric: 0 };
  const seatWins = Array.from({ length: opts.players }, () => 0);
  let crashes = 0;
  let stuck = 0;
  let totalRounds = 0;
  let comebacks = 0;
  let comebackEligible = 0;
  let townsClaimed = 0;
  let townFlips = 0;
  let townAttacks = 0;
  let monsterBattles = 0;
  let investments = 0;
  let equipmentBought = 0;
  let levelUps = 0;
  let duelsAccepted = 0;
  let banditCardsUsed = 0;
  let finalLevels = 0;
  let finalPlayerCount = 0;

  for (let game = 0; game < opts.games; game++) {
    let state = createGame(configFor(`${opts.seedPrefix}${game}`, opts.players, game));
    let steps = 0;
    let lastAtRound6: number | null = null;
    try {
      while (state.phase.kind !== 'gameOver' && steps < 5000) {
        // Ask every seat: PvP defenders can act outside turnSeat during battle.
        const eligible: Array<{ seat: number; action: ReturnType<typeof chooseAction> }> = [];
        for (const player of state.players) {
          if (legalActions(state, player.seat).length > 0) {
            eligible.push({ seat: player.seat, action: chooseAction(state, player.seat) });
          }
        }
        if (eligible.length === 0) throw new Error(`No legal actions at phase ${state.phase.kind}`);
        // During battle only the pending seat's action is legal; outside battle this is turnSeat.
        const { action } = eligible[0]!;
        if (action.type === 'duel' && action.target !== null) duelsAccepted += 1;
        if (action.type === 'useBanditCard') banditCardsUsed += 1;
        if (action.type === 'attackTown') townAttacks += 1;
        if (action.type === 'invest') investments += 1;
        if (action.type === 'shopBuy' && ITEM_BY_ID[action.item]?.kind === 'equipment') {
          equipmentBought += 1;
        }
        const result = step(state, action);
        for (const event of result.events) {
          if (event.type === 'TownClaimed') townsClaimed += 1;
          if (event.type === 'TownFlipped') townFlips += 1;
          if (event.type === 'BattleStarted' && event.params.context === 'monster')
            monsterBattles += 1;
          if (event.type === 'LevelUp') levelUps += 1;
        }
        if (state.round === 6 && result.state.round > 6 && lastAtRound6 === null) {
          const roundEnd = structuredClone(result.state);
          for (const event of result.events) {
            if (event.type === 'TaxesCollected' && event.seat !== null) {
              roundEnd.players[event.seat]!.gold -= Number(event.params.amount);
            }
          }
          lastAtRound6 = lastPlace(roundEnd);
        }
        state = result.state;
        steps += 1;
      }
      if (state.phase.kind !== 'gameOver') {
        stuck += 1;
        totalRounds += state.round;
        continue;
      }
      totalRounds += state.round;
      if (lastAtRound6 !== null) {
        comebackEligible += 1;
        if (state.phase.winners.includes(lastAtRound6)) comebacks += 1;
      }
      for (const player of state.players) {
        finalLevels += player.level;
        finalPlayerCount += 1;
      }
      for (const winner of state.phase.winners) {
        const classId = state.players[winner]!.classId;
        classWins[classId] = classWins[classId]! + 1 / state.phase.winners.length;
        seatWins[winner] = seatWins[winner]! + 1 / state.phase.winners.length;
      }
    } catch {
      crashes += 1;
      totalRounds += state.round;
    }
  }

  const denominator = opts.games || 1;
  return {
    games: opts.games,
    crashes,
    stuck,
    avgRounds: totalRounds / denominator,
    classWinRate: Object.fromEntries(
      CLASSES.map((classId) => [classId, classWins[classId] / denominator]),
    ) as Record<ClassId, number>,
    comebackRate: comebackEligible ? comebacks / comebackEligible : 0,
    seatWinRate: seatWins.map((wins) => wins / denominator),
    engagement: {
      townsClaimed,
      townFlips,
      townAttacks,
      monsterBattles,
      investments,
      equipmentBought,
      levelUps,
      duelsAccepted,
      banditCardsUsed,
      averageFinalLevel: finalPlayerCount ? finalLevels / finalPlayerCount : 0,
    },
  };
}

function cliArgs(args: string[]): SimulationOptions {
  let games = 1000;
  let players: 2 | 3 | 4 = 4;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--games') games = Number(args[++i]);
    if (args[i] === '--players') players = Number(args[++i]) as 2 | 3 | 4;
  }
  if (!Number.isInteger(games) || games < 1) throw new Error('--games must be a positive integer');
  if (![2, 3, 4].includes(players)) throw new Error('--players must be 2, 3, or 4');
  return { games, seedPrefix: 'sim-', players };
}

if (process.argv[1]?.endsWith('/sim.ts')) {
  try {
    const report = runSimulation(cliArgs(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
    const rates = Object.values(report.classWinRate);
    if (
      report.crashes ||
      report.stuck ||
      rates.some((rate) => rate < 0.15 || rate > 0.35) ||
      report.comebackRate < 0.08
    ) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
