import { describe, expect, it } from 'vitest';
import { createGame, legalActions, step } from '../src/index';
import { BALANCE } from '../src/data/index';
import { startBattle } from '../src/rules/battle';
import type { GameConfig } from '../src/types';
const config: GameConfig = {
  seed: 'items6',
  rounds: 12,
  seats: [
    { name: 'A', classId: 'thief', control: 'human', personality: null },
    { name: 'B', classId: 'knight', control: 'bot', personality: 'greedy' },
  ],
};

describe('Task 6 items and shop', () => {
  it('shop buy/sell applies haggler discount, resale ratio, and full inventory auto-sell', () => {
    const s = createGame(config);
    s.phase = { kind: 'shop', stock: ['potion', 'bronzeSword'] };
    s.players[0]!.perks.push('haggler');
    const bought = step(s, { type: 'shopBuy', item: 'potion' });
    expect(bought.state.players[0]!.gold).toBe(232);
    expect(bought.state.players[0]!.items).toContain('potion');
    const sold = step(bought.state, { type: 'shopSell', item: 'potion' });
    expect(sold.state.players[0]!.gold).toBe(272);
    const full = createGame(config);
    full.phase = { kind: 'shop', stock: ['potion'] };
    full.players[0]!.items = ['dash', 'warp', 'trapCard', 'smokeBomb', 'luckyCoin', 'mapScroll'];
    const auto = step(full, { type: 'shopBuy', item: 'potion' });
    expect(auto.state.players[0]!.items).toHaveLength(BALANCE.inventoryMax);
    expect(auto.state.players[0]!.gold).toBe(260);
    expect(auto.events.some((event) => event.type === 'ItemAutoSold')).toBe(true);
  });

  it('applies mapScroll as a forced roll and exposes only valid targets', () => {
    const s = createGame(config);
    s.players[0]!.items = ['mapScroll'];
    const legal = legalActions(s, 0);
    expect(legal).toContainEqual({ type: 'useItem', item: 'mapScroll', target: 5 });
    const chosen = step(s, { type: 'useItem', item: 'mapScroll', target: 5 });
    expect(chosen.state.players[0]!.forcedRoll).toBe(5);
    const moved = step(chosen.state, { type: 'roll' });
    expect(moved.events.find((event) => event.type === 'DiceRolled')!.params.value).toBe(5);
  });

  it('battle consumables update combatant state and synchronize player HP', () => {
    const s = createGame(config);
    s.players[0]!.items = ['potion', 'ironSkin', 'poisonBlade', 'rage'];
    s.players[0]!.hp = 10;
    startBattle(s, {
      context: 'monster',
      spaceId: 1,
      opponent: {
        kind: 'monster',
        seat: null,
        monsterId: 'goldSlime',
        level: 1,
        hp: 30,
        stats: { maxHp: 30, atk: 8, def: 6, spd: 4, mag: 2 },
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
    });
    const healed = step(s, { type: 'useItem', item: 'potion', target: null });
    expect(healed.state.players[0]!.hp).toBeGreaterThan(10);
    const protectedState = step(healed.state, { type: 'useItem', item: 'ironSkin', target: null });
    expect(protectedState.state.phase.kind).toBe('battle');
    const poisoned = step(protectedState.state, {
      type: 'useItem',
      item: 'poisonBlade',
      target: null,
    });
    if (poisoned.state.phase.kind !== 'battle') throw new Error('expected battle');
    expect(poisoned.state.phase.battle.b.buffs.poison).toBe(true);
    const enraged = step(poisoned.state, { type: 'useItem', item: 'rage', target: null });
    if (enraged.state.phase.kind !== 'battle') throw new Error('expected battle');
    expect(enraged.state.phase.battle.a.buffs.rage).toBe(true);
  });

  it('thickSkin reduces damage from monster attackers', () => {
    const incomingLoss = (withPerk: boolean): number => {
      const s = createGame(config);
      const player = s.players[0]!;
      if (withPerk) player.perks.push('thickSkin');
      startBattle(s, {
        context: 'monster',
        spaceId: 1,
        opponent: {
          kind: 'monster',
          seat: null,
          monsterId: 'goldSlime',
          level: 1,
          hp: 100,
          stats: { maxHp: 100, atk: 25, def: 0, spd: 100, mag: 2 },
          secretUsed: false,
          buffs: { ironSkin: false, poison: false, halveNext: false },
        },
      });
      const hp = player.hp;
      const defense = legalActions(s, 0).find((action) => action.type === 'battlePick')!;
      const resolved = step(s, defense);
      return hp - resolved.state.players[0]!.hp;
    };
    expect(incomingLoss(true)).toBeLessThan(incomingLoss(false));
  });

  it('hiPotion heals and escapeRope ends the current battle turn', () => {
    const s = createGame(config);
    s.players[0]!.items = ['hiPotion', 'escapeRope'];
    s.players[0]!.hp = 5;
    startBattle(s, {
      context: 'monster',
      spaceId: 1,
      opponent: {
        kind: 'monster',
        seat: null,
        monsterId: 'goldSlime',
        level: 1,
        hp: 30,
        stats: { maxHp: 30, atk: 8, def: 6, spd: 4, mag: 2 },
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
    });
    const healed = step(s, { type: 'useItem', item: 'hiPotion', target: null });
    expect(healed.state.players[0]!.hp).toBeGreaterThan(5);
    const escaped = step(healed.state, { type: 'useItem', item: 'escapeRope', target: null });
    expect(escaped.state.phase.kind).toBe('awaitRoll');
    expect(escaped.state.turnSeat).toBe(1);
  });

  it('applies each field item effect', () => {
    const s = createGame(config);
    const castleId = s.board.castleId;
    s.players[0]!.pos = 3;
    s.players[0]!.items = ['dash', 'warp', 'trapCard', 'smokeBomb', 'luckyCoin', 'mapScroll'];
    let current = step(s, { type: 'useItem', item: 'dash', target: null }).state;
    expect(current.players[0]!.bonusDice).toBe(1);
    current = step(current, { type: 'useItem', item: 'warp', target: null }).state;
    expect(current.players[0]!.pos).toBe(castleId);
    current = step(current, { type: 'useItem', item: 'trapCard', target: null }).state;
    expect(current.traps[castleId]).toBe(0);
    current = step(current, { type: 'useItem', item: 'smokeBomb', target: null }).state;
    expect(current.players[0]!.skipNextFight).toBe(true);
    current = step(current, { type: 'useItem', item: 'luckyCoin', target: null }).state;
    expect(current.players[0]!.gold).toBe(400);
    current = step(current, { type: 'useItem', item: 'mapScroll', target: 4 }).state;
    expect(current.players[0]!.forcedRoll).toBe(4);
  });

  it('equips purchased equipment and removes its stat bonus when sold', () => {
    const s = createGame(config);
    s.phase = { kind: 'shop', stock: ['bronzeSword'] };
    const atk = s.players[0]!.stats.atk;
    const bought = step(s, { type: 'shopBuy', item: 'bronzeSword' });
    expect(bought.state.players[0]!.weapon).toBe('bronzeSword');
    expect(bought.state.players[0]!.stats.atk).toBe(atk + 2);
    const sold = step(bought.state, { type: 'shopSell', item: 'bronzeSword' });
    expect(sold.state.players[0]!.weapon).toBeNull();
    expect(sold.state.players[0]!.stats.atk).toBe(atk);
  });

  it('uses field items and rejects actions not listed by legalActions', () => {
    const s = createGame(config);
    s.players[0]!.items = ['dash', 'luckyCoin'];
    const actions = legalActions(s, 0);
    expect(actions).toContainEqual({ type: 'useItem', item: 'dash', target: null });
    const result = step(s, { type: 'useItem', item: 'luckyCoin', target: null });
    expect(result.state.players[0]!.gold).toBe(400);
    expect(result.state.players[0]!.items).toEqual(['dash']);
  });
});
