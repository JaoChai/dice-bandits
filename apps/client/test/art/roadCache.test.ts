import { MAP } from '@dice-bandits/engine';
import { describe, expect, it, vi } from 'vitest';
import { DEPTH_ROAD, drawRoad } from '../../src/scenes/board/road';

vi.mock('phaser', () => ({
  default: {
    Math: {
      Vector2: class Vector2 {
        constructor(
          public x: number,
          public y: number,
        ) {}
      },
    },
  },
}));

function makeScene() {
  const textures = new Set<string>();
  const graphics = {
    setDepth: vi.fn().mockReturnThis(),
    fillStyle: vi.fn().mockReturnThis(),
    fillPoints: vi.fn().mockReturnThis(),
    fillCircle: vi.fn().mockReturnThis(),
    generateTexture: vi.fn((key: string) => textures.add(key)),
    destroy: vi.fn(),
  };
  const image = {
    setOrigin: vi.fn().mockReturnThis(),
    setDepth: vi.fn().mockReturnThis(),
  };
  const scene = {
    textures: { exists: (key: string) => textures.has(key) },
    add: { graphics: vi.fn(() => graphics), image: vi.fn(() => image) },
  };
  return { scene, graphics, image };
}

const segments = [{ a: { x: 300, y: 400 }, b: { x: 500, y: 600 } }];

describe('static authored road rendering', () => {
  it('rasterizes the road once instead of replaying large circles every frame', () => {
    const { scene, graphics, image } = makeScene();
    drawRoad(scene as never, segments);

    expect(graphics.generateTexture).toHaveBeenCalledWith('board:road', MAP.width, MAP.height);
    expect(graphics.destroy).toHaveBeenCalledOnce();
    expect(scene.add.image).toHaveBeenCalledWith(0, 0, 'board:road');
    expect(image.setOrigin).toHaveBeenCalledWith(0);
    expect(image.setDepth).toHaveBeenCalledWith(DEPTH_ROAD);
  });

  it('reuses the cached road when a turn update rebuilds the display list', () => {
    const { scene, graphics } = makeScene();
    drawRoad(scene as never, segments);
    drawRoad(scene as never, segments);

    expect(graphics.generateTexture).toHaveBeenCalledOnce();
    expect(scene.add.graphics).toHaveBeenCalledOnce();
    expect(scene.add.image).toHaveBeenCalledTimes(2);
  });

  it('does not allocate a texture or image for an empty road', () => {
    const { scene, graphics } = makeScene();
    drawRoad(scene as never, []);

    expect(graphics.generateTexture).not.toHaveBeenCalled();
    expect(scene.add.graphics).not.toHaveBeenCalled();
    expect(scene.add.image).not.toHaveBeenCalled();
  });
});
