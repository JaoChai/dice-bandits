import { expect, test, type Page } from '@playwright/test';
import { createGame, startBattle, data, type ClassId, type GameState } from '@dice-bandits/engine';
import type Phaser from 'phaser';
import { observeBoardGame, openTitleChoice, startBattleJourney, waitForBattleArt } from './helpers';
import en from '../src/i18n/en.json' with { type: 'json' };
import th from '../src/i18n/th.json' with { type: 'json' };

type Probe = Window & { __m5aGame: Phaser.Game };
test.use({ video: 'on' });
function fixture(classId: ClassId = 'knight', monsterId?: string): GameState {
  const state = createGame({
    seed: 'turn-hybrid',
    rounds: 12,
    seats: [
      { name: 'Ada', classId, control: 'human', personality: null },
      { name: 'Ben', classId: 'cleric', control: 'human', personality: null },
    ],
  });
  const rival = state.players[1]!;
  const stats = monsterId ? data.MONSTERS[monsterId]!.base : rival.stats;
  return startBattle(state, {
    context: monsterId ? 'monster' : 'pvp',
    spaceId: state.players[0]!.pos,
    opponent: {
      kind: monsterId ? 'monster' : 'player',
      seat: monsterId ? null : 1,
      monsterId: monsterId ?? null,
      level: 1,
      hp: stats.maxHp,
      stats,
      secretUsed: false,
      buffs: { ironSkin: false, poison: false, halveNext: false },
    },
  }).state;
}
async function load(page: Page, state: GameState, speed = 1) {
  await page.goto(`/?speed=${speed}`);
  await page.evaluate(
    (state) =>
      document
        .querySelector('#app')!
        .dispatchEvent(new CustomEvent('dice-bandits:continue', { detail: state })),
    state,
  );
  await waitForBattleArt(page);
}
for (const viewport of [
  { width: 390, height: 844 },
  { width: 915, height: 412 },
]) {
  for (const lang of ['th', 'en']) {
    test(`stance banner clears both HP cards ${viewport.width}x${viewport.height} ${lang}`, async ({
      page,
    }, info) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
      await observeBoardGame(page);
      await load(page, fixture());
      for (const role of ['attack', 'defense']) {
        await page.getByTestId('pass-ready').click();
        await page.evaluate(() => document.fonts.ready);
        const geometry = await page.evaluate(() => {
          const banner = document.querySelector('[data-testid="stance-banner"]')!;
          const a = banner.getBoundingClientRect();
          return [...document.querySelectorAll('.battle-hp-card')].map((hp) => {
            const b = hp.getBoundingClientRect();
            return {
              side: hp.classList.contains('left') ? 'left' : 'right',
              banner: a.toJSON(),
              hp: b.toJSON(),
              intersection:
                Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
                Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
              roleFont: parseFloat(getComputedStyle(banner.querySelector('strong')!).fontSize),
            };
          });
        });
        console.log(`stance geometry ${role} ${lang}: ${JSON.stringify(geometry)}`);
        expect(geometry).toHaveLength(2);
        for (const result of geometry) {
          expect.soft(result.intersection, `${role} banner / ${result.side} HP`).toBe(0);
          expect(result.roleFont).toBeGreaterThanOrEqual(14);
        }
        await screenshot(page, `${role}-${lang}`, info.outputPath(`${role}-${lang}.png`));
        await page.getByTestId(role === 'attack' ? 'pick-attack' : 'pick-defend').click();
      }
    });
  }
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 915, height: 412 },
  { width: 932, height: 388 },
]) {
  for (const lang of ['th', 'en'] as const) {
    test(`settled focus clears long-name HP and takeover seats ${viewport.width}x${viewport.height} ${lang}`, async ({
      page,
    }, info) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
      await observeBoardGame(page);
      await startBattleJourney(page);
      await page.evaluate(() => document.fonts.ready);
      await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1.12, 5);
      await page.evaluate(
        ({ name, takeover }) => {
          document.querySelectorAll('.seat-card').forEach((card, seat) => {
            const badge = document.createElement('small');
            badge.className = 'seat-status';
            badge.dataset.testid = `seat-takeover-${seat}`;
            badge.textContent = takeover;
            card.querySelector('.seat-details')!.append(badge);
            card.querySelector('strong')!.textContent = name;
          });
          document.querySelectorAll('.battle-hp-card strong').forEach((label) => {
            label.textContent = name;
          });
        },
        {
          name: (lang === 'th' ? 'ก' : 'W').repeat(18),
          takeover: (lang === 'th' ? th : en)['online.takeover'],
        },
      );
      const intersections = await page.evaluate(async () => {
        const game = (window as unknown as Probe).__m5aGame;
        await new Promise<void>((resolve) => game.events.once('postrender', resolve));
        const scene = game.scene.getScene('BattleScene');
        const canvas = game.canvas.getBoundingClientRect();
        const obstacles = [...document.querySelectorAll('.seat-card, .battle-hp-card')];
        return scene.children
          .getChildren()
          .filter((child) => child.type === 'Sprite')
          .flatMap((child, side) => {
            const bounds = (child as Phaser.GameObjects.Sprite).getBounds();
            const matrix = scene.cameras.main.getViewMatrix();
            const tl = matrix.transformPoint(bounds.left, bounds.top);
            const br = matrix.transformPoint(bounds.right, bounds.bottom);
            const a = {
              left: canvas.left + (tl.x * canvas.width) / game.canvas.width,
              right: canvas.left + (br.x * canvas.width) / game.canvas.width,
              top: canvas.top + (tl.y * canvas.height) / game.canvas.height,
              bottom: canvas.top + (br.y * canvas.height) / game.canvas.height,
            };
            return obstacles.map((element, index) => {
              const b = element.getBoundingClientRect();
              return {
                side,
                obstacle: index,
                fighter: a,
                overlap:
                  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
                  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
              };
            });
          });
      });
      console.log(
        `settled intersections ${viewport.width} ${lang}: ${JSON.stringify(intersections)}`,
      );
      for (const result of intersections)
        expect.soft(result.overlap, `fighter ${result.side} / obstacle ${result.obstacle}`).toBe(0);
      await screenshot(page, `settled-${lang}`, info.outputPath(`settled-${lang}.png`));
    });
  }
}

test('non-picker body pixels render at 60–70% brightness on the shipped renderer', async ({
  page,
}) => {
  await observeBoardGame(page);
  await load(page, fixture());
  await page.getByTestId('pass-ready').click();
  await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1.12, 2);
  await page.waitForTimeout(350);
  const ratio = await page.evaluate(() => {
    const game = (window as unknown as Probe).__m5aGame;
    const scene = game.scene.getScene('BattleScene') as Phaser.Scene & {
      fighters: { a: Phaser.GameObjects.Sprite; b: Phaser.GameObjects.Sprite };
    };
    const state = window.__db!.getState();
    if (state.phase.kind !== 'battle') throw Error('battle fixture');
    const sprite = scene.fighters[state.phase.battle.attackerSide === 'a' ? 'b' : 'a'];
    // Compare visible body pixels against the immutable authored atlas, not
    // stored tint properties (CANVAS silently ignores setTint).
    const original = game.textures.get(sprite.texture.key.replace('battle-dim:', ''));
    const frame = original.get(sprite.frame.name);
    const source = document.createElement('canvas');
    source.width = frame.cutWidth;
    source.height = frame.cutHeight;
    const ctx = source.getContext('2d')!;
    ctx.drawImage(
      original.getSourceImage() as CanvasImageSource,
      frame.cutX,
      frame.cutY,
      frame.cutWidth,
      frame.cutHeight,
      0,
      0,
      frame.cutWidth,
      frame.cutHeight,
    );
    const pixels = ctx.getImageData(0, 0, source.width, source.height).data;
    const rendered = game.canvas.getContext('2d')!;
    const bounds = sprite.getBounds();
    const matrix = scene.cameras.main.getViewMatrix();
    let lit = 0,
      dim = 0,
      count = 0;
    for (let y = 20; y < source.height - 20; y += 12) {
      for (let x = 20; x < source.width - 20; x += 12) {
        const i = (y * source.width + x) * 4;
        if (pixels[i + 3] !== 255 || pixels[i]! + pixels[i + 1]! + pixels[i + 2]! < 250) continue;
        const worldX =
          bounds.left + (sprite.flipX ? 1 - x / source.width : x / source.width) * bounds.width;
        const worldY = bounds.top + (y / source.height) * bounds.height;
        const point = matrix.transformPoint(worldX, worldY);
        const seen = rendered.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data;
        lit += pixels[i]! + pixels[i + 1]! + pixels[i + 2]!;
        dim += seen[0]! + seen[1]! + seen[2]!;
        count++;
      }
    }
    if (count < 25) throw Error('insufficient opaque authored body pixels');
    return { percent: (dim / lit) * 100, samples: count };
  });
  console.log('real non-picker brightness:', JSON.stringify(ratio));
  expect(ratio.percent).toBeGreaterThanOrEqual(60);
  expect(ratio.percent).toBeLessThanOrEqual(70);
});

async function camera(page: Page) {
  return page.evaluate(() => {
    const c = (window as Probe).__m5aGame.scene.getScene('BattleScene').cameras.main;
    return { zoom: c.zoom, x: c.scrollX, y: c.scrollY };
  });
}
async function screenshot(page: Page, name: string, path: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path });
  if (process.env.AXE_SOURCE) {
    await page.addScriptTag({ path: process.env.AXE_SOURCE });
    const result = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: { run(): Promise<{ violations: { impact: string; id: string }[] }> };
        }
      ).axe;
      return (await axe.run()).violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    });
    console.log(`axe ${name}: ${JSON.stringify(result)}`);
    expect(result).toEqual([]);
  }
}

test('hybrid hotseat completes two exchanges, back privacy, resize and scene cleanup', async ({
  page,
}, info) => {
  await observeBoardGame(page);
  const lang = info.project.name === 'desktop' ? 'en' : 'th';
  await page.addInitScript((lang) => localStorage.setItem('lang', lang), lang);
  await load(page, fixture());
  await expect(page.getByTestId('chosen-card')).toHaveCount(0);
  for (let half = 0; half < 4; half++) {
    for (let pick = 0; pick < 2; pick++) {
      await expect(page.getByTestId('pass-screen')).toBeVisible();
      await expect(page.getByTestId('chosen-card')).toHaveCount(0);
      await page.getByTestId('pass-ready').click();
      await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1.12, 2);
      const attacking = await page.getByTestId('pick-attack').isVisible();
      await expect(page.getByTestId('stance-banner')).toContainText(
        lang === 'th' ? (attacking ? 'ตาบุก' : 'ตารับ') : attacking ? 'ATTACK TURN' : 'DEFEND TURN',
      );
      if (pick === 1) {
        const back = page.getByTestId('chosen-card');
        await expect(back).toContainText(lang === 'th' ? 'คว่ำอยู่' : 'face down');
        await expect(back).toHaveAttribute('aria-hidden', 'true');
        expect(await back.evaluate((e) => e.tagName)).not.toBe('BUTTON');
        const size = (await back.boundingBox())!;
        expect(size.width).toBeGreaterThanOrEqual(128);
        expect(size.height).toBeGreaterThanOrEqual(96);
        expect(await back.getAttribute('tabindex')).toBeNull();
      }
      if (half === 0)
        await screenshot(
          page,
          attacking ? 'attack' : 'defense',
          info.outputPath(attacking ? 'attack.png' : 'defense.png'),
        );
      await page.getByTestId(attacking ? 'pick-attack' : 'pick-defend').click();
    }
    await expect(page.getByTestId('pass-screen')).toBeVisible({ timeout: 5000 });
    expect(await camera(page)).toEqual({ zoom: 1, x: 0, y: 0 });
  }
  // Resize with a focused picker must reset synchronously, not animate back.
  await page.getByTestId('pass-ready').click();
  await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1.12, 2);
  await page.setViewportSize({ width: 932, height: 388 });
  await expect.poll(() => camera(page)).toEqual({ zoom: 1, x: 0, y: 0 });
  await page.getByTestId('menu-button').click();
  await page.locator('[data-action="exit"]').click();
  await expect(page.getByTestId('screen-title')).toBeVisible();
  expect(await page.getByTestId('swap-beat').count()).toBe(0);
  expect(await page.getByTestId('reveal-pair').count()).toBe(0);
});

test('winning half resets focus before victory, level-up, rewards and board return', async ({
  page,
}, info) => {
  await observeBoardGame(page);
  await load(page, fixture('knight', 'jellyBun'), 0);
  for (let pick = 0; pick < 40; pick++) {
    const state = await page.evaluate(() => window.__db!.getState());
    if (state.phase.kind !== 'battle') break;
    if (await page.getByTestId('pass-ready').isVisible())
      await page.getByTestId('pass-ready').click();
    const button = page
      .locator(
        '[data-testid="pick-attack"]:visible:enabled, [data-testid="pick-defend"]:visible:enabled',
      )
      .first();
    await button.click();
  }
  await expect(page.getByTestId('battle-post')).toBeVisible();
  expect(await camera(page)).toEqual({ zoom: 1, x: 0, y: 0 });
  await screenshot(page, 'post', info.outputPath('post-reset.png'));
  await page.setViewportSize({ width: 932, height: 388 });
  expect(await camera(page)).toEqual({ zoom: 1, x: 0, y: 0 });
  await expect(page.getByTestId('stance-banner')).toHaveCount(0);
  await expect(page.getByTestId('swap-beat')).toHaveCount(0);
  await expect(page.getByTestId('reveal-pair')).toHaveCount(0);
  const choices = page.locator('[data-post-choice]:visible:enabled');
  if (await choices.count()) await choices.first().click();
  if (await page.getByTestId('post-continue').isVisible())
    await page.getByTestId('post-continue').click();
  await expect(page.getByTestId('battle-post')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Probe).__m5aGame.scene.isActive('BattleScene'))).toBe(
    false,
  );
});

test('reduced motion keeps picker/reveal/impact static and roles readable', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await observeBoardGame(page);
  await load(page, fixture());
  await page.getByTestId('pass-ready').click();
  expect(await camera(page)).toEqual({ zoom: 1, x: 0, y: 0 });
  await expect(page.getByTestId('stance-banner')).toContainText('Ben');
  await page.getByTestId('pick-attack').click();
  await page.getByTestId('pass-ready').click();
  expect(await camera(page)).toEqual({ zoom: 1, x: 0, y: 0 });
  await screenshot(page, 'reduced', info.outputPath('reduced.png'));
  await page.getByTestId('pick-defend').click();
  await expect(page.getByTestId('pass-screen')).toBeVisible();
  expect(await camera(page)).toEqual({ zoom: 1, x: 0, y: 0 });
  await expect(page.getByTestId('swap-beat')).toHaveCount(0);
});

// Actual atlas bounds and live view matrix at settled maximum zoom. No duplicated
// head coordinates, alpha proxies or lowered overlap tolerance.
test('all four heroes and eight monsters clear HP at 1.12 zoom', async ({ page }, info) => {
  await observeBoardGame(page);
  const samples: unknown[] = [];
  const classes: ClassId[] = ['knight', 'thief', 'mage', 'cleric'];
  const monsters = Object.keys(data.MONSTERS);
  for (let i = 0; i < monsters.length; i++) {
    await load(page, fixture(classes[i % 4]!, monsters[i]));
    await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1.12, 3);
    const geometry = await page.evaluate(async () => {
      const game = (window as Probe).__m5aGame;
      await new Promise<void>((r) => game.events.once('postrender', r));
      const scene = game.scene.getScene('BattleScene');
      const c = scene.cameras.main;
      const canvas = game.canvas.getBoundingClientRect();
      const hp = [...document.querySelectorAll('.battle-hp-card')].map((e) => {
        const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, bottom: r.bottom, top: r.top };
      });
      const sprites = scene.children
        .getChildren()
        .filter((o) => o.type === 'Sprite') as Phaser.GameObjects.Sprite[];
      return {
        hp,
        zoom: c.zoom,
        sprites: sprites.map((s) => {
          const b = s.getBounds();
          const tl = c.getViewMatrix().transformPoint(b.left, b.top);
          const br = c.getViewMatrix().transformPoint(b.right, b.bottom);
          return {
            atlas: s.texture.key,
            left: canvas.left + (tl.x / game.canvas.width) * canvas.width,
            top: canvas.top + (tl.y / game.canvas.height) * canvas.height,
            right: canvas.left + (br.x / game.canvas.width) * canvas.width,
            bottom: canvas.top + (br.y / game.canvas.height) * canvas.height,
          };
        }),
      };
    });
    expect(geometry.sprites).toHaveLength(2);
    for (const sprite of geometry.sprites)
      for (const hp of geometry.hp) {
        const intersection =
          Math.max(0, Math.min(sprite.right, hp.right) - Math.max(sprite.left, hp.left)) *
          Math.max(0, Math.min(sprite.bottom, hp.bottom) - Math.max(sprite.top, hp.top));
        expect(intersection, `${sprite.atlas} enters HP at ${geometry.zoom}`).toBe(0);
      }
    samples.push(geometry);
  }
  console.log('real atlas max-zoom geometry', JSON.stringify(samples));
  await info.attach('max-zoom-geometry', {
    body: JSON.stringify(samples, null, 2),
    contentType: 'application/json',
  });
});

test('two real online clients: local choosing and named remote wait without shared camera', async ({
  page: host,
  browser,
}, info) => {
  test.setTimeout(120000);
  const context = await browser.newContext({
    storageState: 'e2e/storage-state.json',
    viewport: info.project.use.viewport,
  });
  try {
    const guest = await context.newPage();
    const pages = [host, guest];
    for (const page of pages) {
      await observeBoardGame(page);
      await page.addInitScript(() => localStorage.setItem('lang', 'en'));
    }
    await host.goto('http://127.0.0.1:8787/?speed=0');
    await openTitleChoice(host, 'online-create');
    await host.getByTestId('online-name').fill('Alice');
    await host.getByTestId('online-create-submit').click();
    await expect(host.getByTestId('screen-lobby')).toBeVisible();
    const code = (await host.locator('.room-code strong').textContent())!.trim();
    await guest.goto(`http://127.0.0.1:8787/r/${code}?speed=0`);
    await guest.getByTestId('online-name').fill('Bob');
    await guest.getByTestId('online-join-submit').click();
    await expect(guest.getByTestId('screen-lobby')).toBeVisible();
    await host.getByTestId('lobby-start').click();
    for (const page of pages) await page.waitForFunction(() => window.__db?.art.boardReady);
    let captured = false;
    const selector =
      'button[data-choice]:visible:enabled, button[data-action-index]:visible:enabled';
    for (let action = 0; action < 120 && !captured; action++) {
      await expect
        .poll(async () =>
          (await Promise.all(pages.map((p) => p.locator(selector).count()))).some(Boolean),
        )
        .toBe(true);
      const actor = (await host.locator(selector).count()) ? host : guest;
      const waiting = actor === host ? guest : host;
      if (await actor.locator('[data-testid^="pick-"]:visible:enabled').count()) {
        await waitForBattleArt(actor);
        await waitForBattleArt(waiting);
        await expect.poll(async () => (await camera(actor)).zoom).toBeCloseTo(1.12, 2);
        expect(await camera(waiting)).toEqual({ zoom: 1, x: 0, y: 0 });
        await expect(waiting.getByTestId('stance-banner')).toContainText('is choosing');
        expect(await waiting.locator('[data-action-index]:enabled').count()).toBe(0);
        await expect(waiting.getByTestId('stance-banner')).toContainText(
          actor === host ? 'Alice' : 'Bob',
        );
        const own = await actor.evaluate(() => window.__db!.getState());
        const remote = await waiting.evaluate(() => window.__db!.getState());
        expect(remote.phase).toEqual(own.phase);
        const objects = await waiting.evaluate(() =>
          (window as Probe).__m5aGame.scene
            .getScene('BattleScene')
            .children.getChildren()
            .map((o) => o.name),
        );
        expect(objects).toContain('battle-picker-thinking');
        expect(objects).toContain('battle-picker-ring');
        await screenshot(actor, 'online-local', info.outputPath('online-local.png'));
        await screenshot(waiting, 'online-waiting', info.outputPath('online-waiting.png'));
        await info.attach('real-room', {
          body: JSON.stringify({
            code,
            actor: actor === host ? 'Alice' : 'Bob',
            phase: own.phase,
            local: await camera(actor),
            remote: await camera(waiting),
          }),
          contentType: 'application/json',
        });
        captured = true;
        break;
      }
      const previous = await actor.evaluate(() => JSON.stringify(window.__db!.getState()));
      const preferred = actor
        .locator(
          '[data-testid="action-duel"]:visible:enabled, [data-testid="action-leave"]:visible:enabled, [data-testid^="shop-leave-"]:visible:enabled',
        )
        .first();
      await ((await preferred.count()) ? preferred : actor.locator(selector).first()).click();
      for (const page of pages)
        await expect
          .poll(() => page.evaluate(() => JSON.stringify(window.__db!.getState())))
          .not.toBe(previous);
    }
    expect(captured, 'real Worker journey reached a human battle in 120 UI actions').toBe(true);
  } finally {
    await context.close();
  }
});
