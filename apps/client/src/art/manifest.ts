import type { ClassId, Region } from '@dice-bandits/engine';

/**
 * Cartoon art manifest (plan M5a Task 5).
 *
 * Texture keys are namespaced with an `art:` prefix: the interim pixel-art
 * pipeline (`public/sprites/`, deleted in Task 11) still owns the plain keys
 * (`hero-knight`, `tiles`, `backdrop-*`, `icons`) until Tasks 6–11 rewrite
 * its consumers, so the two sets must never collide in the texture manager.
 * Scenes that render cartoon art resolve sprites exclusively through `ART`.
 */
export const HERO_POSES = ['idle', 'attack', 'hurt', 'happy', 'sad', 'portrait'] as const;
export const MONSTER_POSES = ['idle', 'attack', 'hurt'] as const;

export type HeroPose = (typeof HERO_POSES)[number];
export type MonsterPose = (typeof MONSTER_POSES)[number];

const classes: ClassId[] = ['knight', 'thief', 'mage', 'cleric'];
const monsters = [
  'jellyBun',
  'mushroomBonk',
  'cactusPunch',
  'coinScorpion',
  'yetiBunny',
  'penguinKnight',
  'lavaImp',
  'maskGoon',
] as const;
const regions: Region[] = ['meadow', 'desert', 'snow', 'volcano'];

/** Atlas keys in BootScene load order; every entry must exist under /art.
 *  `title` has no ART member until Task 9 renders it as the title background. */
export const ART_ATLASES = [
  ...classes.map((id) => `hero-${id}`),
  ...monsters.map((id) => `monster-${id}`),
  'tiles',
  'buildings',
  'icons',
  'ui',
  'title',
  ...regions.map((region) => `backdrop-${region}`),
] as const;

export type ArtAtlas = (typeof ART_ATLASES)[number];

/** Textured atlas registry for scenes that render the cartoon set. */
export const ART = {
  heroes: Object.fromEntries(classes.map((id) => [id, `art:hero-${id}`])) as Record<
    ClassId,
    `art:hero-${ClassId}`
  >,
  monsters: Object.fromEntries(monsters.map((id) => [id, `art:monster-${id}`])) as Record<
    (typeof monsters)[number],
    `art:monster-${(typeof monsters)[number]}`
  >,
  tiles: 'art:tiles',
  buildings: 'art:buildings',
  icons: 'art:icons',
  ui: 'art:ui',
  backdrops: Object.fromEntries(
    regions.map((region) => [region, `art:backdrop-${region}`]),
  ) as Record<Region, `art:backdrop-${Region}`>,
  mapTiles: { cols: 5, rows: 3, tile: [640, 600] as const },
} as const;
