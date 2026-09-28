import type { GameEvent, GameState } from '@dice-bandits/engine';

export interface RedactedGameView {
  state: GameState;
  opponentPicked: boolean;
}

/** Copy and redact a game state for one seat; never mutate authoritative state. */
export function redactGameState(game: GameState, viewer: number): RedactedGameView {
  const state = structuredClone(game);
  state.rng = [0, 0, 0, 0];
  state.config.seed = '';
  let opponentPicked = false;

  if (state.phase.kind === 'battle') {
    const battle = state.phase.battle;
    for (const side of ['a', 'b'] as const) {
      const role = side === battle.attackerSide ? 'attack' : 'defense';
      const pick = role === 'attack' ? battle.pending.attack : battle.pending.defense;
      const combatant = side === 'a' ? battle.a : battle.b;
      if (pick === null || combatant.seat === viewer) continue;
      opponentPicked = true;
      if (role === 'attack') battle.pending.attack = null;
      else battle.pending.defense = null;
      if (pick === 'secret') combatant.secretUsed = false;
    }
  }

  return { state, opponentPicked };
}

/** Hide each still-pending pick's last event from every non-picking seat. */
export function redactBattlePickEvents(
  events: GameEvent[],
  game: GameState,
  viewer: number,
): GameEvent[] {
  const redacted = structuredClone(events);
  if (game.phase.kind !== 'battle') return redacted;

  const battle = game.phase.battle;
  for (const side of ['a', 'b'] as const) {
    const role = side === battle.attackerSide ? 'attack' : 'defense';
    const pick = role === 'attack' ? battle.pending.attack : battle.pending.defense;
    const combatant = side === 'a' ? battle.a : battle.b;
    if (pick === null || combatant.seat === viewer) continue;
    const lastIndex = redacted.findLastIndex(
      (event) => event.type === 'BattlePick' && event.params.role === role,
    );
    if (lastIndex >= 0) {
      redacted[lastIndex] = {
        ...redacted[lastIndex]!,
        params: { ...redacted[lastIndex]!.params, pick: 'hidden' },
      };
    }
  }
  return redacted;
}
