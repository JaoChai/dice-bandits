import type { ClassId, Region, SpaceKind } from '@dice-bandits/engine';

export const REGION_VISUALS: Record<
  Region,
  { ground: string; road: number; ambient: string; backdrop: string }
> = {
  meadow: {
    ground: 'board-meadow',
    road: 0,
    ambient: 'ambient-meadow',
    backdrop: 'backdrop-meadow',
  },
  desert: {
    ground: 'board-desert',
    road: 1,
    ambient: 'ambient-desert',
    backdrop: 'backdrop-desert',
  },
  snow: { ground: 'board-snow', road: 2, ambient: 'ambient-snow', backdrop: 'backdrop-snow' },
  volcano: {
    ground: 'board-volcano',
    road: 3,
    ambient: 'ambient-volcano',
    backdrop: 'backdrop-volcano',
  },
};

export const SPACE_VISUALS: Record<SpaceKind, { tile: number; icon: string }> = {
  castle: { tile: 0, icon: 'castle' },
  town: { tile: 1, icon: 'town' },
  shop: { tile: 2, icon: 'shop' },
  chest: { tile: 3, icon: 'chest' },
  monster: { tile: 4, icon: 'monster' },
  event: { tile: 5, icon: 'event' },
  trap: { tile: 6, icon: 'trap' },
};

export const CLASS_ACCENT: Record<ClassId, string> = {
  knight: '#4387d7',
  thief: '#b34a54',
  mage: '#8b61c2',
  cleric: '#55a780',
};

export const MONSTER_SHEETS: Record<string, string> = {
  goldSlime: 'monster-goldSlime',
  mushroomBandit: 'monster-mushroomBandit',
  lanternGhost: 'monster-lanternGhost',
  mimic: 'monster-mimic',
  rockGolem: 'monster-rockGolem',
  shadowImp: 'monster-shadowImp',
};
