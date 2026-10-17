import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPractice } from '../../src/tutor/practice';
import { TUTORIAL_SCRIPT } from '../../src/tutor/script';

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('dice-bandits:intro-seen', '1');
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('practice dispatch verdicts', () => {
  it('resolves false for a rejected tap and true for the allowed action', async () => {
    const practice = createPractice(TUTORIAL_SCRIPT, () => undefined);
    await expect(practice.dispatch({ type: 'endTurn' })).resolves.toBe(false);
    const accepted = practice.dispatch({ type: 'roll' });
    await vi.runAllTimersAsync();
    await expect(accepted).resolves.toBe(true);
    practice.destroy();
  });

  it('resolves false when a second tap races the first presentation', async () => {
    const practice = createPractice(TUTORIAL_SCRIPT, () => undefined);
    const first = practice.dispatch({ type: 'roll' });
    await expect(practice.dispatch({ type: 'roll' })).resolves.toBe(false);
    await vi.runAllTimersAsync();
    await first;
    practice.destroy();
  });
});
