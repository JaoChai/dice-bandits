import type Phaser from 'phaser';
import { expect, test } from '@playwright/test';
import { observeBoardGame, renderedBoardGeometry, startJourney } from './helpers';

type ProbeWindow = Window & { __m5aGame?: Phaser.Game };

for (const viewport of [
  { width: 915, height: 412 },
  { width: 932, height: 388 },
  { width: 1280, height: 720 },
]) {
  for (const behavior of ['select spaces', 'exit whole-map'] as const) {
    test(`decorative lane taps cannot ${behavior} (${viewport.width})`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await observeBoardGame(page);
      await startJourney(page);
      await page.waitForFunction(() => window.__db?.art.boardReady);
      const stateBefore = await page.evaluate(() => window.__db!.getState());
      const modes =
        behavior === 'select spaces'
          ? (['follow'] as const)
          : (['whole-map', 'resized-whole-map'] as const);
      for (const mode of modes) {
        if (mode === 'whole-map') await page.getByTestId('map-toggle').click();
        if (mode === 'resized-whole-map') {
          await page.setViewportSize(
            viewport.width === 1280 ? { width: 932, height: 388 } : { width: 1280, height: 720 },
          );
        }
        await renderedBoardGeometry(page);
        const probe = await page.evaluate((needNearbySpace) => {
          const game = (window as ProbeWindow).__m5aGame!;
          const scene = game.scene.getScene('BoardScene');
          const camera = scene.cameras.main;
          const canvas = game.canvas.getBoundingClientRect();
          const state = window.__db!.getState();
          // Find an unobstructed REAL canvas point outside the actual viewport.
          // In follow mode it must inverse-project near a tile, reproducing the
          // invisible-space bug rather than tapping a harmless blank area.
          for (let y = canvas.top + 2; y < canvas.bottom; y += 4) {
            for (let x = canvas.left + 2; x < canvas.right; x += 4) {
              const logicalX = ((x - canvas.left) * game.canvas.width) / canvas.width;
              const logicalY = ((y - canvas.top) * game.canvas.height) / canvas.height;
              if (
                logicalX >= camera.x &&
                logicalX < camera.x + camera.width &&
                logicalY >= camera.y &&
                logicalY < camera.y + camera.height
              )
                continue;
              if (document.elementFromPoint(x, y) !== game.canvas) continue;
              const world = camera.getWorldPoint(logicalX, logicalY);
              const nearest = Math.min(
                ...state.board.spaces.map((space) =>
                  Math.hypot(space.x - world.x, space.y - world.y),
                ),
              );
              if (needNearbySpace && nearest > 60) continue;
              // Observe the real Phaser pointer event to avoid a vacuous DOM test.
              const input = scene.input as Phaser.Input.InputPlugin & { outsideProbe?: number };
              input.outsideProbe = 0;
              scene.input.once('pointerdown', () => {
                input.outsideProbe!++;
              });
              return {
                x,
                y,
                logicalX,
                logicalY,
                nearest,
                zoom: camera.zoom,
                viewport: { x: camera.x, y: camera.y, width: camera.width, height: camera.height },
              };
            }
          }
          throw new Error('No unobstructed outside-camera canvas point found');
        }, mode === 'follow');
        await info.attach(`${mode}-outside-tap`, {
          body: JSON.stringify(probe),
          contentType: 'application/json',
        });
        await page.mouse.click(probe.x, probe.y);
        await page.waitForFunction(() => {
          const scene = (window as ProbeWindow).__m5aGame!.scene.getScene('BoardScene');
          return (
            (scene.input as Phaser.Input.InputPlugin & { outsideProbe?: number }).outsideProbe === 1
          );
        });
        await renderedBoardGeometry(page);
        await expect(page.getByTestId('space-info')).toHaveCount(0);
        expect(
          await page.evaluate(
            () => (window as ProbeWindow).__m5aGame!.scene.getScene('BoardScene').cameras.main.zoom,
          ),
        ).toBeCloseTo(probe.zoom, 8);
        expect(await page.evaluate(() => window.__db!.getState())).toEqual(stateBefore);
        await page.screenshot({ path: info.outputPath(`${mode}-outside-tap.png`) });
      }
      // A genuine inside-camera tap must still leave whole-map mode.
      if (behavior === 'select spaces') await page.getByTestId('map-toggle').click();
      await renderedBoardGeometry(page);
      const inside = await page.evaluate(() => {
        const game = (window as ProbeWindow).__m5aGame!;
        const camera = game.scene.getScene('BoardScene').cameras.main;
        const rect = game.canvas.getBoundingClientRect();
        return {
          x: rect.left + ((camera.x + camera.width / 2) * rect.width) / game.canvas.width,
          y: rect.top + ((camera.y + camera.height / 2) * rect.height) / game.canvas.height,
        };
      });
      const whole = await renderedBoardGeometry(page);
      await page.mouse.click(inside.x, inside.y);
      await expect.poll(async () => (await renderedBoardGeometry(page)).zoom).not.toBe(whole.zoom);
      const geometry = await renderedBoardGeometry(page);
      const active = stateBefore.board.spaces.find(
        (space) => space.id === stateBefore.players[stateBefore.turnSeat]!.pos,
      )!;
      const tile = geometry.tiles.find(
        (image) => image.world.x === active.x && image.world.y === active.y,
      )!;
      expect(tile.visible).toBe(true);
      await page.mouse.click(tile.centre.x, tile.centre.y);
      await expect(page.getByTestId('space-info')).toBeVisible();
      expect(await page.evaluate(() => window.__db!.getState())).toEqual(stateBefore);
    });
  }
}

for (const viewport of [
  { width: 915, height: 412 },
  { width: 932, height: 388 },
  { width: 390, height: 844 },
  { width: 1280, height: 720 },
]) {
  for (const lang of ['th', 'en'] as const) {
    test(`one continuous map keeps gameplay inside the safe playfield (${viewport.width}, ${lang})`, async ({
      page,
    }, info) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
      await observeBoardGame(page);
      await startJourney(page);
      await page.waitForFunction(() => window.__db?.art.boardReady);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await renderedBoardGeometry(page);
      const measurement = await page.evaluate(() => {
        const game = (window as ProbeWindow).__m5aGame!;
        const scene = game.scene.getScene('BoardScene');
        const main = scene.cameras.main;
        const backdrop = scene.cameras.cameras.find((camera) => camera !== main);
        const rect = game.canvas.getBoundingClientRect();
        const safe = {
          left: rect.left + (main.x * rect.width) / game.canvas.width,
          top: rect.top + (main.y * rect.height) / game.canvas.height,
          right: rect.left + ((main.x + main.width) * rect.width) / game.canvas.width,
          bottom: rect.top + ((main.y + main.height) * rect.height) / game.canvas.height,
        };
        const foreground = scene.children
          .getChildren()
          .filter((child) => 'depth' in child && child.depth !== -10);
        const state = window.__db!.getState();
        const origin = state.board.spaces.find(
          (space) => space.id === state.players[state.turnSeat]!.pos,
        )!;
        // One map, one scale: every camera that renders painted-map images
        // must share the gameplay zoom AND one world→screen mapping (the same
        // world pixel lands within ±0.5 CSS px on every camera).
        const project = (camera: Phaser.Cameras.Scene2D.Camera, x: number, y: number) => {
          const point = camera.getViewMatrix().transformPoint(x, y);
          return {
            x: rect.left + (point.x / game.canvas.width) * rect.width,
            y: rect.top + (point.y / game.canvas.height) * rect.height,
          };
        };
        const worldProbes = [origin, { x: 1600, y: 900 }];
        const mapping = backdrop
          ? worldProbes.map((probe) => {
              const a = project(main, probe.x, probe.y);
              const b = project(backdrop, probe.x, probe.y);
              return { dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y) };
            })
          : null;
        return {
          safe,
          name: main.name,
          cameras: scene.cameras.cameras.length,
          backdropInteractive: backdrop?.inputEnabled,
          leaked: foreground.filter((child) => !backdrop || !(child.cameraFilter & backdrop.id))
            .length,
          zooms: backdrop ? [main.zoom, backdrop.zoom] : [main.zoom],
          mapping,
          origin,
          neighbours: origin.next.map((id) => state.board.spaces.find((space) => space.id === id)!),
          chrome: [
            ...document.querySelectorAll('.game-topline, .seat-card, .action-tray, .dicey-tip'),
          ]
            .map((element) => element.getBoundingClientRect().toJSON())
            .filter((box) => box.width && box.height),
        };
      });
      console.log(`Safe playfield ${viewport.width} ${lang}: ${JSON.stringify(measurement)}`);
      await info.attach('safe-playfield', {
        body: JSON.stringify({ measurement, geometry }),
        contentType: 'application/json',
      });
      await page.screenshot({ path: info.outputPath('safe-playfield.png') });
      expect(measurement.name).toBe('board-playfield');
      expect(measurement.cameras).toBe(2);
      expect(measurement.backdropInteractive).toBe(false);
      expect(measurement.leaked, 'foreground duplicated outside safe camera').toBe(0);
      // One map, one scale (owner choice A): no second, differently scaled
      // copy anywhere — both cameras share one zoom and one world→screen
      // mapping, so the painted map is continuous across the safe seam.
      expect(new Set(measurement.zooms).size, 'one zoom across all cameras').toBe(1);
      for (const axis of measurement.mapping ?? [])
        expect(Math.max(axis.dx, axis.dy), 'one world→screen mapping').toBeLessThanOrEqual(0.5);
      expect(measurement.safe.left).toBeGreaterThanOrEqual(8);
      expect(measurement.safe.top).toBeGreaterThanOrEqual(58);
      const intersects = (
        a: { left: number; right: number; top: number; bottom: number },
        b: typeof a,
      ) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      for (const chrome of measurement.chrome)
        expect(intersects(measurement.safe, chrome), 'HUD intrudes into safe playfield').toBe(
          false,
        );
      const actors = geometry.tokens.filter(
        (token) =>
          Math.hypot(token.world.x - measurement.origin.x, token.world.y - measurement.origin.y) <
          70,
      );
      expect(actors.length).toBeGreaterThan(0);
      const tiles = geometry.tiles.filter((tile) =>
        [measurement.origin, ...measurement.neighbours].some(
          (space) => space.x === tile.world.x && space.y === tile.world.y,
        ),
      );
      expect(tiles).toHaveLength(1 + measurement.neighbours.length);
      for (const object of [...actors, ...tiles]) {
        expect(object.left).toBeGreaterThanOrEqual(measurement.safe.left - 0.5);
        expect(object.right).toBeLessThanOrEqual(measurement.safe.right + 0.5);
        expect(object.top).toBeGreaterThanOrEqual(measurement.safe.top - 0.5);
        expect(object.bottom).toBeLessThanOrEqual(measurement.safe.bottom + 0.5);
        for (const chrome of measurement.chrome) expect(intersects(object, chrome)).toBe(false);
      }
      // The active hero sits at the centre of the free area, never under the
      // right rail or the action tray. Shared-space offsets move sprites off
      // the raw space coords, so match by proximity like the actors above.
      const activeTokens = geometry.tokens.filter(
        (token) =>
          token.visible &&
          Math.hypot(token.world.x - measurement.origin.x, token.world.y - measurement.origin.y) <
            70,
      );
      expect(activeTokens.length, 'active token is rendered').toBeGreaterThan(0);
      for (const token of activeTokens) {
        expect(token.centre.x).toBeGreaterThanOrEqual(measurement.safe.left - 0.5);
        expect(token.centre.x).toBeLessThanOrEqual(measurement.safe.right + 0.5);
        expect(token.centre.y).toBeGreaterThanOrEqual(measurement.safe.top - 0.5);
        expect(token.centre.y).toBeLessThanOrEqual(measurement.safe.bottom + 0.5);
      }
      // Review 7c's ≥48 CSS px floor is a landscape-canvas constant (915×412
      // scales 1280 logical px 1:1.4). Portrait fits the 1280-wide logical
      // canvas into 390 CSS px, so the same tile is 96 × 0.9727 × 390/1280
      // ≈ 28.45 px on base too — the floor scales with the orientation.
      for (const tile of tiles)
        expect(tile.width).toBeGreaterThanOrEqual(viewport.width < viewport.height ? 28 : 48);
      const cadence = await page.evaluate(
        () =>
          new Promise<{ fps: number; frames: number; canvasRenderer: boolean }>((resolve) => {
            let first = 0,
              frames = 0;
            const sample = (time: number) => {
              if (!first) first = time;
              frames++;
              if (time - first < 2000) requestAnimationFrame(sample);
              else
                resolve({
                  fps: ((frames - 1) * 1000) / (time - first),
                  frames,
                  canvasRenderer:
                    (window as ProbeWindow).__m5aGame!.canvas.getContext('2d') !== null,
                });
            };
            requestAnimationFrame(sample);
          }),
      );
      console.log(
        `Board cadence ${viewport.width} ${lang}: ${JSON.stringify(cadence)}, tile widths ${JSON.stringify(tiles.map((tile) => tile.width))}`,
      );
      await info.attach('board-cadence', {
        body: JSON.stringify(cadence),
        contentType: 'application/json',
      });
      // Same local interactive floor as layout.spec.ts; never weaken it.
      if (!process.env.CI) expect(cadence.fps).toBeGreaterThanOrEqual(30);
    });
  }
}

for (const viewport of [undefined, { width: 932, height: 388 }]) {
  for (const lang of ['th', 'en'] as const) {
    test(`board camera keeps the painted map across canvas edges (${lang}, ${viewport?.width ?? 'project'})`, async ({
      page,
    }, testInfo) => {
      if (viewport) await page.setViewportSize(viewport);
      await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
      await observeBoardGame(page);
      await startJourney(page);
      await page.waitForFunction(() => window.__db?.art.boardReady);

      for (const mode of ['start', 'whole-map', 'return'] as const) {
        if (mode !== 'start') await page.locator('[data-testid="map-toggle"]').click();
        // Wait for an actual rendered frame, not stale camera worldView values.
        const geometry = await renderedBoardGeometry(page);
        const measurement = await page.evaluate(() => {
          const scene = (window as ProbeWindow).__m5aGame!.scene.getScene('BoardScene');
          const camera = scene.cameras.main;
          const images = scene.children.getChildren().filter((child) => {
            return (
              'texture' in child &&
              /^map-r\d+c\d+$/.test((child as Phaser.GameObjects.Image).texture.key)
            );
          }) as Phaser.GameObjects.Image[];
          const boxes = images.map((image) => image.getBounds());
          return {
            zoom: camera.zoom,
            scrollX: camera.scrollX,
            scrollY: camera.scrollY,
            view: {
              left: camera.worldView.left,
              right: camera.worldView.right,
              top: camera.worldView.top,
              bottom: camera.worldView.bottom,
            },
            map: {
              left: Math.min(...boxes.map((box) => box.left)),
              right: Math.max(...boxes.map((box) => box.right)),
              top: Math.min(...boxes.map((box) => box.top)),
              bottom: Math.max(...boxes.map((box) => box.bottom)),
              tiles: images.filter(
                (image) => image.x >= 0 && image.x <= 3200 && image.y >= 0 && image.y <= 1800,
              ).length,
              gutters: images.filter(
                (image) => image.x < 0 || image.x > 3200 || image.y < 0 || image.y > 1800,
              ).length,
            },
          };
        });
        console.log(
          `Board edge ${testInfo.project.name} ${lang} ${mode}: ${JSON.stringify(measurement)}`,
        );
        await testInfo.attach(`${mode}-geometry`, {
          body: JSON.stringify({ measurement, geometry }, null, 2),
          contentType: 'application/json',
        });
        await page.screenshot({ path: testInfo.outputPath(`board-edge-${lang}-${mode}.png`) });
        expect(measurement.map.tiles, 'painted map actually loaded').toBe(15);
        expect(
          measurement.view.left,
          'camera exposes background left of painted map',
        ).toBeGreaterThanOrEqual(measurement.map.left - 0.5);
        expect(
          measurement.view.right,
          'camera exposes background right of painted map',
        ).toBeLessThanOrEqual(measurement.map.right + 0.5);
        expect(
          measurement.view.top,
          'camera exposes background above painted map',
        ).toBeGreaterThanOrEqual(measurement.map.top - 0.5);
        expect(
          measurement.view.bottom,
          'camera exposes background below painted map',
        ).toBeLessThanOrEqual(measurement.map.bottom + 0.5);
      }
    });
  }
}

// One continuous map (owner choice A): in whole-map view the whole authored
// world projects INSIDE the safe rectangle, and every canvas corner/edge
// midpoint is painted mirrored terrain — never the bare renderer background.
for (const viewport of [
  { width: 915, height: 412 },
  { width: 932, height: 388 },
  { width: 390, height: 844 },
  { width: 1280, height: 720 },
]) {
  for (const lang of ['th', 'en'] as const) {
    test(`whole-map fits the safe rect and paints every canvas edge (${viewport.width}, ${lang})`, async ({
      page,
    }, info) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
      await observeBoardGame(page);
      await startJourney(page);
      await page.waitForFunction(() => window.__db?.art.boardReady);
      await page.getByTestId('map-toggle').click();
      await renderedBoardGeometry(page);
      const measurement = await page.evaluate(() => {
        const game = (window as ProbeWindow).__m5aGame!;
        const scene = game.scene.getScene('BoardScene');
        const main = scene.cameras.main;
        const rect = game.canvas.getBoundingClientRect();
        const project = (x: number, y: number) => {
          const point = main.getViewMatrix().transformPoint(x, y);
          return {
            x: rect.left + (point.x / game.canvas.width) * rect.width,
            y: rect.top + (point.y / game.canvas.height) * rect.height,
          };
        };
        const corners = [project(0, 0), project(3200, 0), project(3200, 1800), project(0, 1800)];
        return {
          safe: {
            left: rect.left + (main.x * rect.width) / game.canvas.width,
            top: rect.top + (main.y * rect.height) / game.canvas.height,
            right: rect.left + ((main.x + main.width) * rect.width) / game.canvas.width,
            bottom: rect.top + ((main.y + main.height) * rect.height) / game.canvas.height,
          },
          world: {
            left: Math.min(...corners.map((point) => point.x)),
            right: Math.max(...corners.map((point) => point.x)),
            top: Math.min(...corners.map((point) => point.y)),
            bottom: Math.max(...corners.map((point) => point.y)),
          },
        };
      });
      await info.attach('whole-map-geometry', {
        body: JSON.stringify(measurement, null, 2),
        contentType: 'application/json',
      });
      expect(measurement.world.left).toBeGreaterThanOrEqual(measurement.safe.left - 0.5);
      expect(measurement.world.right).toBeLessThanOrEqual(measurement.safe.right + 0.5);
      expect(measurement.world.top).toBeGreaterThanOrEqual(measurement.safe.top - 0.5);
      expect(measurement.world.bottom).toBeLessThanOrEqual(measurement.safe.bottom + 0.5);
      // Sample the real canvas: 4 corners + 4 edge midpoints. WebGL canvases
      // are read inside the render task; CANVAS canvases via getImageData.
      const samples = await page.evaluate(
        () =>
          new Promise<Array<[number, number, number]>>((resolve) => {
            const game = (window as ProbeWindow).__m5aGame!;
            const scene = game.scene.getScene('BoardScene');
            scene.events.once('render', () => {
              const canvas = game.canvas;
              const points: Array<[number, number]> = [
                [2, 2],
                [canvas.width / 2, 2],
                [canvas.width - 3, 2],
                [2, canvas.height / 2],
                [canvas.width - 3, canvas.height / 2],
                [2, canvas.height - 3],
                [canvas.width / 2, canvas.height - 3],
                [canvas.width - 3, canvas.height - 3],
              ];
              const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
              const out = points.map(([logicalX, logicalY]) => {
                if (gl) {
                  const pixel = new Uint8Array(4);
                  gl.readPixels(
                    logicalX,
                    canvas.height - 1 - logicalY,
                    1,
                    1,
                    gl.RGBA,
                    gl.UNSIGNED_BYTE,
                    pixel,
                  );
                  return [pixel[0]!, pixel[1]!, pixel[2]!] as [number, number, number];
                }
                const data = canvas.getContext('2d')!.getImageData(logicalX, logicalY, 1, 1).data;
                return [data[0]!, data[1]!, data[2]!] as [number, number, number];
              });
              resolve(out);
            });
          }),
      );
      await info.attach('edge-pixels', {
        body: JSON.stringify(samples),
        contentType: 'application/json',
      });
      await page.screenshot({ path: info.outputPath('whole-map-edges.png') });
      expect(samples).toHaveLength(8);
      // #273449 = rgb(39, 52, 73) — the bare renderer background.
      for (const [r, g, b] of samples)
        expect(
          Math.abs(r - 39) + Math.abs(g - 52) + Math.abs(b - 73),
          'canvas edge is painted, not the renderer background',
        ).toBeGreaterThan(6);
    });
  }
}
