import { createGame, step } from '@dice-bandits/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBattlePost, type PostPlayOptions } from '../src/ui/battlePost';
function input(): Omit<PostPlayOptions, 'mode'> {
  let previous = createGame({
    seed: 'post-beats',
    rounds: 8,
    seats: [
      { name: 'Ada', classId: 'thief', control: 'human', personality: null },
      { name: 'Ben', classId: 'knight', control: 'human', personality: null },
    ],
  });
  previous.phase = { kind: 'duelOffer', remaining: 1, targets: [1] };
  previous = step(previous, { type: 'duel', target: 1 }).state;
  const next = structuredClone(previous);
  next.players[0]!.xp = 20;
  next.phase = { kind: 'levelUp', seat: 0, choices: ['hpUp', 'atkUp', 'looter'], then: 'endTurn' };
  return {
    previous,
    next,
    events: [
      { type: 'BattleEnded', seat: 0, params: { result: 'aWin' } },
      { type: 'GoldGained', seat: 0, params: { amount: 32 } },
      { type: 'XpGained', seat: 0, params: { amount: 20 } },
    ],
    viewer: 0,
    speed: 1,
    reduced: false,
  };
}

describe('post timing and cancellation', () => {
  afterEach(() => vi.useRealTimers());
  it.each(['human', 'bot', 'online'] as const)(
    'stays within the %s budget without waiting for a human choice',
    async (mode) => {
      vi.useFakeTimers();
      const root = document.createElement('div');
      const view = createBattlePost(root);
      const play = view.play({ ...input(), mode });
      await vi.advanceTimersByTimeAsync(mode === 'human' ? 1580 : 600);
      expect(await play).toBe(true);
      expect(view.active).toBe(true);
      expect(root.querySelectorAll('[data-post-choice]')).toHaveLength(0);
      view.destroy();
    },
  );
  it.each([true, false])(
    'reduced motion or speed=0 is static and has final rewards (reduced=%s)',
    async (reduced) => {
      const root = document.createElement('div');
      const view = createBattlePost(root);
      expect(await view.play({ ...input(), mode: 'human', reduced, speed: reduced ? 1 : 0 })).toBe(
        true,
      );
      expect(root.querySelector('[data-testid="post-gold"]')?.textContent).toContain('+32');
      expect(root.querySelector('.post-xp-track')?.getAttribute('aria-valuenow')).toBe('10');
      view.destroy();
    },
  );
  it('a tap skips to the final rewards; exit removes all UI without remounting', async () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const view = createBattlePost(root);
    const play = view.play({ ...input(), mode: 'human' });
    root.querySelector('.battle-post')!.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(0);
    expect(await play).toBe(true);
    expect(root.querySelector('.post-xp-track')?.getAttribute('aria-valuenow')).toBe('10');
    view.destroy();
    await vi.runAllTimersAsync();
    expect(root.querySelector('.battle-post')).toBeNull();
  });
  it('exit during a pending beat settles its promise without remounting', async () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const view = createBattlePost(root);
    const play = view.play({ ...input(), mode: 'human' });
    view.destroy();
    expect(await play).toBe(false);
    await vi.runAllTimersAsync();
    expect(root.querySelector('.battle-post')).toBeNull();
  });
});
