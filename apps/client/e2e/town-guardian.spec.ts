import { expect, test } from '@playwright/test';
import { createGame, step } from '@dice-bandits/engine';
import type Phaser from 'phaser';
import { observeBoardGame, waitForBattleArt } from './helpers';

const state = createGame({
  seed: 'town-guardian-art',
  rounds: 12,
  seats: [
    { name: 'Hero', classId: 'knight', control: 'human', personality: null },
    { name: 'Owner', classId: 'thief', control: 'human', personality: null },
  ],
});
const town = state.towns[0]!;
town.owner = 1;
state.players[0]!.pos = town.spaceId;
state.phase = { kind: 'townChallenge', spaceId: town.spaceId };
const battle = step(state, { type: 'attackTown' }).state;
if (battle.phase.kind !== 'battle' || battle.phase.battle.b.monsterId !== 'townGuardian')
  throw new Error('fixture must be the actual engine town guardian');

// An icons fallback or scale-1 guardian must fail real rendered geometry.
for (const viewport of [
  { width: 1280, height: 720 },
  { width: 915, height: 412 },
  { width: 932, height: 388 },
]) {
  test(`town guardian uses full-height penguin art ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await observeBoardGame(page);
    await page.addInitScript((state) => {
      localStorage.setItem('diceBandits.save', JSON.stringify({ version: 2, state }));
      localStorage.setItem('lang', 'th');
    }, battle);
    await page.goto('/?speed=0');
    await page.locator('[data-action="continue"]').click();
    await waitForBattleArt(page);
    await expect(page.locator('.battle-hp-card.right')).toBeVisible();
    const rendered = await page.evaluate(async () => {
      const game = (window as unknown as Window & { __m5aGame: Phaser.Game }).__m5aGame;
      await new Promise<void>((resolve) => game.events.once('postrender', resolve));
      const scene = game.scene.getScene('BattleScene');
      const sprites = scene.children.getChildren().filter((child) => child.type === 'Sprite');
      const sprite = sprites[1] as Phaser.GameObjects.Sprite;
      const canvas = game.canvas.getBoundingClientRect();
      const bounds = sprite.getBounds();
      const tl = scene.cameras.main.getViewMatrix().transformPoint(bounds.left, bounds.top);
      const br = scene.cameras.main.getViewMatrix().transformPoint(bounds.right, bounds.bottom);
      return {
        count: sprites.length,
        atlas: sprite.texture.key,
        frame: sprite.frame.name,
        flipX: sprite.flipX,
        height: (sprite.displayHeight / game.canvas.height) * canvas.height,
        rect: {
          left: canvas.left + (tl.x / game.canvas.width) * canvas.width,
          top: canvas.top + (tl.y / game.canvas.height) * canvas.height,
          right: canvas.left + (br.x / game.canvas.width) * canvas.width,
          bottom: canvas.top + (br.y / game.canvas.height) * canvas.height,
        },
      };
    });
    console.log(`Guardian ${viewport.width}x${viewport.height}: ${JSON.stringify(rendered)}`);
    await info.attach('guardian-geometry', {
      body: JSON.stringify(rendered, null, 2),
      contentType: 'application/json',
    });
    await page.screenshot({ path: info.outputPath('guardian-th.png') });
    expect(rendered.count).toBe(2);
    expect.soft(rendered.atlas).toBe('art:monster-penguinKnight');
    expect.soft(rendered.atlas).not.toBe('art:icons');
    expect.soft(rendered.frame).toBe('idle');
    expect(rendered.flipX).toBe(true);
    const target = viewport.height > 480 ? 330 : 180;
    expect.soft(rendered.height).toBeGreaterThanOrEqual(target - 12);
    expect.soft(rendered.height).toBeLessThanOrEqual(target + 12);
    expect(rendered.rect.left).toBeGreaterThanOrEqual(0);
    expect(rendered.rect.top).toBeGreaterThanOrEqual(0);
    expect(rendered.rect.right).toBeLessThanOrEqual(viewport.width);
    expect(rendered.rect.bottom).toBeLessThanOrEqual(viewport.height);
    for (const selector of [
      '.battle-hp-card.left',
      '.battle-hp-card.right',
      '.action-tray',
      '[data-testid="menu-button"]',
      '[data-testid="audio-toggle"]',
      '[data-testid="turn-ribbon"]',
    ]) {
      const rect = await page.locator(selector).evaluate((element) => {
        const { left, top, right, bottom } = element.getBoundingClientRect();
        return { left, top, right, bottom };
      });
      const overlap =
        Math.max(
          0,
          Math.min(rect.right, rendered.rect.right) - Math.max(rect.left, rendered.rect.left),
        ) *
        Math.max(
          0,
          Math.min(rect.bottom, rendered.rect.bottom) - Math.max(rect.top, rendered.rect.top),
        );
      expect(overlap, `guardian overlaps ${selector}`).toBe(0);
    }
  });
}
