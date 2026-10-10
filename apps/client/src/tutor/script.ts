import type { Action, GameConfig, GameState } from '@dice-bandits/engine';

export interface TutorialScript {
  id: string;
  config: GameConfig;
  replay: Array<{ seat: number; action: Action }>;
  lessons: Array<{
    topic: 'roll' | 'move' | 'fork' | 'chest' | 'battle' | 'shop' | 'town' | 'steal';
    replayIndex: number;
    beforePhase: GameState['phase']['kind'];
    suggested: Action;
  }>;
}

/** Ordinary engine seed and legal choices; no tutorial-specific engine state. */
export const TUTORIAL_SCRIPT: TutorialScript = {
  id: 'm8-route-v1',
  config: {
    seed: 'm8-route-66918',
    rounds: 12,
    seats: [
      { name: 'Learner', classId: 'mage', control: 'human', personality: null },
      { name: 'Bandit', classId: 'thief', control: 'bot', personality: 'cowardly' },
    ],
  },
  replay: [
    { seat: 0, action: { type: 'roll' } },
    { seat: 1, action: { type: 'useBanditCard', card: 'bounty' } },
    { seat: 1, action: { type: 'roll' } },
    { seat: 0, action: { type: 'roll' } },
    { seat: 0, action: { type: 'chooseBranch', to: 34 } },
    { seat: 1, action: { type: 'roll' } },
    { seat: 1, action: { type: 'battlePick', side: 'a', pick: 'secret' } },
    { seat: 1, action: { type: 'battlePick', side: 'a', pick: 'defend' } },
    { seat: 1, action: { type: 'battlePick', side: 'a', pick: 'defend' } },
    { seat: 1, action: { type: 'battlePick', side: 'a', pick: 'attack' } },
    { seat: 1, action: { type: 'pickPerk', perk: 'quickFeet' } },
    { seat: 1, action: { type: 'endTurn' } },
    { seat: 0, action: { type: 'roll' } },
    { seat: 1, action: { type: 'roll' } },
    { seat: 1, action: { type: 'chooseBranch', to: 34 } },
    { seat: 1, action: { type: 'duel', target: null } },
    { seat: 1, action: { type: 'battlePick', side: 'a', pick: 'secret' } },
    { seat: 1, action: { type: 'pickPerk', perk: 'spdUp' } },
    { seat: 1, action: { type: 'endTurn' } },
    { seat: 0, action: { type: 'roll' } },
    { seat: 0, action: { type: 'duel', target: null } },
    { seat: 0, action: { type: 'battlePick', side: 'a', pick: 'secret' } },
    { seat: 0, action: { type: 'pickPerk', perk: 'taxman' } },
    { seat: 0, action: { type: 'endTurn' } },
    { seat: 1, action: { type: 'roll' } },
    { seat: 1, action: { type: 'duel', target: null } },
    { seat: 0, action: { type: 'roll' } },
    { seat: 0, action: { type: 'duel', target: null } },
    { seat: 0, action: { type: 'chooseBranch', to: 20 } },
    { seat: 0, action: { type: 'shopBuy', item: 'crystalWand' } },
    { seat: 0, action: { type: 'leave' } },
    { seat: 1, action: { type: 'roll' } },
    { seat: 1, action: { type: 'chooseBranch', to: 37 } },
    { seat: 1, action: { type: 'battlePick', side: 'a', pick: 'secret' } },
    { seat: 1, action: { type: 'pickPerk', perk: 'thickSkin' } },
    { seat: 1, action: { type: 'endTurn' } },
    { seat: 0, action: { type: 'roll' } },
    { seat: 0, action: { type: 'duel', target: null } },
    { seat: 0, action: { type: 'battlePick', side: 'a', pick: 'secret' } },
    { seat: 0, action: { type: 'pickPerk', perk: 'defUp' } },
    { seat: 0, action: { type: 'endTurn' } },
    { seat: 1, action: { type: 'roll' } },
    { seat: 1, action: { type: 'duel', target: null } },
    { seat: 0, action: { type: 'roll' } },
    { seat: 0, action: { type: 'duel', target: 1 } },
    { seat: 1, action: { type: 'battlePick', side: 'b', pick: 'secret' } },
    { seat: 0, action: { type: 'battlePick', side: 'a', pick: 'secret' } },
    { seat: 0, action: { type: 'battlePick', side: 'a', pick: 'strike' } },
    { seat: 1, action: { type: 'battlePick', side: 'b', pick: 'defend' } },
    { seat: 0, action: { type: 'battlePick', side: 'a', pick: 'strike' } },
    { seat: 1, action: { type: 'battlePick', side: 'b', pick: 'defend' } },
    { seat: 1, action: { type: 'battlePick', side: 'b', pick: 'secret' } },
    { seat: 0, action: { type: 'battlePick', side: 'a', pick: 'defend' } },
    { seat: 1, action: { type: 'battlePick', side: 'b', pick: 'attack' } },
    { seat: 0, action: { type: 'battlePick', side: 'a', pick: 'defend' } },
    { seat: 0, action: { type: 'battlePick', side: 'a', pick: 'strike' } },
    { seat: 1, action: { type: 'battlePick', side: 'b', pick: 'defend' } },
    { seat: 1, action: { type: 'roll' } },
    { seat: 1, action: { type: 'shopBuy', item: 'steelSword' } },
    { seat: 1, action: { type: 'shopBuy', item: 'leatherArmor' } },
    { seat: 1, action: { type: 'shopBuy', item: 'leatherArmor' } },
    { seat: 1, action: { type: 'leave' } },
    { seat: 0, action: { type: 'roll' } },
    { seat: 0, action: { type: 'duel', target: 1 } },
    { seat: 1, action: { type: 'battlePick', side: 'b', pick: 'secret' } },
    { seat: 0, action: { type: 'battlePick', side: 'a', pick: 'secret' } },
    {
      seat: 0,
      action: { type: 'pvpReward', reward: 'rob', item: null, townId: null, alias: null },
    },
  ],
  lessons: [
    { topic: 'roll', replayIndex: 0, beforePhase: 'awaitRoll', suggested: { type: 'roll' } },
    { topic: 'move', replayIndex: 0, beforePhase: 'awaitRoll', suggested: { type: 'roll' } },
    {
      topic: 'fork',
      replayIndex: 4,
      beforePhase: 'chooseBranch',
      suggested: { type: 'chooseBranch', to: 34 },
    },
    {
      topic: 'chest',
      replayIndex: 4,
      beforePhase: 'chooseBranch',
      suggested: { type: 'chooseBranch', to: 34 },
    },
    {
      topic: 'battle',
      replayIndex: 21,
      beforePhase: 'battle',
      suggested: { type: 'battlePick', side: 'a', pick: 'secret' },
    },
    {
      topic: 'shop',
      replayIndex: 29,
      beforePhase: 'shop',
      suggested: { type: 'shopBuy', item: 'crystalWand' },
    },
    {
      topic: 'town',
      replayIndex: 38,
      beforePhase: 'battle',
      suggested: { type: 'battlePick', side: 'a', pick: 'secret' },
    },
    {
      topic: 'steal',
      replayIndex: 66,
      beforePhase: 'pvpReward',
      suggested: { type: 'pvpReward', reward: 'rob', item: null, townId: null, alias: null },
    },
  ],
};
