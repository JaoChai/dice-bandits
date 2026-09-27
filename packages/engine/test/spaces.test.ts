import { describe, expect, it } from 'vitest';
import { createGame, step, legalActions } from '../src/index';
import { resolveSpace, shopStock } from '../src/rules/spaces';
import { collectTaxes } from '../src/rules/towns';
import { startBattle } from '../src/rules/battle';
import { BALANCE } from '../src/data/index';
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
    const first = step(s, { type: 'battlePick', side: 'a', pick: 'attack' });
    const won = step(first.state, { type: 'battlePick', side: 'b', pick: 'attack' });
    expect(won.state.towns[0]!.owner).toBe(0);
    expect(won.state.stats.townFlips[town.spaceId]).toBe(1);
    expect(won.events.some((entry) => entry.type === 'TownFlipped')).toBe(true);
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
