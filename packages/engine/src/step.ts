import type { Action, GameState, StepResult } from './types';
import { IllegalActionError } from './types';
import { legalActions } from './legal';
import { applyRoll, applyChooseBranch, applyDuelAnswer, endTurn } from './rules/movement';
import { applyBattlePick } from './rules/battle';
import { applyPvpReward, leader } from './rules/pvp';
import { BALANCE } from './data/index';
import { useItem, shopBuy, shopSell } from './rules/items';
import { pickPerk } from './rules/leveling';
import { invest, startTownChallenge } from './rules/towns';

/**
 * Apply `action` to a state, returning a fresh state + events. The input is
 * never mutated: it is deep-cloned once here and all rule functions operate
 * on the clone.
 */
export function step(state: GameState, action: Action): StepResult {
  const next = structuredClone(state);
  const seat =
    next.phase.kind === 'pvpReward'
      ? next.phase.winner
      : next.phase.kind === 'levelUp'
        ? next.phase.seat
        : next.turnSeat;

  const isBattlePick = action.type === 'battlePick';
  const legal = legalActions(next, seat).some((a) => actionsEq(a, action));
  if (!legal && !isBattlePick) {
    throw new IllegalActionError(`illegal action ${action.type} in phase ${next.phase.kind}`);
  }

  switch (action.type) {
    case 'roll':
      return applyRoll(next);
    case 'chooseBranch':
      return applyChooseBranch(next, action.to);
    case 'duel':
      return applyDuelAnswer(next, action.target);
    case 'battlePick':
      return applyBattlePick(next, action.side, action.pick);
    case 'useItem': {
      const r = useItem(next, seat, action.item, action.target);
      return r.state.phase.kind === 'endOfTurn' ? endTurn(r.state, r.events) : r;
    }
    case 'useBanditCard': {
      const player = next.players[seat]!;
      const targetSeat = leader(next);
      const target = next.players[targetSeat]!;
      if (player.banditCards.indexOf(action.card) < 0)
        throw new IllegalActionError('bandit card unavailable');
      player.banditCards.splice(player.banditCards.indexOf(action.card), 1);
      const events = [];
      if (action.card === 'pickpocketFar') {
        const amount = Math.floor((target.gold * BALANCE.pickpocketFarPct) / 100);
        target.gold -= amount;
        player.gold += amount;
        next.stats.robbedGold[seat] = (next.stats.robbedGold[seat] ?? 0) + amount;
        target.grudges[seat] = (target.grudges[seat] ?? 0) + amount;
        events.push({ type: 'GoldStolen', seat, params: { amount } });
      } else if (action.card === 'cursedLegs') {
        target.rollCap = 3;
        events.push({ type: 'CursedLegs', seat, params: { target: targetSeat } });
      } else {
        next.bounty = { target: targetSeat, untilRound: next.round + BALANCE.bountyRounds };
        events.push({
          type: 'BountyPlaced',
          seat,
          params: { target: targetSeat, untilRound: next.bounty.untilRound },
        });
      }
      return { state: next, events };
    }
    case 'pvpReward': {
      const r = applyPvpReward(next, action);
      return endTurn(r.state, r.events);
    }
    case 'pickPerk':
      return pickPerk(next, seat, action.perk);
    case 'shopBuy':
      return shopBuy(next, seat, action.item);
    case 'shopSell':
      return shopSell(next, seat, action.item);
    case 'invest': {
      if (next.phase.kind !== 'townManage')
        throw new IllegalActionError('invest outside townManage');
      const r = invest(next, seat, next.phase.spaceId);
      r.state.phase = { kind: 'endOfTurn' };
      return endTurn(r.state, r.events);
    }
    case 'attackTown': {
      if (next.phase.kind !== 'townChallenge')
        throw new IllegalActionError('attackTown outside townChallenge');
      return startTownChallenge(next, seat, next.phase.spaceId);
    }
    case 'leave':
      return endTurn(next, []);
    case 'endTurn':
      return endTurn(next, []);
    default:
      throw new Error('unreachable action branch');
  }
}

/** Structural equality of two actions (payload included). */
function actionsEq(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'useItem':
      return a.item === (b as typeof a).item && a.target === (b as typeof a).target;
    case 'chooseBranch':
      return a.to === (b as typeof a).to;
    case 'duel':
      return a.target === (b as typeof a).target;
    case 'pvpReward':
      return (
        a.reward === (b as typeof a).reward &&
        a.item === (b as typeof a).item &&
        a.townId === (b as typeof a).townId &&
        a.alias === (b as typeof a).alias
      );
    case 'pickPerk':
    case 'shopBuy':
    case 'shopSell':
    case 'useBanditCard':
      return JSON.stringify(a) === JSON.stringify(b);
    default:
      // roll / battlePick / invest / attackTown / leave / endTurn: no payload
      return true;
  }
}
