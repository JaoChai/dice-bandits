import type { ClassId, Region, SpaceKind } from '@dice-bandits/engine';

export const REGION_VISUALS: Record<
  Region,
  { ground: string; props: string; road: number; ambient: string; backdrop: string }
> = {
  meadow: {
    ground: 'ground-meadow',
    props: 'props-meadow',
    road: 0,
    ambient: 'ambient-meadow',
    backdrop: 'backdrop-meadow',
  },
  desert: {
    ground: 'ground-desert',
    props: 'props-desert',
    road: 1,
    ambient: 'ambient-desert',
    backdrop: 'backdrop-desert',
  },
  snow: {
    ground: 'ground-snow',
    props: 'props-snow',
    road: 2,
    ambient: 'ambient-snow',
    backdrop: 'backdrop-snow',
  },
  volcano: {
    ground: 'ground-volcano',
    props: 'props-volcano',
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

// M5a interim: keys follow the new engine monster ids (Task 2), but values
// point at the shipped pixel atlases of the old monster each new id derives
// from (plan §Monster table), so battles render until Task 4 ships the
// cartoon `monster-<newId>` atlases and this maps 1:1 again.
export const MONSTER_SHEETS: Record<string, string> = {
  jellyBun: 'monster-goldSlime',
  mushroomBonk: 'monster-mushroomBandit',
  cactusPunch: 'monster-mimic',
  coinScorpion: 'monster-lanternGhost',
  yetiBunny: 'monster-lanternGhost',
  penguinKnight: 'monster-rockGolem',
  lavaImp: 'monster-shadowImp',
  maskGoon: 'monster-rockGolem',
};
