import type { GameEvent, GameState, StepResult } from '../types';
import { BALANCE, ITEMS, MONSTERS } from '../data/index';
import { nextFloat, nextInt, pick } from '../rng';
import { startBattle } from './battle';
import { receiveItem } from './items';

const event = (
  type: string,
  seat: number | null,
  params: Record<string, string | number> = {},
): GameEvent => ({ type, seat, params });
const REGION_TIER: Record<string, number> = { meadow: 1, desert: 2, snow: 2, volcano: 3 };

export function shopStock(state: GameState, spaceId: number): string[] {
  const space = state.board.spaces[spaceId]!;
  const tier = REGION_TIER[space.region] ?? 1;
  const pool = ITEMS.filter(
    (item) => item.kind !== 'equipment' || tierForPrice(item.price) <= tier,
  );
  let rng = state.rng;
  const remaining = pool.map((item) => item.id);
  const stock: string[] = [];
  while (stock.length < 6 && remaining.length > 0) {
    const weights = remaining.map((id) => {
      const item = ITEMS.find((candidate) => candidate.id === id)!;
      return tierForPrice(item.price) === tier ? 3 : 1;
    });
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const [draw, next] = nextInt(rng, 1, totalWeight);
    rng = next;
    let cursor = draw;
    const index = weights.findIndex((weight) => {
      cursor -= weight;
      return cursor <= 0;
    });
    stock.push(remaining.splice(index, 1)[0]!);
  }
  if (state.worldRule === 'blackMarket') {
    const rare = ITEMS.filter(
      (item) =>
        item.kind === 'equipment' && tierForPrice(item.price) === 3 && !stock.includes(item.id),
    ).map((item) => item.id);
    const [item, nextRng] = pick(rng, rare);
    rng = nextRng;
    stock.push(item);
  }
  state.rng = rng;
  return stock;
}
function tierForPrice(price: number): number {
  return price >= 900 ? 3 : price >= 400 ? 2 : 1;
}

export function resolveSpace(state: GameState, seat = state.turnSeat): StepResult {
  const player = state.players[seat]!;
  const space = state.board.spaces[player.pos]!;
  const placedTrap = state.traps?.[space.id];
  if (space.kind !== 'trap' && placedTrap !== undefined && placedTrap !== seat) {
    delete state.traps[space.id];
    const trapped = triggerTrap(state, seat, space.id);
    const landed = resolveSpaceBehavior(state, seat);
    return { state: landed.state, events: [...trapped.events, ...landed.events] };
  }
  return resolveSpaceBehavior(state, seat);
}

function resolveSpaceBehavior(state: GameState, seat: number): StepResult {
  const player = state.players[seat]!;
  const space = state.board.spaces[player.pos]!;
  switch (space.kind) {
    case 'castle': {
      const pct = state.worldRule === 'cursedCapital' ? 50 : 100;
      const amount = Math.min(
        player.stats.maxHp - player.hp,
        Math.ceil((player.stats.maxHp * pct) / 100),
      );
      player.hp += amount;
      return { state, events: [event('CastleHealed', seat, { amount })] };
    }
    case 'town':
      return resolveTown(state, seat, space.id);
    case 'shop':
      state.phase = { kind: 'shop', stock: shopStock(state, space.id) };
      return { state, events: [event('ShopOpened', seat, { spaceId: space.id })] };
    case 'chest':
      return chest(state, seat);
    case 'monster': {
      if (player.skipNextFight) {
        player.skipNextFight = false;
        return { state, events: [event('FightSkipped', seat, { spaceId: space.id })] };
      }
      const pool = Object.entries(MONSTERS).filter(([, m]) => m.regions.includes(space.region));
      let rng = state.rng;
      const [chosen, next] = pick(rng, pool);
      rng = next;
      state.rng = rng;
      const [id, def] = chosen;
      const level = state.worldRule === 'monsterSurge' ? 2 : 1;
      const scale = (k: keyof typeof def.base) => def.base[k] + def.growth[k] * (level - 1);
      const opponent = {
        kind: 'monster' as const,
        seat: null,
        monsterId: id,
        level,
        hp: scale('maxHp'),
        stats: {
          maxHp: scale('maxHp'),
          atk: scale('atk'),
          def: scale('def'),
          spd: scale('spd'),
          mag: scale('mag'),
        },
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      };
      return startBattle(state, { context: 'monster', spaceId: space.id, opponent });
    }
    case 'event':
      return randomEvent(state, seat);
    case 'trap':
      return triggerTrap(state, seat, space.id);
  }
}

function resolveTown(state: GameState, seat: number, spaceId: number): StepResult {
  const town = state.towns.find((t) => t.spaceId === spaceId)!;
  if (town.owner === seat) {
    state.phase = { kind: 'townManage', spaceId };
    return { state, events: [event('TownVisited', seat, { spaceId })] };
  }
  if (state.players[seat]!.skipNextFight) {
    state.players[seat]!.skipNextFight = false;
    return { state, events: [event('FightSkipped', seat, { spaceId })] };
  }
  if (town.owner !== null) {
    state.phase = { kind: 'townChallenge', spaceId };
    return { state, events: [event('TownChallenged', seat, { spaceId, owner: town.owner })] };
  }
  const region = state.board.spaces[spaceId]!.region;
  const [id, def] = Object.entries(MONSTERS).find(([, m]) => m.regions.includes(region))!;
  const level = Math.max(1, town.guardianLevel) + (state.worldRule === 'monsterSurge' ? 1 : 0);
  const scale = (k: keyof typeof def.base) => def.base[k] + def.growth[k] * (level - 1);
  const opponent = {
    kind: 'monster' as const,
    seat: null,
    monsterId: id,
    level,
    hp: scale('maxHp'),
    stats: {
      maxHp: scale('maxHp'),
      atk: scale('atk'),
      def: scale('def'),
      spd: scale('spd'),
      mag: scale('mag'),
    },
    secretUsed: false,
    buffs: { ironSkin: false, poison: false, halveNext: false },
  };
  return startBattle(state, { context: 'town', spaceId, opponent });
}

function chest(state: GameState, seat: number): StepResult {
  const p = state.players[seat]!;
  let rng = state.rng;
  const [roll, r1] = nextInt(rng, 1, 100);
  rng = r1;
  const events: GameEvent[] = [];
  if (roll <= 30) {
    const pool = ITEMS.filter((item) => item.kind !== 'equipment' || item.price <= 400).map(
      (item) => item.id,
    );
    const [id, r2] = pick(rng, pool);
    rng = r2;
    receiveItem(state, seat, id, events);
    if (
      p.items.length <= BALANCE.inventoryMax &&
      !events.some((entry) => entry.type === 'ItemAutoSold')
    )
      events.push(event('ItemFound', seat, { item: id }));
  } else {
    const [lo, hi] = BALANCE.chestGold;
    const [gold, r2] = nextInt(rng, lo, hi);
    rng = r2;
    const multiplier =
      (state.worldRule === 'goldRush' ? 2 : 1) * (p.perks.includes('scavenger') ? 1.5 : 1);
    const gained = Math.floor(gold * multiplier);
    p.gold += gained;
    events.push(event('GoldGained', seat, { amount: gained }));
  }
  state.rng = rng;
  return { state, events };
}

function randomEvent(state: GameState, seat: number): StepResult {
  let rng = state.rng;
  const [n, r1] = nextInt(rng, 0, 5);
  rng = r1;
  const p = state.players[seat]!;
  const events: GameEvent[] = [];
  if (n === 0) {
    const [g, r] = nextInt(rng, 50, 150);
    rng = r;
    p.gold += g;
    events.push(event('GoldGained', seat, { amount: g }));
  } else if (n === 1) {
    const loss = Math.floor(p.gold * 0.1);
    p.gold -= loss;
    events.push(event('GoldLost', seat, { amount: loss }));
  } else if (n === 2) {
    const amount = p.stats.maxHp - p.hp;
    p.hp = p.stats.maxHp;
    events.push(event('Healed', seat, { amount }));
  } else if (n === 3) {
    const towns = state.towns;
    if (towns.length) {
      const [town, r] = pick(rng, towns);
      rng = r;
      p.pos = town.spaceId;
      events.push(event('Teleported', seat, { to: town.spaceId }));
    }
  } else if (n === 4) {
    const pool = ITEMS.filter((i) => i.kind !== 'equipment').map((i) => i.id);
    const [id, r] = pick(rng, pool);
    rng = r;
    receiveItem(state, seat, id, events);
    if (!events.some((entry) => entry.type === 'ItemAutoSold'))
      events.push(event('ItemFound', seat, { item: id }));
  } else {
    let gained = 0;
    for (const other of state.players)
      if (other.seat !== seat) {
        const amount = Math.floor(other.gold * 0.05);
        other.gold -= amount;
        gained += amount;
      }
    p.gold += gained;
    events.push(event('GoldStolen', seat, { amount: gained }));
  }
  state.rng = rng;
  return { state, events };
}

function triggerTrap(state: GameState, seat: number, spaceId: number): StepResult {
  const owner = state.traps?.[spaceId];
  if (owner === seat) return { state, events: [] };
  const p = state.players[seat]!;
  const lost = Math.floor((p.gold * BALANCE.trapGoldLossPct) / 100);
  p.gold -= lost;
  let rng = state.rng;
  const [f, next] = nextFloat(rng);
  rng = next;
  state.rng = rng;
  if (f < BALANCE.trapSkipChance) p.skipTurns += 1;
  return {
    state,
    events: [
      event('TrapTriggered', seat, { goldLost: lost, skipped: f < BALANCE.trapSkipChance ? 1 : 0 }),
    ],
  };
}
