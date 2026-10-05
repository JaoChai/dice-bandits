import type { ClassId } from '@dice-bandits/engine';

/**
 * One player-colour system for card frames, token rings and town flags
 * (spec §7): each seat takes its hero signature colour; when a class is
 * picked twice the later seat takes the first unused colour from the
 * palette fallback pool. Exact palette tokens per Global Constraints.
 */
export const HERO_SEAT_COLORS: Record<ClassId, string> = {
  knight: '#2E7FE0',
  thief: '#3BA84A',
  mage: '#6C2EBE',
  cleric: '#D42B3A',
};

const FALLBACK_COLORS = ['#F07818', '#F06EA9', '#F5C51C', '#8E8E93'] as const;

export function seatColors(classIds: ClassId[]): string[] {
  const used = new Set<string>();
  return classIds.map((classId) => {
    const hero = HERO_SEAT_COLORS[classId];
    if (!used.has(hero)) {
      used.add(hero);
      return hero;
    }
    const fallback = FALLBACK_COLORS.find((color) => !used.has(color));
    if (!fallback) throw new Error('seatColors: more seats than palette colours');
    used.add(fallback);
    return fallback;
  });
}

/** Numeric tint of a `#RRGGBB` colour for Phaser `setTint`. */
export function seatTint(color: string): number {
  return Number.parseInt(color.slice(1), 16);
}
