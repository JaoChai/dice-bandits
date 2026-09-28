import type { GameEvent, GameState } from '../types';
import { nextInt } from '../rng';
import { resolveSpace as resolveLanding } from './spaces';
import { collectTaxes } from './towns';
import { startBattle } from './battle';
import { finishGame } from './endgame';
import { startOfRound } from './underdog';

export interface RuleResult {
  state: GameState;
  events: GameEvent[];
}

export function resolveSpace(state: GameState, seat = state.turnSeat): RuleResult {
  return resolveLanding(state, seat);
}

/** True when any *other* non-KO player stands on `spaceId`. */
function occupiedByOthers(state: GameState, mover: number, spaceId: number): number[] {
  return state.players
    .filter((p) => p.seat !== mover && p.pos === spaceId && p.hp > 0)
    .map((p) => p.seat);
}

/** Advance one space; may open chooseBranch / duelOffer phases. */
function advanceOne(state: GameState, events: GameEvent[]): RuleResult {
  const player = state.players[state.turnSeat]!;
  const cur = state.board.spaces[player.pos]!;
  const nextIds = cur.next;
  if (nextIds.length > 1) {
    // fork: pause movement until the traveller picks a branch
    const remaining = state.phase.kind === 'moving' ? state.phase.remaining : 0;
    state.phase = { kind: 'chooseBranch', remaining, options: nextIds };
    return { state, events };
  }
  const to = nextIds[0]!;
  return moveSingle(state, to, events);
}

/** Apply the move onto space `to`, handling pass-over duels and final resolve. */
function moveSingle(state: GameState, to: number, events: GameEvent[]): RuleResult {
  const player = state.players[state.turnSeat]!;
  const phase = state.phase;
  const remaining = phase.kind === 'moving' ? phase.remaining : 1;
  const isFinal = remaining <= 1;
  player.pos = to;
  events.push({
    type: 'Moved',
    seat: player.seat,
    params: { to, remaining: remaining - (isFinal ? 1 : 0) },
  });

  if (!isFinal) {
    const others = occupiedByOthers(state, player.seat, to);
    if (others.length > 0) {
      state.phase = { kind: 'duelOffer', remaining: remaining - 1, targets: others };
      return { state, events };
    }
    state.phase = { kind: 'moving', remaining: remaining - 1 };
    return advanceOne(state, events);
  }

  // Resolve the landing; interactive spaces retain their phase, ordinary ones end the turn.
  state.phase = { kind: 'endOfTurn' };
  const landed = resolveSpace(state, player.seat);
  events.push(...landed.events);
  if (landed.state.phase.kind === 'endOfTurn') return endTurn(landed.state, events);
  return { state: landed.state, events };
}

/** Roll dice then start walking. */
export function applyRoll(state: GameState): RuleResult {
  const player = state.players[state.turnSeat]!;
  const events: GameEvent[] = [];
  let rng = state.rng;
  let total = player.forcedRoll ?? 0;

  const dice = player.forcedRoll === null ? 1 + player.bonusDice : 1;
  const rollCount = player.forcedRoll === null ? dice : 0;
  const cap = player.rollCap ?? 6;
  const sides = cap <= 3 ? 3 : 6; // Cursed Legs caps to 1d3
  for (let i = 0; i < rollCount; i++) {
    const [v, n] = nextInt(rng, 1, sides);
    total += v;
    rng = n;
  }
  state.rng = rng;
  // bonus dice reset after the roll; rollCap only ever capped one roll (Cursed Legs)
  player.bonusDice = 0;
  player.rollCap = null;
  player.forcedRoll = null;

  events.push({
    type: 'DiceRolled',
    seat: player.seat,
    params: { value: total, dice, sides },
  });

  if (player.perks.includes('quickFeet') && total === 1) total += 1;

  // Slippery Roads: +1 extra space when the first step's destination is snow
  if (state.worldRule === 'slipperyRoads') {
    const firstStep = state.board.spaces[player.pos]!.next;
    if (firstStep.length === 1 && state.board.spaces[firstStep[0]!]!.region === 'snow') {
      total += 1;
    }
  }

  state.phase = { kind: 'moving', remaining: total };
  return advanceOne(state, events);
}

/**
 * Next seat's turn: skip seats with skipTurns > 0 (decrement + TurnSkipped),
 * wrap to round+1 after the last seat, gameOver after the final round.
 */
export function endTurn(state: GameState, events: GameEvent[]): RuleResult {
  let seat = state.turnSeat;
  for (;;) {
    seat = (seat + 1) % state.players.length;
    if (seat === 0) {
      if (state.round >= state.config.rounds) {
        const final = finishGame(state);
        return { state: final.state, events: [...events, ...final.events] };
      }
      state.round += 1;
      const roundStart = startOfRound(state);
      events.push(...roundStart.events);
    }
    const p = state.players[seat]!;
    const taxes = collectTaxes(state, seat);
    events.push(...taxes.events);
    if (p.skipTurns > 0) {
      p.skipTurns -= 1;
      events.push({ type: 'TurnSkipped', seat, params: { skipTurns: p.skipTurns } });
      continue;
    }
    break;
  }
  state.turnSeat = seat;
  state.phase = { kind: 'awaitRoll' };
  return { state, events };
}

/** Fork decision: walk the chosen branch. */
export function applyChooseBranch(state: GameState, to: number): RuleResult {
  if (state.phase.kind !== 'chooseBranch')
    throw new Error('applyChooseBranch outside chooseBranch');
  const { remaining } = state.phase;
  if (!state.phase.options.includes(to)) {
    throw new TypeError('applyChooseBranch: branch not offered');
  }
  const events: GameEvent[] = [{ type: 'BranchChosen', seat: state.turnSeat, params: { to } }];
  state.phase = { kind: 'moving', remaining };
  return moveSingle(state, to, events);
}

/** Duel offer answer: null keeps moving; target starts a PvP battle. */
export function applyDuelAnswer(state: GameState, target: number | null): RuleResult {
  if (state.phase.kind !== 'duelOffer') throw new Error('applyDuelAnswer outside duelOffer');
  const { remaining, targets } = state.phase;
  if (target !== null && !targets.includes(target)) {
    throw new TypeError('applyDuelAnswer: target not offered');
  }
  if (target === null) {
    state.phase = { kind: 'moving', remaining };
    const events: GameEvent[] = [{ type: 'DuelDeclined', seat: state.turnSeat, params: {} }];
    return advanceOne(state, events);
  }
  const opponent = state.players[target]!;
  const combatant = {
    kind: 'player' as const,
    seat: target,
    monsterId: null,
    level: opponent.level,
    hp: opponent.hp,
    stats: { ...opponent.stats },
    secretUsed: false,
    buffs: { ironSkin: false, poison: false, halveNext: false },
  };
  const result = startBattle(state, {
    context: 'pvp',
    spaceId: state.players[state.turnSeat]!.pos,
    opponent: combatant,
  });
  result.events.unshift({ type: 'DuelAccepted', seat: state.turnSeat, params: { target } });
  return result;
}
