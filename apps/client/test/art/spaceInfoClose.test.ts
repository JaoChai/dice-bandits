import { createGame, type GameState } from '@dice-bandits/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class Scene {} } }));

/**
 * Review 6b: `closeSpaceInfo()` must remove the SAME keydown listener that
 * opening added. Previously it removed a never-registered `onEscape`, so
 * every popup leaked its capture-phase Escape listener.
 *
 * Leak detector: `openSpaceInfo` registers exactly one document keydown
 * listener per open; a correct close must call removeEventListener with
 * that same listener. We count add/remove pairs.
 */
describe('Review 6b: spaceInfo keeps one close path', () => {
  let state: GameState;
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    addSpy.mockRestore();
    removeSpy.mockRestore();
    document.body.innerHTML = '';
  });

  async function setup(seed: string): Promise<typeof import('../../src/ui/spaceInfo')> {
    const { setLang } = await import('../../src/i18n');
    setLang('en');
    state = createGame({
      seed,
      rounds: 12,
      seats: [
        { name: 'P1', classId: 'knight', control: 'human', personality: null },
        { name: 'P2', classId: 'thief', control: 'bot', personality: 'greedy' },
      ],
    });
    document.body.innerHTML = '';
    addSpy = vi.spyOn(document, 'addEventListener');
    removeSpy = vi.spyOn(document, 'removeEventListener');
    return import('../../src/ui/spaceInfo');
  }

  const keydownAdds = () =>
    addSpy.mock.calls.filter(
      (call: Parameters<typeof document.addEventListener>) => call[0] === 'keydown',
    );
  const keydownRemoves = () =>
    removeSpy.mock.calls.filter(
      (call: Parameters<typeof document.removeEventListener>) => call[0] === 'keydown',
    );

  it('open → closeSpaceInfo removes the listener it added', async () => {
    const { openSpaceInfo, closeSpaceInfo } = await setup('escape-leak');
    openSpaceInfo(document.body, state, 1);
    expect(keydownAdds()).toHaveLength(1);
    closeSpaceInfo();
    // The added listener must be exactly the removed one — not a dead name.
    expect(keydownRemoves()).toHaveLength(1);
    expect(keydownRemoves()[0]![1]).toBe(keydownAdds()[0]![1]);
  });

  it('Escaping the open popup removes its own listener (same reference)', async () => {
    const { openSpaceInfo } = await setup('escape-path');
    const { closeSpaceInfo } = await import('../../src/ui/spaceInfo');
    openSpaceInfo(document.body, state, 2);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('[data-testid="space-info"]')).toBeNull();
    expect(keydownRemoves()).toHaveLength(1);
    expect(keydownRemoves()[0]![1]).toBe(keydownAdds()[0]![1]);
    void closeSpaceInfo;
  });

  it('open → open (replace) → close leaves zero leaked listeners', async () => {
    const { openSpaceInfo, closeSpaceInfo } = await setup('double-open');
    openSpaceInfo(document.body, state, 2);
    openSpaceInfo(document.body, state, 3); // must remove the first listener too
    closeSpaceInfo();
    expect(keydownAdds().length - keydownRemoves().length).toBe(0);
  });
});
