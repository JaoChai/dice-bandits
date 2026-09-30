import type { GameEvent, GameState } from '@dice-bandits/engine';

export const SFX_IDS = [
  'click',
  'dice',
  'step',
  'battleStart',
  'hit',
  'ko',
  'coin',
  'stolen',
  'levelUp',
  'item',
  'town',
  'win',
] as const;

export type SfxId = (typeof SFX_IDS)[number];
export type MusicId = 'board' | 'battle';

export const EVENT_SFX: Readonly<Record<string, Exclude<SfxId, 'click'>>> = {
  DiceRolled: 'dice',
  Moved: 'step',
  BattleStarted: 'battleStart',
  DamageDealt: 'hit',
  PlayerKO: 'ko',
  GoldGained: 'coin',
  BountyClaimed: 'coin',
  GoldStolen: 'stolen',
  LevelUp: 'levelUp',
  ItemBought: 'item',
  ItemUsed: 'item',
  TownClaimed: 'town',
  TownFlipped: 'town',
  GameEnded: 'win',
};

export function sfxForEvents(events: readonly GameEvent[]): SfxId[] {
  const sounds = new Set<SfxId>();
  for (const event of events) {
    const sound = Object.hasOwn(EVENT_SFX, event.type) ? EVENT_SFX[event.type] : undefined;
    if (sound) sounds.add(sound);
  }
  return [...sounds];
}

export function musicForState(state: Pick<GameState, 'phase'>): MusicId {
  return state.phase.kind === 'battle' ? 'battle' : 'board';
}
