export * from './types';
export * from './rng';
export * as data from './data/index';
export { createGame } from './setup';
export { step } from './step';
export { legalActions } from './legal';
export { startBattle, applyBattlePick, resolveHalf, damage, magicDamage } from './rules/battle';

export const ENGINE_VERSION = 1;
