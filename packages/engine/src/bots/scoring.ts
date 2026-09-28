import type { Action, Personality } from '../types';

export const PERSONALITY_WEIGHTS: Record<
  Personality,
  Partial<Record<Action['type'] | string, number>>
> = {
  greedy: {
    chest: 9,
    town: 10,
    attackTown: 8,
    duel: 5,
    rob: 10,
    seize: 9,
    invest: 5,
    shopBuy: 5,
    strike: 4,
    defend: 1,
    strongMonster: -3,
  },
  vengeful: {
    chest: 2,
    town: 4,
    attackTown: 6,
    duel: 8,
    rob: 5,
    seize: 10,
    prank: 6,
    invest: 2,
    strike: 5,
    defend: 0,
    strongMonster: 0,
  },
  cowardly: {
    chest: 5,
    town: 4,
    attackTown: -5,
    duel: -10,
    invest: 9,
    shopBuy: 4,
    defend: 9,
    counter: -2,
    strike: -2,
    strongMonster: -12,
  },
};

export function actionScore(action: Action, personality: Personality): number {
  const weights = PERSONALITY_WEIGHTS[personality];
  switch (action.type) {
    case 'roll':
    case 'chooseBranch':
    case 'endTurn':
      return 0;
    case 'useItem':
      return action.item === 'luckyCoin' ? 12 : action.item === 'dash' ? 6 : -2;
    case 'useBanditCard':
      return 8;
    case 'duel':
      return action.target === null ? 0 : (weights.duel ?? 0) + 2;
    case 'battlePick':
      return weights[action.pick] ?? (action.pick === 'secret' ? 5 : 0);
    case 'pvpReward':
      return weights[action.reward] ?? (action.reward === 'rob' ? 5 : 0);
    case 'pickPerk':
      return ['looter', 'grudgeHolder', 'scavenger', 'thickSkin', 'haggler'].includes(action.perk)
        ? 5
        : 2;
    case 'shopBuy':
      return weights.shopBuy ?? 2;
    case 'shopSell':
      return -4;
    case 'invest':
      return weights.invest ?? 1;
    case 'attackTown':
      return weights.attackTown ?? 1;
    case 'leave':
      return 0;
  }
}
