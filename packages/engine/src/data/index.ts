import classesJson from './classes.json' with { type: 'json' };
import monstersJson from './monsters.json' with { type: 'json' };
import itemsJson from './items.json' with { type: 'json' };
import perksJson from './perks.json' with { type: 'json' };
import worldRulesJson from './worldRules.json' with { type: 'json' };
import balanceJson from './balance.json' with { type: 'json' };
import chunksJson from './chunks.json' with { type: 'json' };
import pranksJson from './pranks.json' with { type: 'json' };

import type { ClassId, Region, SpaceKind, Stats } from '../types';

export interface ClassDef {
  base: Stats;
  growth: Stats;
  secret: string;
}
export interface MonsterDef {
  base: Stats;
  growth: Stats;
  xp: number;
  gold: number;
  regions: Region[];
}
export interface ItemDef {
  id: string;
  kind: 'field' | 'battle' | 'equipment';
  price: number;
  slot: 'weapon' | 'armor' | null;
  effect: Record<string, unknown>;
}
export interface PerkDef {
  id: string;
  effect: string;
}
export interface ChunkSpace {
  kind: SpaceKind;
  x: number;
  y: number;
}
export interface Chunk {
  id: string;
  region: Region;
  fork: boolean;
  spaces: ChunkSpace[];
}

export const CLASSES = classesJson as Record<ClassId, ClassDef>;
export const MONSTERS = monstersJson as unknown as Record<string, MonsterDef>;
export const ITEMS = itemsJson as ItemDef[];
export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
export const PERKS = perksJson as PerkDef[];
export const WORLD_RULES = worldRulesJson as Record<string, string>;
export const BALANCE = balanceJson as {
  startGold: number;
  rounds: number;
  frenzyFromRound: number;
  frenzyMultiplier: number;
  levelCap: number;
  xpToLevel: number[];
  deathGoldLossPct: number;
  robPct: number;
  looterRobPct: number;
  grudgeHolderDamagePct: number;
  prankRounds: number;
  inventoryMax: number;
  banditCardsMax: number;
  townBaseValue: number;
  townTaxPct: number;
  investCost: number;
  investValuePct: number;
  chestGold: [number, number];
  trapGoldLossPct: number;
  trapSkipChance: number;
  damageVariance: [number, number];
  attackMult: number;
  strikeMult: number;
  defendMult: number;
  pickpocketFarPct: number;
  bountyGold: number;
  bountyRounds: number;
  resaleRatio: number;
};
export const CHUNKS = chunksJson as Chunk[];
export const PRANK_ALIASES = pranksJson as string[];
