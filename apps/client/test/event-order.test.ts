import { describe, expect, it } from 'vitest';
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
});
