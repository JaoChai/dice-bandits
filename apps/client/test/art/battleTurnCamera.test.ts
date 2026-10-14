import type Phaser from 'phaser';
import { expect, it, vi } from 'vitest';
import { battleLayout } from '../../src/scenes/battle/layout';

// Check the helper's public API before loading it: on base this is a real
// missing-behaviour assertion, rather than an unresolved-import test error.
const modules = import.meta.glob('../../src/scenes/battle/camera.ts');
async function helper() {
  expect(Object.keys(modules), 'tested camera helper exists').toHaveLength(1);
  return (await Object.values(modules)[0]!()) as typeof import('../../src/scenes/battle/camera');
}
function rig() {
  const camera = {
    width: 1600,
    height: 720,
    zoom: 1.12,
    scrollX: 24,
    scrollY: 10,
    setZoom: vi.fn(function (this: { zoom: number }, zoom: number) {
      this.zoom = zoom;
      return this;
    }),
    setScroll: vi.fn(function (this: { scrollX: number; scrollY: number }, x: number, y: number) {
      this.scrollX = x;
      this.scrollY = y;
      return this;
    }),
  };
  const spec: Record<string, unknown>[] = [];
  const stops: ReturnType<typeof vi.fn>[] = [];
  const scene = {
    cameras: { main: camera },
    tweens: {
      add: vi.fn((config: Record<string, unknown>) => {
        spec.push(config);
        const stop = vi.fn();
        stops.push(stop);
        return { stop };
      }),
    },
  } as unknown as Phaser.Scene;
  return { scene, camera, spec, stops };
}
it('resets zoom/scroll synchronously and stops a stale tween for post/resize/shutdown', async () => {
  const { createBattleCamera } = await helper();
  const r = rig();
  const controller = createBattleCamera(r.scene);
  controller.pick({ side: 'a', role: 'attack', ownership: 'local-human' }, false);
  controller.reset();
  expect(r.stops[0]).toHaveBeenCalledOnce();
  expect(r.camera.zoom).toBe(1);
  expect([r.camera.scrollX, r.camera.scrollY]).toEqual([0, 0]);
});
it('settles a pending camera tween after Phaser disposes main before scene shutdown', async () => {
  const { createBattleCamera } = await helper();
  const r = rig();
  const controller = createBattleCamera(r.scene);
  controller.pick({ side: 'a', role: 'attack', ownership: 'local-human' }, false);
  // Phaser CameraManager's shutdown listener runs before BattleScene's listener.
  Object.assign(r.scene.cameras, { main: undefined });
  expect(() => controller.reset()).not.toThrow();
  expect(r.stops[0]).toHaveBeenCalledOnce();
});

for (const ownership of ['bot', 'remote-human', 'ghost', 'none'] as const) {
  it(`never animates for ${ownership}`, async () => {
    const { createBattleCamera } = await helper();
    const r = rig();
    const controller = createBattleCamera(r.scene);
    controller.pick({ side: 'b', role: 'defense', ownership }, false);
    controller.impact('online', false);
    expect(r.spec).toHaveLength(0);
    expect([r.camera.zoom, r.camera.scrollX, r.camera.scrollY]).toEqual([1, 0, 0]);
  });
}
it('keeps reduced motion static while human picking and impacting', async () => {
  const { createBattleCamera } = await helper();
  const r = rig();
  const controller = createBattleCamera(r.scene);
  controller.pick({ side: 'a', role: 'attack', ownership: 'local-human' }, true);
  controller.impact('human', true);
  expect(r.spec).toHaveLength(0);
  expect([r.camera.zoom, r.camera.scrollX, r.camera.scrollY]).toEqual([1, 0, 0]);
});
it('uses the calm 1.12 sine pan and a <=120ms impact without adding waits', async () => {
  const { createBattleCamera } = await helper();
  const r = rig();
  const controller = createBattleCamera(r.scene);
  controller.pick({ side: 'a', role: 'attack', ownership: 'local-human' }, false);
  expect(r.spec[0]).toMatchObject({
    zoom: 1.12,
    scrollX: -24,
    scrollY: 0,
    duration: 330,
    ease: 'Sine.easeInOut',
  });
  controller.reveal(false);
  expect(r.spec[1]).toMatchObject({ zoom: 1, scrollX: 0, scrollY: 0, duration: 180 });
  controller.impact('human', false);
  expect(r.spec[2]).toMatchObject({ zoom: 1.075, duration: 50, yoyo: true });
});
it('gives the active fighter a role-coloured ground ring and the non-picker 67% tint', async () => {
  const { pickerAppearance } = await helper();
  const layout = battleLayout();
  expect(
    pickerAppearance({ side: 'b', role: 'defense', ownership: 'remote-human' }, layout),
  ).toMatchObject({
    ring: { x: layout.right.x, y: layout.groundY, colour: 0x8fd7df },
    tints: { a: 0xaaaaaa, b: 0xffffff },
    thinking: 'b',
    dimBackdrop: false,
  });
  expect(
    pickerAppearance({ side: 'a', role: 'attack', ownership: 'local-human' }, layout),
  ).toMatchObject({
    ring: { colour: 0xf5c51c },
    tints: { a: 0xffffff, b: 0xaaaaaa },
    thinking: null,
    dimBackdrop: true,
  });
});
