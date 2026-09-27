import { describe, expect, it } from 'vitest';
import { createGame, legalActions, step } from '../src/index';
import { BALANCE, ITEM_BY_ID, PRANK_ALIASES } from '../src/data/index';
import type { GameConfig, GameState } from '../src/types';
import { netWorth, leader } from '../src/rules/pvp';
import { startBattle } from '../src/rules/battle';

const config: GameConfig = {
  seed: 'task7-pvp',
  rounds: 12,
  seats: [
    { name: 'A', classId: 'knight', control: 'human', personality: null },
    { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' },
  ],
};
function setup(phase: GameState['phase']): GameState {
  const state = createGame(config);
  state.phase = phase;
  return state;
}

describe('PvP and worth', () => {
  it('calculates net worth from gold, inventory/equipment resale and owned towns', () => {
    const state = createGame(config);
    const player = state.players[0]!;
    player.gold = 100;
    player.items = ['potion', 'bronzeSword'];
    player.weapon = 'bronzeSword';
    player.stats.atk += Number(ITEM_BY_ID.bronzeSword!.effect.atk);
    state.towns[0]!.owner = 0;
    state.towns[0]!.value = 200;
    expect(netWorth(state, 0)).toBe(
      player.gold +
        Math.floor(ITEM_BY_ID.potion!.price * BALANCE.resaleRatio) +
        Math.floor(ITEM_BY_ID.bronzeSword!.price * BALANCE.resaleRatio) +
        200,
    );
    state.players[1]!.gold = netWorth(state, 0);
    expect(leader(state)).toBe(0);
    state.players[1]!.gold += 1;
    expect(leader(state)).toBe(1);
  });

  it('offers only living duel targets, starts PvP, and opens the winner reward menu after a KO', () => {
    const state = createGame(config);
    state.phase = { kind: 'duelOffer', remaining: 2, targets: [1] };
    state.players[1]!.hp = 0;
    expect(legalActions(state, 0)).not.toContainEqual({ type: 'duel', target: 1 });
    state.players[1]!.hp = state.players[1]!.stats.maxHp;
    state.players[1]!.pos = state.players[0]!.pos;
    state.players[0]!.stats.spd = 100;
    state.players[1]!.hp = 1;
    state.players[1]!.gold += 1000;
    state.bounty = { target: 1, untilRound: state.round + BALANCE.bountyRounds };
    const started = step(state, { type: 'duel', target: 1 });
    expect(started.state.phase.kind).toBe('battle');
    let current = started.state;
    for (let i = 0; i < 24 && current.phase.kind === 'battle'; i++) {
      const battle = current.phase.battle;
      const side =
        battle.pending.attack === null
          ? battle.attackerSide
          : battle.attackerSide === 'a'
            ? 'b'
            : 'a';
      const actor = side === 'a' ? battle.a : battle.b;
      const pick =
        actor.kind === 'player' ? (side === battle.attackerSide ? 'attack' : 'counter') : 'attack';
      current = step(current, { type: 'battlePick', side, pick }).state;
    }
    expect(current.phase.kind).toBe('pvpReward');
    expect(current.players[0]!.gold).toBe(500);
    expect(current.bounty).toBeNull();
    expect(
      legalActions(current, current.turnSeat).some(
        (action) => action.type === 'pvpReward' && action.reward === 'rob',
      ),
    ).toBe(true);
  });

  it('applies looter rob at 40 percent and records theft grudges/statistics', () => {
    const state = setup({ kind: 'pvpReward', winner: 0, loser: 1 });
    state.players[0]!.perks.push('looter');
    state.players[1]!.gold = 100;
    const result = step(state, {
      type: 'pvpReward',
      reward: 'rob',
      item: null,
      townId: null,
      alias: null,
    });
    expect(result.state.players[0]!.gold).toBe(340);
    expect(result.state.players[1]!.gold).toBe(60);
    expect(result.state.stats.robbedGold[0]).toBe(40);
    expect(result.state.players[1]!.grudges[0]).toBe(40);
  });

  it('enumerates concrete loot and town choices and rejects unavailable rewards', () => {
    const state = setup({ kind: 'pvpReward', winner: 0, loser: 1 });
    state.players[1]!.items = ['potion'];
    state.towns[0]!.owner = 1;
    expect(legalActions(state, 0)).toContainEqual({
      type: 'pvpReward',
      reward: 'loot',
      item: 'potion',
      townId: null,
      alias: null,
    });
    expect(legalActions(state, 0)).toContainEqual({
      type: 'pvpReward',
      reward: 'seize',
      item: null,
      townId: state.towns[0]!.spaceId,
      alias: null,
    });
    expect(() =>
      step(state, {
        type: 'pvpReward',
        reward: 'loot',
        item: 'missing',
        townId: null,
        alias: null,
      }),
    ).toThrow();
    const seized = step(state, {
      type: 'pvpReward',
      reward: 'seize',
      item: null,
      townId: state.towns[0]!.spaceId,
      alias: null,
    });
    expect(seized.state.towns[0]!.owner).toBe(0);
  });

  it('prank aliases are concrete legal choices and do not consume RNG', () => {
    const state = setup({ kind: 'pvpReward', winner: 0, loser: 1 });
    const prankActions = legalActions(state, 0).filter(
      (action) => action.type === 'pvpReward' && action.reward === 'prank',
    );
    expect(
      prankActions.map((action) => (action.type === 'pvpReward' ? action.alias : null)),
    ).toEqual(PRANK_ALIASES);
    const before = structuredClone(state.rng);
    const chosen = prankActions[0]!;
    const result = step(state, chosen);
    expect(result.state.players[1]!.prank).toMatchObject({
      alias: chosen.type === 'pvpReward' ? chosen.alias : null,
      untilRound: 1 + BALANCE.prankRounds,
    });
    expect(result.state.rng).toEqual(before);
  });

  it('gives grudgeHolder +15% attack against the current leader without mutating player stats', () => {
    const state = createGame(config);
    state.players[0]!.perks.push('grudgeHolder');
    state.players[1]!.gold += 1000;
    const baseAtk = state.players[0]!.stats.atk;
    const result = startBattle(state, {
      context: 'pvp',
      spaceId: state.players[0]!.pos,
      opponent: {
        kind: 'player',
        seat: 1,
        monsterId: null,
        level: state.players[1]!.level,
        hp: state.players[1]!.hp,
        stats: { ...state.players[1]!.stats },
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
    });
    const battle = result.state.phase as Extract<GameState['phase'], { kind: 'battle' }>;
    expect(battle.battle.a.stats.atk).toBeCloseTo(baseAtk * 1.15);
    expect(result.state.players[0]!.stats.atk).toBe(baseAtk);
  });

  it('a three-exchange PvP draw gives no reward and ends the initiator turn', () => {
    const state = createGame(config);
    state.players.forEach((player) => {
      player.stats.atk = 1;
      player.stats.def = 1000;
    });
    startBattle(state, {
      context: 'pvp',
      spaceId: state.players[0]!.pos,
      opponent: {
        kind: 'player',
        seat: 1,
        monsterId: null,
        level: state.players[1]!.level,
        hp: state.players[1]!.hp,
        stats: { ...state.players[1]!.stats },
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
    });
    let current = state;
    for (let i = 0; i < 12; i++) {
      const battle = current.phase as Extract<GameState['phase'], { kind: 'battle' }>;
      const side =
        battle.battle.pending.attack === null
          ? battle.battle.attackerSide
          : battle.battle.attackerSide === 'a'
            ? 'b'
            : 'a';
      current = step(current, {
        type: 'battlePick',
        side,
        pick: side === battle.battle.attackerSide ? 'attack' : 'defend',
      }).state;
    }
    expect(current.phase.kind).toBe('awaitRoll');
    expect(current.turnSeat).toBe(1);
    expect(current.players[0]!.gold).toBe(300);
    expect(current.players[1]!.gold).toBe(300);
  });
});
