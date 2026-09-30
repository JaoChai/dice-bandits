import { describe, expect, it, vi } from 'vitest';
import { animateThenRender } from '../src/eventOrder';

describe('animateThenRender', () => {
  it('waits for event animations before rendering the next board state', async () => {
    const order: string[] = [];
    let finish!: () => void;
    const animation = new Promise<void>((resolve) => (finish = resolve));
    const pending = animateThenRender(
      async () => {
        order.push('animation-start');
        await animation;
        order.push('animation-end');
      },
      () => order.push('render'),
    );
    expect(order).toEqual(['animation-start']);
    finish();
    await pending;
    expect(order).toEqual(['animation-start', 'animation-end', 'render']);
  });

  it('renders and settles when an interrupted scene animation never completes', async () => {
    vi.useFakeTimers();
    try {
      const render = vi.fn();
      const pending = animateThenRender(() => new Promise<void>(() => undefined), render);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toBeUndefined();
      expect(render).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders despite a failed animation', async () => {
    const render = vi.fn();
    await expect(
      animateThenRender(async () => {
        throw new Error('scene stopped');
      }, render),
    ).resolves.toBeUndefined();
    expect(render).toHaveBeenCalledOnce();
  });
});
