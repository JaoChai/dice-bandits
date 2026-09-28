import type { GameConfig, GameState, Player } from './types';
import { generateBoard } from './board';
import { pick, seedRng } from './rng';
import { BALANCE, CLASSES, WORLD_RULES } from './data/index';
import { startOfRound } from './rules/underdog';

/**
 * Create a fresh GameState from a config: players at the castle with starting
 * gold/level/hp, one world rule drawn, phase awaitRoll, round 1, seat 0 first.
 */
export function createGame(config: GameConfig): GameState {
  if (config.seats.length < 2 || config.seats.length > 4) {
    throw new Error('createGame: seats must be 2..4');
  }
  const board = generateBoard(config.seed);
  const [worldRule, s1] = pick(seedRng(`${config.seed}:worldrule`), Object.keys(WORLD_RULES));
  void s1;
  const players: Player[] = config.seats.map((seatCfg, seat) => {
    const cls = CLASSES[seatCfg.classId];
    return {
      seat,
      name: seatCfg.name,
      classId: seatCfg.classId,
      control: seatCfg.control,
      personality: seatCfg.personality,
      gold: BALANCE.startGold,
      level: 1,
      xp: 0,
      hp: cls.base.maxHp,
      stats: { ...cls.base },
      pos: board.castleId,
      items: [],
      weapon: null,
      armor: null,
      skipTurns: 0,
      rollCap: null,
      forcedRoll: null,
      skipNextFight: false,
      bonusDice: 0,
      prank: null,
      banditCards: [],
      grudges: [],
      perks: [],
    };
  });
  const state: GameState = {
    version: 1,
    config,
    rng: seedRng(`${config.seed}:game`),
    round: 1,
    turnSeat: 0,
    worldRule,
    board,
    towns: board.spaces
      .filter((sp) => sp.kind === 'town')
      .map((sp) => ({
        spaceId: sp.id,
        owner: null,
        value: BALANCE.townBaseValue,
        guardianLevel: 1,
      })),
    traps: {},
    players,
    phase: { kind: 'awaitRoll' },
    bounty: null,
    stats: { robbedGold: config.seats.map(() => 0), townFlips: {}, kos: config.seats.map(() => 0) },
  };
  // Round 1 has no outward event channel, but its stateful underdog draw still applies.
  startOfRound(state);
  return state;
}
