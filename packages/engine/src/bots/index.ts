import { legalActions } from '../legal';
import { leader, netWorth } from '../rules/pvp';
import { nextFloat, seedRng } from '../rng';
import type { Action, GameState, Personality } from '../types';
import { actionScore, PERSONALITY_WEIGHTS } from './scoring';

export { actionScore, PERSONALITY_WEIGHTS } from './scoring';

function phaseKey(state: GameState): string {
  switch (state.phase.kind) {
    case 'battle': {
      const battle = state.phase.battle;
      return `${state.phase.kind}:${battle.context}:${battle.exchange}:${battle.half}:${battle.pending.attack ?? '-'}:${battle.pending.defense ?? '-'}`;
    }
    case 'chooseBranch':
    case 'duelOffer':
      return `${state.phase.kind}:${state.phase.remaining}`;
    case 'levelUp':
      return `${state.phase.kind}:${state.phase.seat}:${state.phase.then}`;
    case 'shop':
      return `${state.phase.kind}:${state.phase.stock.join(',')}`;
    case 'townManage':
    case 'townChallenge':
      return `${state.phase.kind}:${state.phase.spaceId}`;
    case 'pvpReward':
      return `${state.phase.kind}:${state.phase.winner}:${state.phase.loser}`;
    default:
      return state.phase.kind;
  }
}

function scoreAction(
  state: GameState,
  seat: number,
  action: Action,
  personality: Personality,
): number {
  const player = state.players[seat]!;
  let score = actionScore(action, personality);
  const weights = PERSONALITY_WEIGHTS[personality];
  if (action.type === 'chooseBranch') {
    const destination = state.board.spaces[action.to]!;
    score += destination.kind === 'chest' ? (weights.chest ?? 0) : 0;
    score += destination.kind === 'town' ? (weights.town ?? 0) : 0;
    score += destination.kind === 'monster' ? (weights.strongMonster ?? 0) : 0;
  }
  if (action.type === 'duel' && action.target !== null) {
    const target = state.players[action.target]!;
    const topGrudge = player.grudges.reduce(
      (best, amount, targetSeat) => (amount > (player.grudges[best] ?? 0) ? targetSeat : best),
      seat,
    );
    if (personality === 'vengeful' && topGrudge === action.target) score += 12;
    if (personality === 'greedy' && netWorth(state, action.target) > netWorth(state, seat))
      score += 4;
    if (personality === 'cowardly' && target.level >= player.level) score -= 8;
  }
  if (action.type === 'pvpReward' && action.reward === 'seize' && action.townId !== null) {
    score += state.towns.find((town) => town.spaceId === action.townId)?.value ?? 0;
  }
  if (action.type === 'useBanditCard') {
    score += action.card === 'pickpocketFar' ? 4 : action.card === 'bounty' ? 2 : 0;
    if (leader(state) === seat) score -= 20;
  }
  if (action.type === 'battlePick' && action.pick === 'secret' && state.phase.kind === 'battle') {
    const battle = state.phase.battle;
    const self = battle.a.seat === seat ? battle.a : battle.b.seat === seat ? battle.b : null;
    const opponent = self === battle.a ? battle.b : battle.a;
    if (self && opponent) {
      score += opponent.hp <= Math.max(self.stats.atk * 2, self.stats.mag * 2) ? 7 : -1;
      if (self.hp <= self.stats.maxHp * 0.35 && player.classId === 'cleric') score += 8;
    }
  }
  if (action.type === 'shopBuy') {
    const reserve = Math.max(0, player.gold - 180);
    score += reserve >= 200 ? 5 : reserve >= 80 ? 2 : -2;
    if (action.item.toLowerCase().includes('sword') || action.item.toLowerCase().includes('wand'))
      score += 2;
  }
  return score;
}

/** Select a legal action using personality weights and deterministic, isolated ±10% noise. */
export function chooseAction(state: GameState, seat: number): Action {
  const actions = legalActions(state, seat);
  if (actions.length === 0) throw new Error(`chooseAction: seat ${seat} has no legal action`);
  const personality = state.players[seat]!.personality ?? 'greedy';
  let rng = seedRng(`${state.config.seed}:${state.round}:${seat}:${phaseKey(state)}`);
  let best = actions[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const action of actions) {
    const [noise, next] = nextFloat(rng);
    rng = next;
    const base = scoreAction(state, seat, action, personality);
    const perturbed = base === 0 ? (noise - 0.5) * 0.2 : base * (0.9 + noise * 0.2);
    if (perturbed > bestScore) {
      best = action;
      bestScore = perturbed;
    }
  }
  return best;
}
