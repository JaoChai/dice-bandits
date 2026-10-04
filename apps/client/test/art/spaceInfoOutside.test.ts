import { createGame } from '@dice-bandits/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeSpaceInfo, openSpaceInfo } from '../../src/ui/spaceInfo';
import { setLang } from '../../src/i18n';

const state = createGame({
  seed: 'outside-popup',
  rounds: 12,
  seats: [
    { name: 'Ada', classId: 'knight', control: 'human', personality: null },
    { name: 'Lin', classId: 'thief', control: 'human', personality: null },
  ],
});

afterEach(() => {
  closeSpaceInfo();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

// Missing outside listener must fail dismissal; stopping propagation must fail
// the underlying fork/space action; leaking it must fail the removal identity.
describe('space info outside pointer lifecycle', () => {
  it('dismisses on an outside pointer without changing state or swallowing the target action', () => {
    const before = structuredClone(state);
    const arrow = document.createElement('button');
    document.body.append(arrow);
    let clicks = 0;
    arrow.addEventListener('click', () => clicks++);
    openSpaceInfo(document.body, state, 1);
    arrow.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.querySelector('[data-testid="space-info"]')).toBeNull();
    arrow.click();
    expect(clicks).toBe(1);
    expect(state).toEqual(before);
  });

  it('keeps the popup when its own content is tapped', () => {
    openSpaceInfo(document.body, state, 1);
    document
      .querySelector('.space-info-text')!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.querySelectorAll('[data-testid="space-info"]')).toHaveLength(1);
  });

  it('allows the same outside pointer to switch to another space', () => {
    setLang('en');
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    canvas.addEventListener('pointerdown', () => openSpaceInfo(document.body, state, 8));
    openSpaceInfo(document.body, state, 1);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.querySelectorAll('[data-testid="space-info"]')).toHaveLength(1);
    expect(document.querySelector('[data-testid="space-info"]')!.getAttribute('aria-label')).toBe(
      'Town',
    );
  });

  it('removes the exact outside listener on replacement and every close path', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    openSpaceInfo(document.body, state, 1);
    openSpaceInfo(document.body, state, 8);
    closeSpaceInfo();
    openSpaceInfo(document.body, state, 1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    openSpaceInfo(document.body, state, 1);
    (document.querySelector('[data-testid="space-info-close"]') as HTMLButtonElement).click();
    const added = add.mock.calls.filter(([event]) => event === 'pointerdown');
    const removed = remove.mock.calls.filter(([event]) => event === 'pointerdown');
    expect(added).toHaveLength(4);
    expect(removed).toEqual(added);
  });
});
