import { createGame, startBattle, step, type GameEvent } from '@dice-bandits/engine';
import type Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBattleEffects } from '../../src/scenes/battle/effects';
import { battleLayout } from '../../src/scenes/battle/layout';
import { planBattle, type BattleBeat } from '../../src/scenes/battle/presentation';
import type { BattleFighters } from '../../src/scenes/battle/fighters';

function fixture(classId: 'knight' | 'thief' | 'mage' | 'cleric' = 'knight', monster = true) {
  const state = createGame({
    seed: 'r1-cues',
    rounds: 12,
    seats: [
      { name: 'Hero', classId, control: 'human', personality: null },
      { name: 'Rival', classId: 'knight', control: 'human', personality: null },
    ],
  });
  const rival = state.players[1]!;
  return startBattle(state, {
    context: monster ? 'monster' : 'pvp',
    spaceId: 1,
    opponent: {
      kind: monster ? 'monster' : 'player',
      seat: monster ? null : 1,
      monsterId: monster ? 'jellyBun' : null,
      level: 1,
      hp: rival.hp,
      stats: rival.stats,
      secretUsed: false,
      buffs: { ironSkin: false, poison: false, halveNext: false },
    },
  }).state;
}
const pick = (side: 'a' | 'b', value: string, seat: number | null): GameEvent => ({
  type: 'BattlePick',
  seat,
  params: { side, pick: value, role: side === 'a' ? 'attack' : 'defense' },
});
const damage: GameEvent = {
  type: 'DamageDealt',
  seat: null,
  params: { attacker: 0, defender: 'jellyBun', toDefender: 7, toAttacker: 0 },
};
function plan(events: GameEvent[], state = fixture()) {
  return planBattle(state, structuredClone(state), events, 'human', false);
}
function getBeat(beats: BattleBeat[], kind: BattleBeat['kind']) {
  return beats.find((beat) => beat.kind === kind)!;
}

// Boundary recorder: real planner/effects emit objects, geometry and tween specs.
// Phaser's GPU and time progression alone are substituted; browser tests cover them.
type RecordedObject = {
  [key: string]: unknown;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  alpha: number;
  name: string;
  destroyed: boolean;
  frame: { name: string };
  geometry: unknown[][];
  tint?: number;
};
type RecordedTween = {
  onUpdate?: (tween: { progress: number }) => void;
  targets: unknown;
  x: number;
  delay: number;
  duration: number;
  removed: boolean;
  remove(): void;
};
function renderer(detached = false) {
  const objects: RecordedObject[] = [];
  const tweens: RecordedTween[] = [];
  const handles: { targets: unknown[] | null; remove(): void }[] = [];
  const object = (x = 0, y = 0) => {
    const obj: RecordedObject = {
      x,
      y,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      alpha: 1,
      flipX: false,
      texture: { key: 'hero', has: () => true },
      frame: { name: 'idle' },
      name: '',
      destroyed: false,
      geometry: [],
    };
    for (const method of [
      'setOrigin',
      'setDepth',
      'setDisplaySize',
      'lineStyle',
      'fillStyle',
      'beginPath',
      'strokePath',
      'fillPath',
      'closePath',
    ])
      obj[method] = () => obj;
    for (const method of [
      'arc',
      'moveTo',
      'lineTo',
      'fillEllipse',
      'fillRect',
      'strokeCircle',
      'strokeEllipse',
      'strokeRect',
      'lineStyle',
      'fillStyle',
    ])
      obj[method] = (...args: unknown[]) => {
        obj.geometry.push([method, ...args]);
        return obj;
      };
    obj.setName = (name: string) => {
      obj.name = name;
      return obj;
    };
    obj.setPosition = (x: number, y: number) => {
      Object.assign(obj, { x, y });
      return obj;
    };
    obj.setX = (x: number) => {
      obj.x = x;
      return obj;
    };
    obj.setScale = (x: number, y = x) => {
      obj.scaleX = x;
      obj.scaleY = y;
      return obj;
    };
    obj.setFlipX = (value: boolean) => {
      obj.flipX = value;
      return obj;
    };
    obj.setAlpha = (value: number) => {
      obj.alpha = value;
      return obj;
    };
    obj.setAngle = (value: number) => {
      obj.angle = value;
      return obj;
    };
    obj.setDisplaySize = (width: number, height: number) => {
      obj.displayWidth = width;
      obj.displayHeight = height;
      return obj;
    };
    obj.setY = (y: number) => {
      obj.y = y;
      return obj;
    };
    obj.setTintMode = (mode: number) => {
      obj.tintMode = mode;
      return obj;
    };
    obj.setFrame = (value: string) => {
      obj.frame.name = value;
      return obj;
    };
    obj.setTint = (value: number) => {
      obj.tint = value;
      return obj;
    };
    obj.clearTint = () => {
      delete obj.tint;
      return obj;
    };
    obj.destroy = () => {
      obj.destroyed = true;
    };
    objects.push(obj);
    return obj;
  };
  const layout = battleLayout();
  const source = {
    a: object(layout.left.x, layout.left.y),
    b: object(layout.right.x, layout.right.y),
  };
  const flash = vi.fn(),
    shake = vi.fn();
  const scene = {
    add: {
      sprite: object,
      image: (x: number, y: number, key: string, frame: string) => {
        const image = object(x, y);
        image.frame.name = frame;
        image.texture = { key, has: () => true };
        return image;
      },
      text: object,
      graphics: () => object(),
    },
    textures: { exists: () => true, get: () => ({ has: () => true }) },
    cameras: { main: { flash, shake } },
    tweens: {
      killTweensOf: vi.fn(),
      add: (config: Record<string, unknown>) => {
        const tween: RecordedTween = {
          ...config,
          targets: config.targets,
          x: Number(config.x),
          delay: Number(config.delay ?? 0),
          duration: Number(config.duration),
          removed: false,
          remove() {
            this.removed = true;
          },
        };
        tweens.push(tween);
        const handle = {
          targets: [config.targets] as unknown[] | null,
          remove: () => tween.remove(),
        };
        handles.push(handle);
        return handle;
      },
    },
  };
  const effects = createBattleEffects(
    scene as unknown as Phaser.Scene,
    source as unknown as BattleFighters,
    layout,
    detached,
  );
  return {
    effects,
    source,
    objects,
    tweens,
    flash,
    shake,
    layout,
    handles,
    active: () => objects.filter((obj) => !obj.destroyed && obj.name.startsWith('battle-effect-')),
  };
}
describe('Lead stronger-impact corrections', () => {
  it.each(['firestorm', 'pickpocket'] as const)(
    'switching to reduced motion between beats removes persistent %s effects immediately',
    (secret) => {
      const r = renderer();
      const beats = plan(
        [{ type: 'SecretUsed', seat: 0, params: { side: 'a', secret, stolen: 10 } }],
        fixture('thief', false),
      );
      r.effects.showBeat(getBeat(beats, 'lunge'));
      expect(r.active().length).toBeGreaterThan(0);
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      r.effects.showBeat(getBeat(beats, 'impact'));
      expect(r.active()).toEqual([]);
      expect(r.tweens.every((t) => t.removed)).toBe(true);
    },
  );
  it('completed Phaser tweens release targets without breaking the next beat or persistent fields', () => {
    const r = renderer();
    const beats = plan([
      { type: 'SecretUsed', seat: 0, params: { side: 'a', secret: 'firestorm' } },
      damage,
    ]);
    r.effects.showBeat(getBeat(beats, 'lunge'));
    for (const handle of r.handles) handle.targets = null;
    expect(() => r.effects.showBeat(getBeat(beats, 'impact'))).not.toThrow();
    expect(r.active().some((o) => o.name === 'battle-effect-firestorm-a')).toBe(true);
    r.effects.destroy();
    expect(r.active()).toEqual([]);
  });
  it.each(['attack', 'strike'] as const)(
    '%s flashes its actual recipient and draws a fighter-scale burst',
    (command) => {
      const r = renderer();
      const beats = plan([pick('a', command, 0), damage]);
      r.effects.showBeat({
        ...getBeat(beats, 'impact'),
        targets: getBeat(beats, 'damage').targets,
      });
      expect(r.source.b.tint).toBe(0xffffff);
      expect(r.source.b.tintMode).toBe(1);
      expect(getBeat(beats, 'impact').duration).toBeGreaterThanOrEqual(60);
      expect(r.shake).toHaveBeenCalledExactlyOnceWith(90, command === 'strike' ? 0.016 : 0.01);
      expect(r.source.a.tint).toBeUndefined();
      const burst = r.active().find((o) => o.name === 'battle-effect-impact-b')!;
      const xs = burst.geometry
        .filter((g) => ['moveTo', 'lineTo'].includes(String(g[0])))
        .map((g) => Number(g[1]));
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(
        r.layout.fighterHeight * (command === 'strike' ? 0.8 : 0.5),
      );
      expect(burst.geometry).toContainEqual(['fillStyle', 0xffffff, 1]);
      expect(burst.geometry.some((g) => g[0] === 'lineStyle' && g[2] === 0x5c3317)).toBe(true);
      r.effects.showBeat(getBeat(beats, 'damage'));
      expect(r.source.b.tint).toBeUndefined();
    },
  );
  it.each(['attack', 'strike'] as const)(
    '%s has outlined white slash core for the entire 180ms lunge',
    (command) => {
      const r = renderer();
      const lunge = getBeat(plan([pick('a', command, 0), damage]), 'lunge');
      r.effects.showBeat(lunge);
      const arc = r.active().find((o) => o.name === `battle-effect-${command}-arc-a`)!;
      const strokes = arc.geometry.filter((g) => g[0] === 'lineStyle');
      expect(strokes.some((g) => g[2] === 0xffffff)).toBe(true);
      expect(strokes.some((g) => g[2] === 0x5c3317)).toBe(true);
      expect(r.tweens.find((tw) => tw.targets === arc)!.duration).toBeGreaterThanOrEqual(150);
    },
  );
  it('Firestorm has three fighter-scale bright pillars and does not restart them at damage', () => {
    const r = renderer();
    const beats = plan([
      { type: 'SecretUsed', seat: 0, params: { side: 'a', secret: 'firestorm' } },
      damage,
    ]);
    r.effects.showBeat(getBeat(beats, 'lunge'));
    const fire = r.active().find((o) => o.name === 'battle-effect-firestorm-a')!;
    const pillars = fire.geometry.filter(
      (g) =>
        g[0] === 'fillRect' &&
        Number(g[3]) >= r.layout.fighterHeight * 0.22 &&
        Number(g[4]) >= r.layout.fighterHeight * 1.2,
    );
    expect(pillars).toHaveLength(3);
    expect(fire.geometry).toContainEqual(['fillStyle', 0xffffff, 1]);
    r.effects.showBeat({ ...getBeat(beats, 'impact'), targets: getBeat(beats, 'damage').targets });
    r.effects.showBeat(getBeat(beats, 'damage'));
    expect(r.active().find((o) => o.name === fire.name)).toBe(fire);
    expect(fire.destroyed).toBe(false);
    r.effects.destroy();
    expect(fire.destroyed).toBe(true);
  });
  it('Sanctuary outlined field remains the same caster object through >=400ms of damage', () => {
    const r = renderer();
    const beats = plan([
      { type: 'SecretUsed', seat: 0, params: { side: 'a', secret: 'sanctuary' } },
    ]);
    r.effects.showBeat(getBeat(beats, 'lunge'));
    const field = r.active().find((o) => o.name === 'battle-effect-sanctuary-a')!;
    expect(field.geometry.some((g) => g[0] === 'lineStyle' && g[2] === 0x5c3317)).toBe(true);
    r.effects.showBeat(getBeat(beats, 'impact'));
    r.effects.showBeat(getBeat(beats, 'damage'));
    expect(getBeat(beats, 'damage').duration).toBeGreaterThanOrEqual(400);
    expect(r.active().find((o) => o.name === field.name)).toBe(field);
    r.effects.showBeat(getBeat(beats, 'drain'));
    expect(field.destroyed).toBe(true);
  });
  it('positive theft uses five readable atlas coins on >=300ms arcing target-to-thief tweens without restarting', () => {
    const r = renderer();
    const beats = plan(
      [{ type: 'SecretUsed', seat: 0, params: { side: 'a', secret: 'pickpocket', stolen: 10 } }],
      fixture('thief', false),
    );
    r.effects.showBeat(getBeat(beats, 'lunge'));
    const coins = r.active().filter((o) => o.name === 'battle-effect-transfer-a');
    expect(coins).toHaveLength(5);
    for (const coin of coins) {
      expect(coin.frame.name).toBe('coin');
      expect(Number(coin.displayWidth)).toBeGreaterThanOrEqual(r.layout.fighterHeight * 0.15);
      expect(coin.x).toBe(r.layout.right.x);
      const tw = r.tweens.find((tw) => tw.targets === coin)!;
      expect(tw.duration).toBeGreaterThanOrEqual(300);
      expect(tw.x).toBe(r.layout.left.x);
      expect(tw.onUpdate).toBeTypeOf('function');
    }
    r.effects.showBeat(getBeat(beats, 'impact'));
    r.effects.showBeat(getBeat(beats, 'damage'));
    expect(r.active().filter((o) => o.name === 'battle-effect-transfer-a')).toEqual(coins);
    r.effects.destroy();
    expect(coins.every((o) => o.destroyed)).toBe(true);
    expect(r.tweens.every((tw) => tw.removed)).toBe(true);
  });
  it('bot-length impact cannot shake or flash the camera', () => {
    const r = renderer();
    const impact = getBeat(plan([pick('a', 'strike', 0), damage]), 'impact');
    r.effects.showBeat({
      ...impact,
      duration: 24.3,
      targets: [{ side: 'b', amount: 7, fromHp: 40, toHp: 33 }],
    });
    expect(r.shake).not.toHaveBeenCalled();
    expect(r.flash).not.toHaveBeenCalled();
  });
});

describe('stronger impact R1-B', () => {
  it('150 degree slash uses radius .75 fighter height and mirror-safe geometry', () => {
    const r = renderer();
    r.effects.showBeat(getBeat(plan([pick('a', 'strike', 0), damage]), 'lunge'));
    const arc = r.active().find((obj) => obj.name === 'battle-effect-strike-arc-a')!;
    const geometry = arc.geometry.find((entry) => entry[0] === 'arc')!;
    expect(geometry[3]).toBe(r.layout.fighterHeight * 0.75);
    expect(Number(geometry[5]) - Number(geometry[4])).toBeCloseTo((Math.PI * 5) / 6);
  });
  it('impact holds each hurt pose 50ms then recoils within 90ms and keeps total 2000', () => {
    const beats = plan([pick('a', 'attack', 0), damage]);
    expect(getBeat(beats, 'impact').duration).toBe(90);
    expect(beats.reduce((sum, beat) => sum + beat.duration, 0)).toBe(2000);
    const r = renderer();
    r.effects.showBeat({ ...getBeat(beats, 'impact'), targets: getBeat(beats, 'damage').targets });
    const recoil = r.tweens.find((tween) => tween.targets === r.source.b);
    expect(recoil).toMatchObject({ delay: 50, duration: 40 });
    expect(recoil!.x).toBeGreaterThan(r.layout.right.x);
    expect(r.shake).toHaveBeenCalledExactlyOnceWith(90, 0.01);
    r.effects.destroy();
    expect(recoil!.removed).toBe(true);
  });
  it('scaled impact hold and recoil never exceed the actual cosmetic beat', () => {
    const r = renderer(true);
    const beats = planBattle(fixture(), fixture(), [damage], 'online', false);
    const impact = getBeat(beats, 'impact');
    r.effects.showBeat({
      ...impact,
      duration: impact.duration * 0.9,
      targets: getBeat(beats, 'damage').targets,
    });
    const ghost = r.objects.find((obj) => obj.name === 'battle-effect-ghost-b')!;
    const recoil = r.tweens.find((tween) => tween.targets === ghost)!;
    expect(recoil.delay + recoil.duration).toBeCloseTo(24.3);
    expect(r.shake).not.toHaveBeenCalled();
    expect(r.flash).not.toHaveBeenCalled();
    r.effects.destroy();
    const count = r.objects.length;
    r.effects.showBeat({ ...impact, targets: getBeat(beats, 'damage').targets });
    expect(r.objects).toHaveLength(count);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('resolved command effects R1-A', () => {
  it('resolved commands ignore pending picks; unresolved batch produces no cues', () => {
    const a = fixture(),
      b = structuredClone(a);
    if (a.phase.kind !== 'battle' || b.phase.kind !== 'battle') throw new Error('battle');
    a.phase.battle.pending.attack = 'secret';
    b.phase.battle.pending.attack = 'strike';
    const events = [pick('a', 'attack', 0), pick('b', 'defend', null), damage];
    expect(plan(events, a)).toEqual(plan(events, b));
    expect(getBeat(plan(events), 'lunge').commands).toEqual({ a: 'attack', b: 'defend' });
    expect(plan([pick('a', 'strike', 0)])).toEqual([]);
  });
  it('hidden, unknown, foreign-seat and invalid-role picks remain neutral', () => {
    for (const value of ['hidden', 'junk']) {
      const r = renderer();
      const beats = plan([pick('a', value, 0), damage]);
      expect(getBeat(beats, 'lunge').commands?.a).toBeUndefined();
      r.effects.showBeat(getBeat(beats, 'lunge'));
      expect(r.source.a.frame.name).toBe('idle');
      expect(r.tweens).toHaveLength(0);
    }
    expect(getBeat(plan([pick('a', 'strike', 1), damage]), 'lunge').commands?.a).toBeUndefined();
    expect(getBeat(plan([pick('a', 'defend', 0), damage]), 'lunge').commands?.a).toBeUndefined();
  });
  it('secret cues require a valid this-batch SecretUsed; reveal stays reveal-only', () => {
    const state = fixture();
    if (state.phase.kind !== 'battle') throw new Error('battle');
    state.phase.battle.a.secretUsed = true;
    const without = plan([pick('a', 'secret', 0), damage], state);
    expect(without.every((beat) => !beat.skills?.a && !beat.commands?.a)).toBe(true);
    const resolved = step(fixture('mage'), { type: 'battlePick', side: 'a', pick: 'secret' });
    const beats = plan(resolved.events, fixture('mage'));
    expect(getBeat(beats, 'impact').skills).toEqual({ a: 'firestorm' });
    expect(beats.slice(1).every((beat) => !beat.revealed)).toBe(true);
  });
  it.each(['attack', 'strike'] as const)(
    '%s has a dash and its own slash cue within 2000ms',
    (command) => {
      const beats = plan([pick('a', command, 0), damage]);
      expect(beats.reduce((sum, beat) => sum + beat.duration, 0)).toBe(2000);
      expect(getBeat(beats, 'anticipation').duration).toBe(command === 'strike' ? 320 : 260);
      const r = renderer();
      r.effects.showBeat(getBeat(beats, 'anticipation'));
      r.effects.showBeat(getBeat(beats, 'lunge'));
      expect(r.tweens.some((tween) => tween.targets === r.source.a && tween.x > r.source.a.x)).toBe(
        true,
      );
      expect(r.active().some((obj) => obj.name === `battle-effect-${command}-arc-a`)).toBe(true);
    },
  );
  it('defend shield bounces while counter succeeds only for event-owned reflected damage', () => {
    const r = renderer();
    const beats = plan([
      pick('a', 'strike', 0),
      pick('b', 'counter', null),
      { ...damage, params: { ...damage.params, toAttacker: 9, toDefender: 0 } },
    ]);
    r.effects.showBeat(getBeat(beats, 'lunge'));
    expect(r.active().some((obj) => obj.name === 'battle-effect-counter-b')).toBe(true);
    expect(r.tweens.some((tween) => tween.targets === r.source.b && tween.x > r.source.b.x)).toBe(
      true,
    );
    r.effects.showBeat({ ...getBeat(beats, 'impact'), targets: getBeat(beats, 'damage').targets });
    expect(r.source.a.frame.name).toBe('hurt');
    const failed = renderer();
    const failure = plan([pick('b', 'counter', null), damage]);
    failed.effects.showBeat({
      ...getBeat(failure, 'impact'),
      targets: getBeat(failure, 'damage').targets,
    });
    expect(failed.source.b.frame.name).toBe('hurt');
    expect(failed.active().some((obj) => obj.name === 'battle-effect-counter-b')).toBe(false);
    const guard = renderer();
    guard.effects.showBeat(getBeat(plan([pick('b', 'defend', null), damage]), 'lunge'));
    expect(guard.active().some((obj) => obj.name === 'battle-effect-defend-b')).toBe(true);
    expect(guard.tweens.some((tween) => tween.targets === guard.source.b)).toBe(true);
  });
  it.each(['bulwark', 'pickpocket', 'firestorm', 'sanctuary'] as const)(
    '%s effect is anchored to the resolved caster',
    (skill) => {
      const r = renderer();
      const beats = plan([
        { type: 'SecretUsed', seat: 0, params: { side: 'a', secret: skill, stolen: 0 } },
      ]);
      r.effects.showBeat(getBeat(beats, 'lunge'));
      const cue = r.active().find((obj) => obj.name === `battle-effect-${skill}-a`);
      expect(cue).toBeDefined();
      if (skill !== 'firestorm') expect(cue!.x).toBe(r.layout.left.x);
    },
  );
  it('zero-heal Sanctuary keeps its caster-owned golden field on a blocked half', () => {
    const previous = fixture('cleric');
    const resolved = step(previous, { type: 'battlePick', side: 'a', pick: 'secret' });
    const beats = planBattle(previous, resolved.state, resolved.events, 'human', false);
    expect(getBeat(beats, 'impact').outcome).toBe('blocked');
    const r = renderer();
    r.effects.showBeat(getBeat(beats, 'lunge'));
    r.effects.showBeat(getBeat(beats, 'impact'));
    expect(r.active().find((obj) => obj.name === 'battle-effect-sanctuary-a')).toMatchObject({
      x: r.layout.left.x,
    });
    r.effects.showBeat(getBeat(beats, 'damage'));
    const field = r.active().find((obj) => obj.name === 'battle-effect-sanctuary-a');
    expect(field).toMatchObject({ x: r.layout.left.x });
    expect(field!.geometry).toContainEqual(['fillStyle', 0xf5c51c, 0.7]);
    expect(field!.geometry).toContainEqual(['lineStyle', 8, 0xf5c51c, 1]);
    expect(field!.geometry.some((entry) => entry[0] === 'fillEllipse')).toBe(true);
    expect(field!.geometry.some((entry) => entry[0] === 'strokeCircle')).toBe(true);
  });
  it('Firestorm pillars remain target-owned through the damage beat without extending the half', () => {
    const previous = fixture('mage');
    const resolved = step(previous, { type: 'battlePick', side: 'a', pick: 'secret' });
    const beats = planBattle(previous, resolved.state, resolved.events, 'human', false);
    const r = renderer();
    r.effects.showBeat(getBeat(beats, 'damage'));
    expect(r.active().find((obj) => obj.name === 'battle-effect-firestorm-a')).toMatchObject({
      x: r.layout.right.x,
    });
    expect(beats.reduce((sum, beat) => sum + beat.duration, 0)).toBe(2000);
  });
  it.each([0, 10])(
    'pickpocket stolen=%s emits coins only for positive resolved transfer',
    (stolen) => {
      const state = fixture('thief', false),
        before = structuredClone(state);
      const beats = plan(
        [{ type: 'SecretUsed', seat: 0, params: { side: 'a', secret: 'pickpocket', stolen } }],
        state,
      );
      const r = renderer();
      r.effects.showBeat(getBeat(beats, 'lunge'));
      expect(r.active().filter((obj) => obj.name === 'battle-effect-transfer-a').length).toBe(
        stolen ? 5 : 0,
      );
      expect(state).toEqual(before);
    },
  );
  it('mutual impact hurts both actual recipients, never swaps damage ownership', () => {
    const beats = plan([{ ...damage, params: { ...damage.params, toAttacker: 5 } }]);
    const r = renderer();
    r.effects.showBeat({ ...getBeat(beats, 'impact'), targets: getBeat(beats, 'damage').targets });
    expect(r.source.a.frame.name).toBe('hurt');
    expect(r.source.b.frame.name).toBe('hurt');
  });
  it('detached playback animates ghosts only and never shakes or flashes', () => {
    const r = renderer(true),
      original = structuredClone({ x: r.source.a.x, frame: r.source.a.frame.name });
    const beats = plan([pick('a', 'attack', 0), damage]);
    r.effects.showBeat(getBeat(beats, 'lunge'));
    r.effects.showBeat({ ...getBeat(beats, 'impact'), targets: getBeat(beats, 'damage').targets });
    expect({ x: r.source.a.x, frame: r.source.a.frame.name }).toEqual(original);
    expect(r.shake).not.toHaveBeenCalled();
    expect(r.flash).not.toHaveBeenCalled();
    r.effects.destroy();
    expect(r.active()).toEqual([]);
  });
  it('reduced motion and zero-duration result allocate no effects or camera motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const r = renderer(),
      beats = plan([pick('a', 'attack', 0), damage]);
    for (const beat of beats) r.effects.showBeat(beat);
    expect(r.active()).toEqual([]);
    expect(r.tweens).toHaveLength(0);
    expect(r.shake).not.toHaveBeenCalled();
    expect(r.flash).not.toHaveBeenCalled();
    r.effects.showBeat({ kind: 'result', duration: 0, targets: [], result: null });
    expect(r.active()).toEqual([]);
  });
  it('destroy cancels all owned tweens and restores x/y, both scales, angle, alpha, tint and idle', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const r = renderer();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    r.effects.showBeat(getBeat(plan([pick('a', 'strike', 0), damage]), 'lunge'));
    Object.assign(r.source.a, {
      x: 999,
      y: 999,
      scaleX: 2,
      scaleY: 3,
      angle: 25,
      alpha: 0.5,
      tint: 123,
    });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    r.effects.destroy();
    expect(r.source.a).toMatchObject({
      x: r.layout.left.x,
      y: r.layout.left.y,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      alpha: 1,
      frame: { name: 'idle' },
    });
    expect(r.source.a.tint).toBeUndefined();
    expect(r.active()).toEqual([]);
    expect(r.tweens.every((tween) => tween.removed)).toBe(true);
  });
});
