import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent, GameState } from '@dice-bandits/engine';
import recorded from '../e2e/fixtures/online-battle-swap.json';
import { planBattle } from '../src/scenes/battle/presentation';
import { createBattleReadout, renderBattleUi } from '../src/ui/battleUi';
import { setLang } from '../src/i18n';

const previous = recorded.before.state as unknown as GameState;
const next = recorded.after.state as unknown as GameState;
const events = recorded.events.flatMap((message) => message.events) as unknown as GameEvent[];

afterEach(() => {
  setLang('en');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('battle identity presentation ownership', () => {
  for (const reduced of [false, true]) {
    it(`drops all former battle beats on the recorded bot-chain swap (reduced=${reduced})`, () => {
      const snapshot = structuredClone({ previous, next, events });
      expect(planBattle(previous, next, events, 'online', reduced)).toEqual([]);
      expect({ previous, next, events }).toEqual(snapshot);
    });

    it(`treats a new BattleStarted as a boundary even for the same fighters (reduced=${reduced})`, () => {
      expect(planBattle(previous, previous, events, 'online', reduced)).toEqual([]);
    });

    it(`does not publish another seat's secret in an unchanged duel (reduced=${reduced})`, () => {
      const foreignSecret: GameEvent = {
        type: 'SecretUsed',
        seat: 2,
        params: { side: 'a', secret: 'pickpocket', stolen: 0 },
      };
      expect(planBattle(next, next, [foreignSecret], 'online', reduced)).toEqual([]);
    });
  }

  for (const change of ['seat pair', 'monster'] as const) {
    it(`reconciles names, HP, maxima and meters on a ${change} change and fences the old drain`, () => {
      setLang('en');
      const root = document.createElement('div');
      root.innerHTML = '<section class="game-shell"><nav class="action-bar"></nav></section>';
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      });
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
      const render = (state: GameState) =>
        renderBattleUi(root, state, [], undefined, vi.fn(), () => '', false, true);
      render(previous);
      const readout = createBattleReadout(root);
      readout.reset(previous);
      readout.showBeat({
        kind: 'drain',
        duration: 350,
        result: null,
        targets: [{ side: 'a', amount: 3, fromHp: 32, toHp: 29 }],
      });
      const replacement = structuredClone(next);
      if (change === 'monster') {
        if (replacement.phase.kind !== 'battle' || previous.phase.kind !== 'battle')
          throw new Error('battle');
        replacement.phase.battle.a = structuredClone(previous.phase.battle.a);
        replacement.phase.battle.b = {
          ...structuredClone(previous.phase.battle.b),
          monsterId: 'jellyBun',
          hp: 9,
          stats: { ...previous.phase.battle.b.stats, maxHp: 20 },
        };
      }
      render(replacement);
      if (replacement.phase.kind !== 'battle') throw new Error('battle');
      const expected = ['a', 'b'].map((side) => {
        const fighter =
          replacement.phase.kind === 'battle' ? replacement.phase.battle[side as 'a' | 'b'] : null;
        return `${fighter!.hp}/${fighter!.stats.maxHp}`;
      });
      expect([...root.querySelectorAll('.battle-hp-value')].map((el) => el.textContent)).toEqual(
        expected,
      );
      expect(root.querySelector('[data-testid="battle-readout"]')).toBeNull();
      expect(frames).toHaveLength(1);
      frames[0]!(performance.now() + 99999);
      expect([...root.querySelectorAll('.battle-hp-value')].map((el) => el.textContent)).toEqual(
        expected,
      );
      const meters = [...root.querySelectorAll('[role="meter"]')];
      for (const [index, side] of (['a', 'b'] as const).entries()) {
        const fighter = replacement.phase.battle[side];
        expect(meters[index]!.getAttribute('aria-valuenow')).toBe(String(fighter.hp));
        expect(meters[index]!.getAttribute('aria-valuemax')).toBe(String(fighter.stats.maxHp));
      }
      readout.destroy();
    });
  }
});
