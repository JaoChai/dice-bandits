import type { GameState } from '@dice-bandits/engine';

export type BattleSide = 'a' | 'b';

export function needsPassScreen(state: GameState, side: BattleSide): boolean {
  if (state.phase.kind !== 'battle' || state.phase.battle.context !== 'pvp') return false;
  const combatant = side === 'a' ? state.phase.battle.a : state.phase.battle.b;
  const opponent = side === 'a' ? state.phase.battle.b : state.phase.battle.a;
  return (
    combatant.kind === 'player' &&
    opponent.kind === 'player' &&
    state.players[combatant.seat!]?.control === 'human' &&
    state.players[opponent.seat!]?.control === 'human'
  );
}

export function passDeviceMarkup(name: string): string {
  return `<div class="dialog-shade pass-device" data-testid="pass-screen"><section class="game-dialog card" role="dialog" aria-modal="true"><h2>${name}</h2><p data-i18n="battle.passDevice"></p><button class="primary" data-testid="pass-ready" data-i18n="battle.ready"></button></section></div>`;
}
