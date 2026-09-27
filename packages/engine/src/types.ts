import type { RngState } from './rng';

export type ClassId = 'knight' | 'thief' | 'mage' | 'cleric';
export type Personality = 'greedy' | 'vengeful' | 'cowardly';
export type Region = 'meadow' | 'desert' | 'snow' | 'volcano';
export type SpaceKind = 'castle' | 'town' | 'shop' | 'chest' | 'monster' | 'event' | 'trap';
export type AttackPick = 'attack' | 'strike' | 'secret';
export type DefensePick = 'defend' | 'counter' | 'secret';
export type PvpReward = 'rob' | 'loot' | 'seize' | 'prank';
export type BanditCardId = 'pickpocketFar' | 'cursedLegs' | 'bounty';

export interface Stats {
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  mag: number;
}
export interface Space {
  id: number;
  kind: SpaceKind;
  region: Region;
  next: number[];
  x: number;
  y: number;
}
export interface Board {
  spaces: Space[];
  castleId: number;
}
export interface Town {
  spaceId: number;
  owner: number | null;
  value: number;
  guardianLevel: number;
}
export interface SeatConfig {
  name: string;
  classId: ClassId;
  control: 'human' | 'bot';
  personality: Personality | null;
}
export interface GameConfig {
  seed: string;
  seats: SeatConfig[];
  rounds: number;
}

export interface Player {
  seat: number;
  name: string;
  classId: ClassId;
  control: 'human' | 'bot';
  personality: Personality | null;
  gold: number;
  level: number;
  xp: number;
  hp: number;
  stats: Stats;
  pos: number;
  items: string[];
  weapon: string | null;
  armor: string | null;
  skipTurns: number;
  rollCap: number | null;
  bonusDice: number;
  prank: { alias: string; untilRound: number } | null;
  banditCards: BanditCardId[];
  grudges: number[]; // grudges[otherSeat] = damage/theft points
  perks: string[];
}

export interface Combatant {
  kind: 'player' | 'monster';
  seat: number | null;
  monsterId: string | null;
  level: number;
  hp: number;
  stats: Stats;
  secretUsed: boolean;
  buffs: { ironSkin: boolean; poison: boolean; halveNext: boolean };
}
export interface BattleState {
  context: 'monster' | 'town' | 'pvp';
  spaceId: number;
  a: Combatant;
  b: Combatant; // a = initiator (current seat)
  exchange: number; // 1..3
  attackerSide: 'a' | 'b'; // who attacks in the current half-exchange
  half: 1 | 2;
  pending: { attack: AttackPick | null; defense: DefensePick | null };
}

export type Phase =
  | { kind: 'awaitRoll' } // may use field card or bandit card first
  | { kind: 'moving'; remaining: number } // internal, never exposed between steps
  | { kind: 'chooseBranch'; remaining: number; options: number[] }
  | { kind: 'duelOffer'; remaining: number; targets: number[] }
  | { kind: 'battle'; battle: BattleState }
  | { kind: 'pvpReward'; winner: number; loser: number }
  | { kind: 'levelUp'; seat: number; choices: string[]; then: 'endTurn' | 'continue' }
  | { kind: 'shop'; stock: string[] }
  | { kind: 'townManage'; spaceId: number } // own town: invest or leave
  | { kind: 'townChallenge'; spaceId: number } // enemy town: attack or leave
  | { kind: 'endOfTurn' }
  | { kind: 'gameOver'; ranking: number[]; highlights: Highlight[] };

export interface Highlight {
  key: string;
  seat: number;
  value: number;
}

export type Action =
  | { type: 'roll' }
  | { type: 'useItem'; item: string; target: number | null }
  | { type: 'useBanditCard'; card: BanditCardId }
  | { type: 'chooseBranch'; to: number }
  | { type: 'duel'; target: number | null } // null = keep moving
  | { type: 'battlePick'; side: 'a' | 'b'; pick: AttackPick | DefensePick }
  | {
      type: 'pvpReward';
      reward: PvpReward;
      item: string | null;
      townId: number | null;
      alias: string | null;
    }
  | { type: 'pickPerk'; perk: string }
  | { type: 'shopBuy'; item: string }
  | { type: 'shopSell'; item: string }
  | { type: 'invest' }
  | { type: 'attackTown' }
  | { type: 'leave' }
  | { type: 'endTurn' };

export interface GameEvent {
  type: string;
  seat: number | null;
  params: Record<string, string | number>;
}

export interface GameState {
  version: 1;
  config: GameConfig;
  rng: RngState;
  round: number;
  turnSeat: number;
  worldRule: string;
  board: Board;
  towns: Town[];
  players: Player[];
  phase: Phase;
  bounty: { target: number; untilRound: number } | null;
  stats: { robbedGold: number[]; townFlips: Record<number, number>; kos: number[] };
}
export interface StepResult {
  state: GameState;
  events: GameEvent[];
}
export class IllegalActionError extends Error {}
