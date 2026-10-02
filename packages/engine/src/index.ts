export * from './types';
export * from './rng';
export * as data from './data/index';
export { createGame } from './setup';
export { step } from './step';
export { legalActions, battleActorSeat } from './legal';
export { chooseAction } from './bots/index';
export { startBattle, applyBattlePick, resolveHalf, damage, magicDamage } from './rules/battle';
export { MAP, validateMap } from './map';
export type { MapNode } from './map';

export const ENGINE_VERSION = 1;
