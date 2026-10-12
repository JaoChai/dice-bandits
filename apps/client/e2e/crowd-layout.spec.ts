import { expect, test } from '@playwright/test';
import type { GameState } from '@dice-bandits/engine';
import type Phaser from 'phaser';
import { observeBoardGame, startJourney } from './helpers';
import { WORLD } from '../src/scenes/board/camera';

type Board = Phaser.Scene & {
  renderBoard(state: GameState): void;
  tokenObjects: Map<number, Phaser.GameObjects.Image>;
  nameTags: Map<number, Phaser.GameObjects.Text>;
};

for (const [width, height] of [
  [915, 412],
  [932, 430],
  [1280, 720],
]) {
  test(`measured crowd sizes, active seats and duplicate classes ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: width!, height: height! });
    await page.addInitScript(() => localStorage.setItem('lang', 'en'));
    await observeBoardGame(page);
    await startJourney(page);
    await page.waitForFunction(() => window.__db?.art.boardReady);
    const evidence = await page.evaluate(async (world) => {
      const game = (window as unknown as { __m5aGame: Phaser.Game }).__m5aGame;
      const scene = game.scene.getScene('BoardScene') as Board;
      const state = window.__db!.getState();
      const failures: string[] = [];
      const cases = [];
      for (const classId of ['knight', 'thief', 'mage', 'cleric'] as const) {
        for (let count = 2; count <= 4; count++) {
          for (let active = 0; active < count; active++) {
            scene.renderBoard({
              ...state,
              turnSeat: active,
              players: state.players.slice(0, count).map((p) => ({ ...p, classId, pos: 21 })),
            });
            const heroes = [...scene.tokenObjects.values()].map((hero) => {
              const b = hero.getBounds();
              return {
                left: b.left,
                right: b.right,
                top: b.top,
                bottom: b.bottom,
                depth: hero.depth,
                height: hero.displayHeight,
              };
            });
            if (!heroes.every((h) => [h.left, h.right, h.top, h.bottom].every(Number.isFinite)))
              failures.push(`${classId}/${count}/${active}: non-finite bounds`);
            const rowWidth =
              Math.max(...heroes.map((h) => h.right)) - Math.min(...heroes.map((h) => h.left));
            const clear = heroes.map((hero) => {
              // All idle heights are equal: union of foreground horizontal
              // intervals is also the top-40%-face occlusion ratio.
              const ranges = heroes
                .filter((h) => h.depth > hero.depth)
                .map((h) => [Math.max(hero.left, h.left), Math.min(hero.right, h.right)])
                .filter(([a, b]) => b! > a!)
                .sort((a, b) => a[0]! - b[0]!);
              let end = hero.left,
                covered = 0;
              for (const [a, b] of ranges) {
                covered += Math.max(0, b! - Math.max(end, a!));
                end = Math.max(end, b!);
              }
              return 1 - covered / (hero.right - hero.left);
            });
            const context = `${classId}/${count}/${active}`;
            if (
              rowWidth > 155 ||
              Math.min(...clear) < 0.7 ||
              heroes.some((h) => Math.abs(h.height - 61.2) > 0.001)
            )
              failures.push(`${context}: size/face`);
            if (
              heroes[active]!.depth <=
              Math.max(...heroes.filter((_, i) => i !== active).map((h) => h.depth))
            )
              failures.push(`${context}: active-depth`);
            for (const hero of heroes) {
              if (
                hero.left < 0 ||
                hero.right > world.width ||
                hero.top < 0 ||
                hero.bottom > world.height
              )
                failures.push(`${context}: map-bounds`);
            }
            const tags = [...scene.nameTags.values()].map((tag) => tag.getBounds());
            const heroTop = Math.min(...heroes.map((h) => h.top));
            for (let i = 0; i < tags.length; i++) {
              const tag = tags[i]!;
              if (
                tag.left < 0 ||
                tag.top < 0 ||
                tag.right > world.width ||
                tag.bottom > heroTop - 10 ||
                tag.bottom !== tags[0]!.bottom
              )
                failures.push(`${context}: tag-bounds`);
              if (i && tag.left - tags[i - 1]!.right < 8) failures.push(`${context}: tag-gap`);
            }
            cases.push({ classId, count, active, rowWidth, clear });
          }
        }
      }
      scene.renderBoard(state);
      await new Promise<void>((resolve) => game.events.once('postrender', resolve));
      return { failures, cases };
    }, WORLD);
    expect(evidence.cases).toHaveLength(36);
    expect(evidence.failures).toEqual([]);
    console.log(
      `Rendered crowd matrix ${width}x${height}: ${evidence.cases.length} cases, max-width=${Math.max(...evidence.cases.map((c) => c.rowWidth))}, min-face=${Math.min(...evidence.cases.flatMap((c) => c.clear))}`,
    );
    await info.attach('rendered-crowd-matrix.json', {
      body: JSON.stringify(evidence),
      contentType: 'application/json',
    });

    for (const count of [2, 3, 4, 1]) {
      const styles = await page.evaluate(async (count) => {
        const game = (window as unknown as { __m5aGame: Phaser.Game }).__m5aGame;
        const scene = game.scene.getScene('BoardScene') as Board;
        const state = window.__db!.getState();
        scene.renderBoard({ ...state, players: state.players.slice(0, count) });
        await new Promise<void>((resolve) => game.events.once('postrender', resolve));
        return [...scene.nameTags.values()].map((tag) => ({
          color: tag.style.color,
          background: tag.style.backgroundColor,
          stroke: tag.style.stroke,
          strokeThickness: tag.style.strokeThickness,
          fontStyle: tag.style.fontStyle,
          fontSize: tag.style.fontSize,
          padding: { x: tag.padding.left, y: tag.padding.top },
        }));
      }, count);
      expect(styles).toHaveLength(count);
      for (const [seat, style] of styles.entries()) {
        expect(style).toEqual({
          color: '#ffffff',
          background: ['#2E7FE0', '#3BA84A', '#6C2EBE', '#D42B3A'][seat],
          stroke: '#3a1f0d',
          strokeThickness: 3,
          fontStyle: 'bold',
          fontSize: count === 1 ? '15px' : '13px',
          padding: count === 1 ? { x: 8, y: 2 } : { x: 6, y: 1 },
        });
      }
      await page.screenshot({ path: info.outputPath(`crowd-${count}-${width}x${height}.png`) });
    }
    for (const longNames of [false, true]) {
      await page.evaluate(async (longNames) => {
        const game = (window as unknown as { __m5aGame: Phaser.Game }).__m5aGame;
        const scene = game.scene.getScene('BoardScene') as Board;
        const state = window.__db!.getState();
        scene.renderBoard({
          ...state,
          players: state.players.map((p) => ({
            ...p,
            pos: 21,
            name: longNames ? 'Alexander Hamilton' : p.name,
          })),
          turnSeat: longNames ? 1 : 0,
        });
        const tile = state.board.spaces.find((space) => space.id === 21)!;
        scene.cameras.main.centerOn(tile.x, tile.y);
        await new Promise<void>((resolve) => game.events.once('postrender', resolve));
      }, longNames);
      await page.screenshot({
        path: info.outputPath(
          `crowd-${longNames ? 'long-names' : 'map-edge'}-${width}x${height}.png`,
        ),
      });
    }
  });
}
