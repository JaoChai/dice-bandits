import { createGame, type GameEvent, type GameState } from '@dice-bandits/engine';
import { describe, expect, it } from 'vitest';
import { createRoom } from '../src/model';
import { roomStep } from '../src/roomStep';
import { redactBattlePickEvents } from '../src/redact';
import { viewForSeat } from '../src/play';
import type { Room } from '../src/model';
import type { RoomInput, Outbound } from '../src/roomStep';

function battleRoom(): Room {
  const game = createGame({
    seed: 'redaction-fixture-seed',
    rounds: 12,
    seats: [
      { name: 'Ada', classId: 'knight', control: 'human', personality: null },
      { name: 'Bea', classId: 'mage', control: 'human', personality: null },
      { name: 'Bot 3', classId: 'thief', control: 'bot', personality: 'greedy' },
      { name: 'Bot 4', classId: 'cleric', control: 'bot', personality: 'vengeful' },
    ],
  });
  game.phase = {
    kind: 'battle',
    battle: {
      context: 'pvp',
      spaceId: 0,
      a: {
        kind: 'player',
        seat: 0,
        monsterId: null,
        level: 1,
        hp: 20,
        stats: { maxHp: 20, atk: 4, def: 3, spd: 2, mag: 1 },
        secretUsed: false,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
      b: {
        kind: 'player',
        seat: 1,
        monsterId: null,
        level: 1,
        hp: 20,
        stats: { maxHp: 20, atk: 4, def: 3, spd: 1, mag: 4 },
        secretUsed: true,
        buffs: { ironSkin: false, poison: false, halveNext: false },
      },
      exchange: 1,
      attackerSide: 'a',
      half: 1,
      pending: { attack: 'attack', defense: 'secret' },
    },
  };
  const room = createRoom('ABCDE', 'Ada', 'hash-0', 100);
  return {
    ...room,
    status: 'playing',
    game,
    seats: Array.from({ length: 4 }, (_, seat) => ({
      seat,
      name: game.players[seat]!.name,
      classId: game.players[seat]!.classId,
      kind: seat < 2 ? ('human' as const) : ('bot' as const),
      controller: 'player' as const,
      connected: true,
      tokenHash: null,
      disconnectDeadline: null,
      idleDeadline: null,
    })),
  };
}

describe('per-seat game redaction', () => {
  it('hides opponent pending picks and secret usage while preserving own picks and server state', () => {
    const room = battleRoom();
    const before = structuredClone(room.game);
    const view0 = viewForSeat(room, 0);
    expect(view0.type).toBe('view');
    if (view0.type !== 'view') throw new Error('expected view');
    expect(view0.state.phase.kind).toBe('battle');
    if (view0.state.phase.kind !== 'battle') throw new Error('expected battle');
    expect(view0.state.phase.battle.pending).toEqual({ attack: 'attack', defense: null });
    expect(view0.state.phase.battle.b.secretUsed).toBe(false);
    expect(view0.opponentPicked).toBe(true);
    expect(view0.state.rng).toEqual([0, 0, 0, 0]);
    expect(view0.state.config.seed).toBe('');

    const view1 = viewForSeat(room, 1);
    if (view1.type !== 'view') throw new Error('expected view');
    expect(view1.state.phase.kind).toBe('battle');
    if (view1.state.phase.kind !== 'battle') throw new Error('expected battle');
    expect(view1.state.phase.battle.pending).toEqual({ attack: null, defense: 'secret' });
    expect(view1.opponentPicked).toBe(true);
    expect(view1.state.phase.battle.b.secretUsed).toBe(true);

    const monsterGame = structuredClone(room.game!);
    if (monsterGame.phase.kind !== 'battle') throw new Error('expected battle');
    monsterGame.phase.battle.b = {
      ...monsterGame.phase.battle.b,
      kind: 'monster',
      seat: null,
      monsterId: 'goblin',
      secretUsed: false,
    };
    const monsterRoom = { ...room, game: monsterGame };
    const monsterView = viewForSeat(monsterRoom, 0);
    if (monsterView.type !== 'view' || monsterView.state.phase.kind !== 'battle')
      throw new Error('expected battle view');
    expect(monsterView.state.phase.battle.pending.defense).toBeNull();
    expect(monsterView.opponentPicked).toBe(true);
    expect(room.game).toEqual(before);
  });

  it('redacts pending BattlePick events but reveals both once the picks resolve', () => {
    const room = battleRoom();
    const game = room.game!;
    const events: GameEvent[] = [
      { type: 'BattlePick', seat: 1, params: { side: 'b', pick: 'secret', role: 'defense' } },
      { type: 'BattlePick', seat: 0, params: { side: 'a', pick: 'strike', role: 'attack' } },
    ];
    const viewer0 = redactBattlePickEvents(events, game, 0);
    expect(viewer0.map((event) => event.params.pick)).toEqual(['hidden', 'strike']);
    const viewer1 = redactBattlePickEvents(events, game, 1);
    expect(viewer1.map((event) => event.params.pick)).toEqual(['secret', 'hidden']);
    expect(events.map((event) => event.params.pick)).toEqual(['secret', 'strike']);

    const resolved = structuredClone(game);
    if (resolved.phase.kind !== 'battle') throw new Error('expected battle');
    resolved.phase.battle.pending = { attack: null, defense: null };
    expect(redactBattlePickEvents(events, resolved, 0).map((event) => event.params.pick)).toEqual([
      'secret',
      'strike',
    ]);
  });

  it('redacts every seat-facing output throughout 30 seeded all-bot games', () => {
    for (let gameIndex = 0; gameIndex < 30; gameIndex += 1) {
      const seed = `redaction-property-${gameIndex}`;
      const initial = createRoom(`R${String(gameIndex).padStart(4, '0')}`, 'Bot 1', 'hash', 0);
      const start: RoomInput = {
        kind: 'msg',
        seat: 0,
        conn: 'host',
        msg: { type: 'start' },
        seed,
      };
      let result = roomStep(initial, start, 1);
      let room = result.room!;
      assertNoLeaks(result.out, room.game!);
      room = {
        ...room,
        pendingBotWork: true,
        seats: room.seats.map((seat) => ({ ...seat, controller: 'botTakeover' })),
      };
      let steps = 0;
      while (room.status !== 'finished' && steps < 3000) {
        result = roomStep(room, { kind: 'alarm' }, steps + 2);
        room = result.room!;
        assertNoLeaks(result.out, room.game!);
        steps += 1;
      }
      expect(room.status, `seed ${seed}`).toBe('finished');
    }
  });
});

function assertNoLeaks(out: Outbound[], full: GameState): void {
  for (const { to, msg } of out) {
    if (typeof to !== 'number') continue;
    if (msg.type === 'view') {
      expect(msg.state.rng).toEqual([0, 0, 0, 0]);
      expect(msg.state.config.seed).toBe('');
      if (full.phase.kind === 'battle') {
        const battle = full.phase.battle;
        const viewBattle = msg.state.phase.kind === 'battle' ? msg.state.phase.battle : null;
        if (viewBattle) {
          for (const [side, role] of [
            ['a', battle.attackerSide === 'a' ? 'attack' : 'defense'],
            ['b', battle.attackerSide === 'b' ? 'attack' : 'defense'],
          ] as const) {
            const pick = role === 'attack' ? battle.pending.attack : battle.pending.defense;
            if (pick === null) continue;
            const combatant = side === 'a' ? battle.a : battle.b;
            if (combatant.seat !== msg.you) {
              expect(
                role === 'attack' ? viewBattle.pending.attack : viewBattle.pending.defense,
              ).toBeNull();
              expect(msg.opponentPicked).toBe(true);
              if (pick === 'secret') {
                const viewCombatant = side === 'a' ? viewBattle.a : viewBattle.b;
                expect(viewCombatant.secretUsed).toBe(false);
              }
            }
          }
        }
      }
    }
    if (msg.type === 'events' && full.phase.kind === 'battle') {
      for (const [side, role] of [
        ['a', full.phase.battle.attackerSide === 'a' ? 'attack' : 'defense'],
        ['b', full.phase.battle.attackerSide === 'b' ? 'attack' : 'defense'],
      ] as const) {
        const pick =
          role === 'attack' ? full.phase.battle.pending.attack : full.phase.battle.pending.defense;
        const combatant = side === 'a' ? full.phase.battle.a : full.phase.battle.b;
        if (pick === null || combatant.seat === to) continue;
        const last = msg.events.findLast(
          (event) => event.type === 'BattlePick' && event.params.role === role,
        );
        if (last) expect(last.params.pick).toBe('hidden');
      }
    }
  }
}
