import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import { drawMapLayer } from '../../src/scenes/board/mapLayer';

function makeMap(nativeVisible = true) {
  const nativeChecks: ReturnType<typeof vi.fn>[] = [];
  const scene = {
    textures: { exists: () => true },
    add: {
      image: vi.fn((_x: number, _y: number, key: string) => {
        const willRender = vi.fn(() => nativeVisible);
        nativeChecks.push(willRender);
        return { key, willRender, setDepth: vi.fn().mockReturnThis() };
      }),
    },
  };
  const images = drawMapLayer(scene as never);
  const visible = (worldView: { x: number; y: number; width: number; height: number }) =>
    images
      .filter((image) => image.willRender({ worldView } as Phaser.Cameras.Scene2D.Camera))
      .map((image) => (image as unknown as { key: string }).key);
  return { visible, nativeChecks };
}

describe('painted map camera culling', () => {
  it('does not submit offscreen map textures to the renderer', () => {
    const { visible } = makeMap();
    expect(visible({ x: 640, y: 600, width: 640, height: 600 })).toEqual(['map-r1c1']);
  });

  it('rechecks the current camera view when panning or switching to whole-map zoom', () => {
    const { visible } = makeMap();
    expect(visible({ x: 0, y: 0, width: 640, height: 600 })).toEqual(['map-r0c0']);
    expect(visible({ x: 1280, y: 1200, width: 640, height: 600 })).toEqual(['map-r2c2']);
    expect(visible({ x: 0, y: 0, width: 3200, height: 1800 })).toHaveLength(15);
  });

  it('keeps partially visible tiles along camera edges', () => {
    const { visible } = makeMap();
    expect(visible({ x: 639, y: 599, width: 2, height: 2 })).toEqual([
      'map-r0c0',
      'map-r0c1',
      'map-r1c0',
      'map-r1c1',
    ]);
  });

  it('paints mirrored native-size gutters when whole-map fit extends beyond the authored world', () => {
    const scene = {
      textures: { exists: () => true },
      add: {
        image: vi.fn((x: number, y: number, key: string) => ({
          x,
          y,
          key,
          flipX: false,
          flipY: false,
          willRender: () => true,
          setDepth() {
            return this;
          },
          setFlipX(value: boolean) {
            this.flipX = value;
            return this;
          },
          setFlipY(value: boolean) {
            this.flipY = value;
            return this;
          },
        })),
      },
    };
    const images = drawMapLayer(scene as never, { x: -562, y: 0, width: 4324, height: 1800 });
    const left = images.filter((image) => image.x < 0);
    const right = images.filter((image) => image.x > 3200);
    expect(images).toHaveLength(21);
    expect(left).toHaveLength(3);
    expect(right).toHaveLength(3);
    for (const image of [...left, ...right]) {
      expect((image as unknown as { flipX: boolean }).flipX).toBe(true);
    }
    expect((left[0] as unknown as { key: string }).key).toBe('map-r0c0');
    expect((right[0] as unknown as { key: string }).key).toBe('map-r0c4');
    expect(
      left[0]!.willRender({ worldView: { x: 0, y: 0, width: 3200, height: 1800 } } as never),
    ).toBe(false);
    expect(
      left[0]!.willRender({ worldView: { x: -562, y: 0, width: 4324, height: 1800 } } as never),
    ).toBe(true);
  });

  it('preserves the native visibility and camera-exclusion check', () => {
    const { visible, nativeChecks } = makeMap(false);
    expect(visible({ x: 0, y: 0, width: 3200, height: 1800 })).toEqual([]);
    for (const check of nativeChecks) expect(check).toHaveBeenCalledOnce();
  });
});
