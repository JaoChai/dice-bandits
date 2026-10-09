import { expect, test, type Page } from '@playwright/test';
import { createGame, startBattle, step } from '@dice-bandits/engine';
import type Phaser from 'phaser';
import { observeBoardGame, waitForBattleArt } from './helpers';

function fixture(attacker: 'a' | 'b') {
  const state = createGame({
    seed: 'secret-privacy',
    rounds: 12,
    seats: [
      { name: 'Alice', classId: 'mage', control: 'human', personality: null },
      { name: 'Bob', classId: 'knight', control: 'human', personality: null },
    ],
  });
  const rival = state.players[1]!;
  const result = startBattle(state, {
    context: 'pvp',
    spaceId: state.players[0]!.pos,
    opponent: {
      kind: 'player',
      seat: 1,
      monsterId: null,
      level: rival.level,
      hp: rival.hp,
      stats: rival.stats,
      secretUsed: false,
      buffs: { ironSkin: false, poison: false, halveNext: false },
    },
  }).state;
  if (result.phase.kind !== 'battle') throw new Error('expected battle');
  result.phase.battle.attackerSide = attacker;
  return result;
}

async function publicDisplay(page: Page) {
  return page.evaluate(async () => {
    const game = (window as Window & { __m5aGame: Phaser.Game }).__m5aGame;
    await new Promise<void>((resolve) => game.events.once('postrender', resolve));
    const scene = game.scene.getScene('BattleScene');
    const texts = scene.children
      .getChildren()
      .filter((child) => child.type === 'Text') as Phaser.GameObjects.Text[];
    const sprites = scene.children
      .getChildren()
      .filter((child) => child.type === 'Sprite') as Phaser.GameObjects.Sprite[];
    return {
      canvas: texts.map((text) => ({
        text: text.text,
        x: text.x,
        visible: text.visible,
        alpha: text.alpha,
      })),
      sprites: sprites.map((sprite) => ({
        key: sprite.texture.key,
        frame: sprite.frame.name,
        x: sprite.x,
      })),
      // Include hidden DOM and aria attributes: neither should disclose picks.
      html: document.querySelector('#app')!.innerHTML,
    };
  });
}

test('pass-device dialog has the visible heading as its accessible name', async ({ page }) => {
  await page.goto('/?speed=0');
  await page.evaluate((state) => {
    document
      .querySelector('#app')!
      .dispatchEvent(new CustomEvent('dice-bandits:continue', { detail: state }));
  }, fixture('a'));
  const dialog = page.getByTestId('pass-screen').getByRole('dialog');
  await expect(dialog).toBeVisible();
  const heading = await dialog.getByRole('heading', { level: 2 }).innerText();
  expect(heading.trim()).not.toBe('');
  await expect(dialog).toHaveAccessibleName(heading);
});

for (const lang of ['th', 'en'])
  for (const attacker of ['a', 'b'] as const)
    test(`hotseat hides side ${attacker} pending secret through Ready then retains revealed star (${lang})`, async ({
      page,
    }, info) => {
      await observeBoardGame(page);
      await page.addInitScript((lang) => localStorage.setItem('lang', lang), lang);
      await page.goto('/?speed=0');
      const initial = fixture(attacker);
      await page.evaluate((state) => {
        document
          .querySelector('#app')!
          .dispatchEvent(new CustomEvent('dice-bandits:continue', { detail: state }));
      }, initial);
      await waitForBattleArt(page);
      await page.getByTestId('pass-ready').click();
      const before = await publicDisplay(page);
      await page.getByTestId('pick-secret').click();
      const pending = step(initial, { type: 'battlePick', side: attacker, pick: 'secret' });
      expect(pending.state.phase).toMatchObject({
        kind: 'battle',
        battle: { pending: { attack: 'secret', defense: null } },
      });
      expect(await page.evaluate(() => window.__db!.getState())).toEqual(pending.state);
      await expect(page.getByTestId('pass-screen')).toBeVisible();
      const pass = await publicDisplay(page);
      expect(pass.canvas).toEqual(before.canvas);
      expect(pass.sprites).toEqual(before.sprites);
      await expect(page.getByTestId('chosen-card')).toHaveText('?');
      const secretName =
        attacker === 'a'
          ? lang === 'en'
            ? 'Firestorm'
            : 'พายุเพลิง'
          : lang === 'en'
            ? 'Bulwark'
            : 'กำแพงเหล็ก';
      expect(pass.html).not.toContain(secretName);
      await page.screenshot({ path: info.outputPath(`privacy-${lang}-${attacker}-pass.png`) });
      await page.getByTestId('pass-ready').click();
      const picker = await publicDisplay(page);
      expect(picker.canvas).toEqual(before.canvas);
      expect(picker.sprites).toEqual(before.sprites);
      expect(picker.html).not.toContain(secretName);
      await expect(page.getByTestId('battle-readout')).toHaveCount(0);
      await expect(page.getByTestId('chosen-card')).toHaveText('?');
      await page.screenshot({ path: info.outputPath(`privacy-${lang}-${attacker}-picker.png`) });
      await page.getByTestId('pick-defend').click();
      await expect
        .poll(
          async () => (await publicDisplay(page)).canvas.filter((text) => text.text === '★').length,
        )
        .toBe(1);
      const revealed = await publicDisplay(page);
      const star = revealed.canvas.find((text) => text.text === '★')!;
      expect(star.visible).toBe(true);
      expect(star.alpha).toBeGreaterThan(0);
      expect(star.x).toBe(revealed.sprites[attacker === 'a' ? 0 : 1]!.x);
      const resolved = step(pending.state, {
        type: 'battlePick',
        side: attacker === 'a' ? 'b' : 'a',
        pick: 'defend',
      });
      expect(resolved.events.some((event) => event.type === 'SecretUsed')).toBe(true);
      expect(await page.evaluate(() => window.__db!.getState())).toEqual(resolved.state);
      await page.screenshot({ path: info.outputPath(`privacy-${lang}-${attacker}-revealed.png`) });
      await info.attach('public-display', {
        body: JSON.stringify({ before, pass, picker, revealed }),
        contentType: 'application/json',
      });
    });
