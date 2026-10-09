import { createGame, startBattle } from '@dice-bandits/engine';
import type Phaser from 'phaser';
import { describe, expect, it } from 'vitest';
import { drawFighters } from '../../src/scenes/battle/fighters';
import { battleLayout } from '../../src/scenes/battle/layout';

function fixture() {
  const state = createGame({
    seed: 'secret-privacy',
    rounds: 12,
    seats: [
      { name: 'Alice', classId: 'knight', control: 'human', personality: null },
      { name: 'Bob', classId: 'thief', control: 'human', personality: null },
    ],
  });
  const rival = state.players[1]!;
  return startBattle(state, {
    context: 'pvp',
    spaceId: state.players[0]!.pos,
    opponent: {
      kind: 'player',
      seat: 1,
      monsterId: null,
      level: rival.level,
      hp: rival.hp,
      stats: rival.stats,
      secretUsed: false,
      buffs: { ironSkin: false, poison: false, halveNext: false },
    },
  }).state;
}

function renderedStars(state: ReturnType<typeof fixture>) {
  const texts: Array<{ x: number; text: string }> = [];
  // Only the Phaser boundary is replaced: keep the real fighter renderer and
  // inspect its emitted display list, not expectations on a mocked renderer.
  const sprite = {
    texture: { has: () => true },
    setOrigin() {
      return this;
    },
    setScale() {
      return this;
    },
    setFlipX() {
      return this;
    },
    setDepth() {
      return this;
    },
    setFrame() {
      return this;
    },
  };
  const text = {
    setOrigin() {
      return this;
    },
    setDepth() {
      return this;
    },
  };
  const scene = {
    textures: { exists: () => true, get: () => ({ has: () => true }) },
    tweens: { add: () => {} },
    add: {
      sprite: () => ({ ...sprite }),
      text: (x: number, _y: number, value: string) => {
        texts.push({ x, text: value });
        return { ...text };
      },
    },
  };
  drawFighters(scene as unknown as Phaser.Scene, state, battleLayout());
  return texts.filter((entry) => entry.text === '★').map((entry) => entry.x);
}

describe('secret-star privacy', () => {
  for (const attackerSide of ['a', 'b'] as const) {
    it(`hides the pending attacker secret on side ${attackerSide}`, () => {
      const state = fixture();
      if (state.phase.kind !== 'battle') throw new Error('expected battle');
      const battle = state.phase.battle;
      battle.attackerSide = attackerSide;
      battle[attackerSide].secretUsed = true;
      battle.pending.attack = 'secret';
      expect(renderedStars(state)).toEqual([]);
    });

    it(`hides the pending defender secret when attacker is ${attackerSide}`, () => {
      const state = fixture();
      if (state.phase.kind !== 'battle') throw new Error('expected battle');
      const battle = state.phase.battle;
      battle.attackerSide = attackerSide;
      battle[attackerSide === 'a' ? 'b' : 'a'].secretUsed = true;
      battle.pending = { attack: 'attack', defense: 'secret' };
      expect(renderedStars(state)).toEqual([]);
    });
  }

  it('keeps both previously revealed stars when no secret is pending', () => {
    const state = fixture();
    if (state.phase.kind !== 'battle') throw new Error('expected battle');
    state.phase.battle.a.secretUsed = true;
    state.phase.battle.b.secretUsed = true;
    expect(renderedStars(state)).toEqual([battleLayout().left.x, battleLayout().right.x]);
    state.phase.battle.pending = { attack: 'attack', defense: 'defend' };
    expect(renderedStars(state)).toEqual([battleLayout().left.x, battleLayout().right.x]);
  });

  it('hides only the pending side and retains the other revealed star', () => {
    const state = fixture();
    if (state.phase.kind !== 'battle') throw new Error('expected battle');
    state.phase.battle.attackerSide = 'a';
    state.phase.battle.a.secretUsed = true;
    state.phase.battle.b.secretUsed = true;
    state.phase.battle.pending.attack = 'secret';
    expect(renderedStars(state)).toEqual([battleLayout().right.x]);
  });
});
