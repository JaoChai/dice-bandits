import type { GameConfig } from '@dice-bandits/engine';

/** Practice heroes are the named i18n characters; the frozen route never changes. */
export function withHeroNames(
  config: GameConfig,
  names: { mage: string; thief: string },
): GameConfig {
  return {
    ...config,
    seats: config.seats.map((seat) =>
      seat.classId === 'mage'
        ? { ...seat, name: names.mage }
        : seat.classId === 'thief'
          ? { ...seat, name: names.thief }
          : seat,
    ),
  };
}
