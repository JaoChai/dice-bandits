import { describe, expect, it } from 'vitest';
import { createGame, step, legalActions } from '../src/index';
import { resolveSpace, shopStock } from '../src/rules/spaces';
import { collectTaxes } from '../src/rules/towns';
import { startBattle } from '../src/rules/battle';
import { seedRng } from '../src/rng';
import { BALANCE, ITEMS } from '../src/data/index';
import type { GameConfig, GameState } from '../src/types';

const config: GameConfig = {
  seed: 'task6-spaces',
  rounds: 12,
  seats: [
    { name: 'A', classId: 'knight', control: 'human', personality: null },
    { name: 'B', classId: 'mage', control: 'bot', personality: 'greedy' },
  ],
};
const townState = (): GameState => {
  const s = createGame(config);
  const town = s.towns[0]!;
  s.players[0]!.pos = town.spaceId;
  return s;
};

describe('Task 6 spaces and towns', () => {
  it('collects owned-town tax at turn start; doubles in Frenzy and honors Tax Holiday', async () => {
    const s = createGame(config);
    s.towns[0]!.owner = 0;
    s.towns[0]!.value = 400;
    s.round = 9;
    const ordinary = collectTaxes(s, 0);
    expect(ordinary.state.players[0]!.gold).toBe(300 + 40);
    s.worldRule = 'taxHoliday';
    s.round = 3;
    const holiday = collectTaxes(s, 0);
    expect(holiday.state.players[0]!.gold).toBe(340);
    s.round = BALANCE.frenzyFromRound;
    s.worldRule = 'goldRush';
    const frenzy = collectTaxes(s, 0);
    expect(frenzy.state.players[0]!.gold).toBe(340 + 80);
    const taxman = createGame(config);
    taxman.towns[0]!.owner = 0;
    taxman.towns[0]!.value = 400;
    taxman.players[0]!.perks.push('taxman');
    expect(collectTaxes(taxman, 0).state.players[0]!.gold).toBe(348);
  });

  it('landing on an owned town opens management and invests using balance values', () => {
    const s = townState();
    s.towns[0]!.owner = 0;
    const landing = structuredClone(s);
    const town = landing.towns[0]!;
    landing.players[0]!.pos = town.spaceId;
    const landed = resolveSpace(landing, 0);
    expect(landed.state.phase).toEqual({ kind: 'townManage', spaceId: town.spaceId });
    expect(legalActions(landed.state, 0).map((a) => a.type)).toEqual(['invest', 'leave']);
    const invested = step(landed.state, { type: 'invest' });
    expect(invested.state.players[0]!.gold).toBe(200);
    expect(town.value).toBe(BALANCE.townBaseValue);
    expect(invested.state.towns[0]!.value).toBe(300);
  });

  it('landing on a shop opens a shop phase with six stocked items and RNG advances', () => {
    const s = createGame(config);
    const shop = s.board.spaces.find((space) => space.kind === 'shop')!;
    s.players[0]!.pos = shop.id;
    const before = s.rng;
    const stock = shopStock(s, shop.id);
    const result = resolveSpace(s, 0);
    expect(stock).toHaveLength(6);
    expect(result.state.phase.kind).toBe('shop');
    expect(result.state.rng).not.toEqual(before);
  });

  it('event and shop random draws update the game RNG', () => {
    const s = createGame(config);
    const eventSpace = s.board.spaces.find((space) => space.kind === 'event')!;
    s.players[0]!.pos = eventSpace.id;
    const rng = s.rng;
    const result = resolveSpace(s, 0);
    expect(result.state.rng).not.toEqual(rng);
  });

  it('a guardian win transfers a town and increments the town-flip statistic', () => {
    const s = createGame(config);
    const town = s.towns[0]!;
    town.owner = 1;
    const opponent = {
      kind: 'monster' as const,
      seat: null,
      monsterId: 'townGuardian',
      level: 1,
      hp: 1,
      stats: { maxHp: 1, atk: 1, def: 0, spd: 0, mag: 0 },
      secretUsed: false,
      buffs: { ironSkin: false, poison: false, halveNext: false },
    };
    startBattle(s, { context: 'town', spaceId: town.spaceId, opponent });
    const won = step(s, { type: 'battlePick', side: 'a', pick: 'attack' });
    expect(won.state.towns[0]!.owner).toBe(0);
    expect(won.state.stats.townFlips[town.spaceId]).toBe(1);
    expect(won.events.some((entry) => entry.type === 'TownFlipped')).toBe(true);
  });

  it('weights shop stock toward equipment matching the region tier', () => {
    const highTier = ITEMS.filter((item) => item.kind === 'equipment' && item.price >= 900);
    const lowerTier = ITEMS.filter((item) => item.kind === 'equipment' && item.price < 900);
    const shopId = createGame(config).board.spaces.find((space) => space.kind === 'shop')!.id;
    let high = 0;
    let lower = 0;
    const highCount = highTier.length;
    const lowerCount = lowerTier.length;
    for (let index = 0; index < 100; index += 1) {
      const s = createGame({ ...config, seed: `tier-weight-${index}` });
      s.board.spaces[shopId]!.region = 'volcano';
      for (const id of shopStock(s, shopId)) {
        if (highTier.some((item) => item.id === id)) high += 1;
        if (lowerTier.some((item) => item.id === id)) lower += 1;
      }
    }
    expect(high / highCount).toBeGreaterThan(lower / lowerCount);
  });

  it('castle heals fully, or half with Cursed Capital', () => {
    const s = createGame(config);
    const castleId = s.board.spaces.find((space) => space.kind === 'castle')!.id;
    s.worldRule = '';
    s.players[0]!.pos = castleId;
    s.players[0]!.hp = 1;
    resolveSpace(s, 0);
    expect(s.players[0]!.hp).toBe(s.players[0]!.stats.maxHp);
    s.worldRule = 'cursedCapital';
    s.players[0]!.hp = 1;
    resolveSpace(s, 0);
    expect(s.players[0]!.hp).toBe(1 + Math.ceil(s.players[0]!.stats.maxHp / 2));
  });

  it('unowned town guardian win claims the town', () => {
    const s = townState();
    const town = s.towns[0]!;
    s.players[0]!.stats.atk = 100;
    const landing = resolveSpace(s, 0);
    expect(landing.state.phase.kind).toBe('battle');
    let current = landing.state;
    const events = [...landing.events];
    for (let attempt = 0; attempt < 6 && current.phase.kind === 'battle'; attempt += 1) {
      const picks = legalActions(current, 0).filter((action) => action.type === 'battlePick');
      const attack = picks.find(
        (action) => action.type === 'battlePick' && action.pick === 'attack',
      );
      const result = step(current, attack ?? picks[0]!);
      events.push(...result.events);
      current = result.state;
    }
    expect(current.towns.find((entry) => entry.spaceId === town.spaceId)!.owner).toBe(0);
    expect(events.some((entry) => entry.type === 'TownClaimed')).toBe(true);
    expect(current.phase.kind).not.toBe('battle');
  });

  it('Black Market adds a tier-3 equipment item', () => {
    const s = createGame(config);
    const shop = s.board.spaces.find((space) => space.kind === 'shop')!;
    shop.region = 'volcano';
    s.worldRule = 'blackMarket';
    const stock = shopStock(s, shop.id);
    expect(stock).toHaveLength(7);
    expect(
      stock
        .slice(6)
        .some((id) =>
          ITEMS.some((item) => item.id === id && item.kind === 'equipment' && item.price >= 900),
        ),
    ).toBe(true);
  });

  it('Gold Rush doubles chest gold', () => {
    const s = createGame(config);
    const chest = s.board.spaces.find((space) => space.kind === 'chest')!;
    s.players[0]!.pos = chest.id;
    s.worldRule = 'goldRush';
    s.rng = seedRng('chest-0');
    const baseline = structuredClone(s);
    baseline.worldRule = '';
    const ordinary = resolveSpace(baseline, 0);
    const doubled = resolveSpace(s, 0);
    expect(doubled.events[0]!.type).toBe('GoldGained');
    expect(ordinary.events[0]!.type).toBe('GoldGained');
    expect(Number(doubled.events[0]!.params.amount)).toBe(
      Number(ordinary.events[0]!.params.amount) * 2,
    );
  });

  it('Scavenger multiplies chest gold by 1.5', () => {
    const s = createGame(config);
    const chest = s.board.spaces.find((space) => space.kind === 'chest')!;
    s.players[0]!.pos = chest.id;
    s.players[0]!.perks = ['scavenger'];
    s.rng = seedRng('chest-scavenger');
    const baseline = structuredClone(s);
    baseline.players[0]!.perks = [];
    const ordinary = resolveSpace(baseline, 0);
    const boosted = resolveSpace(s, 0);
    expect(boosted.events[0]!.type).toBe('GoldGained');
    expect(ordinary.events[0]!.type).toBe('GoldGained');
    expect(boosted.events[0]!.params.amount).toBe(
      Math.floor(Number(ordinary.events[0]!.params.amount) * 1.5),
    );
  });

  it('trap can skip the next turn with a pinned seed', () => {
    const s = createGame(config);
    const trap = s.board.spaces.find((space) => space.kind === 'trap')!;
    s.players[0]!.pos = trap.id;
    s.rng = seedRng('trap-skip-0');
    const result = resolveSpace(s, 0);
    expect(result.events[0]!.type).toBe('TrapTriggered');
    expect(result.events[0]!.params.skipped).toBe(1);
    expect(s.players[0]!.skipTurns).toBe(1);
  });

  it('placed traps trigger before castle and chest behavior, then are consumed', () => {
    for (const kind of ['castle', 'chest'] as const) {
      const s = createGame(config);
      const space = s.board.spaces.find((candidate) => candidate.kind === kind)!;
      s.players[0]!.pos = space.id;
      s.players[0]!.gold = 1000;
      s.players[0]!.hp = 1;
      s.worldRule = '';
      s.traps[space.id] = 1;
      const result = resolveSpace(s, 0);
      expect(result.events.some((entry) => entry.type === 'TrapTriggered')).toBe(true);
      expect(result.events.find((entry) => entry.type === 'TrapTriggered')!.params.goldLost).toBe(
        100,
      );
      expect(s.traps[space.id]).toBeUndefined();
      if (kind === 'castle') expect(s.players[0]!.hp).toBe(s.players[0]!.stats.maxHp);
    }
  });

  it('does not trigger or consume the placer’s trap on a non-trap space', () => {
    const s = createGame(config);
    const castle = s.board.spaces.find((space) => space.kind === 'castle')!;
    s.players[1]!.pos = castle.id;
    s.traps[castle.id] = 1;
    const result = resolveSpace(s, 1);
    expect(result.events.some((entry) => entry.type === 'TrapTriggered')).toBe(false);
    expect(s.players[1]!.gold).toBe(300);
    expect(s.traps[castle.id]).toBe(1);
  });

  it('chest rewards advance RNG and trap applies gold loss', () => {
    const chest = createGame(config);
    const chestSpace = chest.board.spaces.find((space) => space.kind === 'chest')!;
    chest.players[0]!.pos = chestSpace.id;
    const before = chest.rng;
    const reward = resolveSpace(chest, 0);
    expect(reward.state.rng).not.toEqual(before);
    expect(
      reward.events.some((entry) =>
        ['GoldGained', 'ItemFound', 'ItemAutoSold'].includes(entry.type),
      ),
    ).toBe(true);
    const trap = createGame(config);
    const trapSpace = trap.board.spaces.find((space) => space.kind === 'trap')!;
    trap.players[0]!.pos = trapSpace.id;
    const trapped = resolveSpace(trap, 0);
    expect(trapped.state.players[0]!.gold).toBe(270);
  });
});
