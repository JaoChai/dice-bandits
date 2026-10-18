import { legalActions, step } from '@dice-bandits/engine';
import { expect, test, type Page } from '@playwright/test';
import { observeBoardGame, startBattleJourney } from './helpers';

// Layout A (owner-approved mock): the level-up choice is one centred card —
// ribbon banner → level chips → gains → divider → pick heading/hint → cards.
// This spec walks a real human level-up (same journey as battle-levelup.spec)
// and then sweeps every card viewport in TH and EN, including worst legal
// content (longest perk copy, 5+ digit gold) and the read-only (bot) state.
const VIEWPORTS = [
  { width: 915, height: 412 },
  { width: 844, height: 390 },
  { width: 390, height: 844 },
  { width: 360, height: 780 },
  { width: 1280, height: 720 },
] as const;

// The three longest perk details from POST_STRINGS (src/ui/battlePostModel.ts)
// per language; the spec cannot import that module (it pulls i18n JSON).
const LONGEST_DETAILS = {
  th: ['รับดาเมจมอนสเตอร์น้อยลง 15%', 'ทอยได้ 1 เดินเพิ่ม 1 ช่อง', 'โจมตีผู้นำแรงขึ้น 15%'],
  en: ['Damage against the leader +15%', 'Roll 1: move one extra space', 'Monster damage −15%'],
} as const;

const DETAIL_KEYS = [
  'hpUp',
  'atkUp',
  'defUp',
  'spdUp',
  'magUp',
  'taxman',
  'looter',
  'thickSkin',
  'quickFeet',
  'haggler',
  'scavenger',
  'grudgeHolder',
] as const;

// Owner evidence shots are written only when LEVELUP_EVIDENCE_DIR is set
// (same pattern as PORTRAIT_EVIDENCE_DIR in practice-portrait.spec.ts).
// CI runs with it unset and must never touch a host path.
const SHOT_DIR = process.env.LEVELUP_EVIDENCE_DIR;

async function winningPick(page: Page) {
  for (let i = 0; i < 50; i++) {
    const state = await page.evaluate(() => window.__db!.getState());
    if (state.phase.kind !== 'battle') return;
    if (await page.getByTestId('pass-ready').isVisible())
      await page.getByTestId('pass-ready').click();
    const legal = state.players.flatMap((p) => legalActions(state, p.seat));
    const action =
      legal.find((a) => a.type === 'battlePick' && a.pick === 'attack') ??
      legal.find((a) => a.type === 'battlePick' && a.pick === 'defend')!;
    if (!action || action.type !== 'battlePick') throw new Error('expected real battle choice');
    const next = step(state, action);
    if (next.events.some((event) => event.type === 'BattleEnded')) {
      await page.evaluate((speed) => {
        window.diceBanditsSpeed = speed;
      }, 1);
      await page.getByTestId(`pick-${action.pick}`).click();
      return next;
    }
    await page.getByTestId(`pick-${action.pick}`).click();
    await expect.poll(() => page.evaluate(() => window.__db!.getState())).toEqual(next.state);
  }
  throw new Error('journey did not finish a real battle');
}

/** Number of visible leaf elements that say the level-up banner text. */
async function bannerCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const post = document.querySelector('.battle-post');
    if (!post) return -1;
    let count = 0;
    for (const el of post.querySelectorAll<HTMLElement>('*')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const own = [...el.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );
      if (own && /lv up|เลเวลอัป|level up/i.test(el.textContent ?? '')) count += 1;
    }
    return count;
  });
}

type Geometry = Awaited<ReturnType<typeof cardGeometry>>;

/** Every visible element inside the centred card: box inside viewport+overlay AND the card itself, no text below 14px, perk cards hit at their centre, no inner scroll (either axis), portrait bottom above the rotate hint. */
async function cardGeometry(page: Page) {
  return page.evaluate(() => {
    const post = document.querySelector<HTMLElement>('.battle-post')!;
    const card = post.querySelector<HTMLElement>('.post-level-card');
    const postBox = post.getBoundingClientRect();
    const cardBox = card?.getBoundingClientRect();
    const problems: string[] = [];
    if (!card || !cardBox)
      return {
        missingCard: true as const,
        problems,
        perkCount: post.querySelectorAll('[data-testid^="perk-"]').length,
        hits: 0,
        cardOverflow: 0,
        cardHOverflow: 0,
        postOverflow: 0,
        edges: null,
      };
    for (const el of card.querySelectorAll<HTMLElement>('*')) {
      const box = el.getBoundingClientRect();
      if (!box.width && !box.height) continue;
      const own = [...el.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );
      if (own && Number.parseFloat(getComputedStyle(el).fontSize) < 14)
        problems.push(`small text: ${(el.textContent ?? '').trim().slice(0, 24)}`);
      if (
        box.left < postBox.left - 1 ||
        box.right > postBox.right + 1 ||
        box.top < postBox.top - 1 ||
        box.bottom > postBox.bottom + 1
      )
        problems.push(
          `outside the overlay: .${typeof el.className === 'string' ? el.className : ''}`,
        );
      // The overlay spans the whole stage, so "inside the overlay" is weak:
      // the acceptance is inside the centred card, whose box is what clips.
      if (
        box.left < cardBox.left - 1 ||
        box.right > cardBox.right + 1 ||
        box.top < cardBox.top - 1 ||
        box.bottom > cardBox.bottom + 1
      )
        problems.push(`outside the card: .${typeof el.className === 'string' ? el.className : ''}`);
      if (
        box.left < -1 ||
        box.top < -1 ||
        box.right > innerWidth + 1 ||
        box.bottom > innerHeight + 1
      )
        problems.push(
          `outside the viewport: .${typeof el.className === 'string' ? el.className : ''}`,
        );
    }
    const perks = [...card.querySelectorAll<HTMLElement>('[data-testid^="perk-"]')];
    const hits = perks.filter((perk) => {
      const box = perk.getBoundingClientRect();
      const centre = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return centre !== null && (centre === perk || perk.contains(centre));
    }).length;
    const hint = document.querySelector<HTMLElement>('[data-testid="rotate-hint"]');
    const hintBox = hint?.getBoundingClientRect();
    return {
      missingCard: false as const,
      problems,
      perkCount: perks.length,
      hits,
      cardOverflow: card.scrollHeight - card.clientHeight,
      cardHOverflow: card.scrollWidth - card.clientWidth,
      postOverflow: post.scrollHeight - post.clientHeight,
      edges: hintBox
        ? {
            cardBottom: card.getBoundingClientRect().bottom,
            hintTop: hintBox.top,
            hintHeight: hintBox.height,
          }
        : null,
    };
  });
}

async function expectOwnerCardFits(page: Page, vp: { width: number; height: number }) {
  const geo: Geometry = await cardGeometry(page);
  const label = `${vp.width}x${vp.height}`;
  expect(geo.missingCard, `${label}: centred level-up card present`).toBe(false);
  expect(
    geo.problems,
    `${label}: every element inside overlay and viewport, no text below 14px`,
  ).toEqual([]);
  expect(geo.perkCount, `${label}: 3 perk cards`).toBe(3);
  expect(geo.hits, `${label}: elementFromPoint hits every perk card`).toBe(3);
  expect(geo.cardOverflow, `${label}: card scrollHeight <= clientHeight + 1`).toBeLessThanOrEqual(
    1,
  );
  expect(geo.cardHOverflow, `${label}: card scrollWidth <= clientWidth + 1`).toBeLessThanOrEqual(1);
  expect(
    geo.postOverflow,
    `${label}: overlay scrollHeight <= clientHeight + 1`,
  ).toBeLessThanOrEqual(1);
  if (vp.height > vp.width) {
    expect(geo.edges?.hintHeight, `${label}: rotate hint visible in portrait`).toBeGreaterThan(0);
    expect(
      geo.edges!.cardBottom,
      `${label}: card bottom stays above the rotate hint`,
    ).toBeLessThanOrEqual(geo.edges!.hintTop + 1);
  }
}

async function injectWorstLegalContent(page: Page, lang: 'th' | 'en'): Promise<void> {
  const names = await page.evaluate(
    (keys) =>
      keys
        .map((id) =>
          (
            window as unknown as Window & { diceBanditsText: (key: string) => string }
          ).diceBanditsText(`perk.${id}`),
        )
        .sort((a, b) => b.length - a.length)
        .slice(0, 3),
    [...DETAIL_KEYS],
  );
  const details = [...LONGEST_DETAILS[lang === 'th' ? 'th' : 'en']];
  await page.evaluate(
    ({ names, details }) => {
      document.querySelectorAll<HTMLElement>('[data-testid^="perk-"]').forEach((card, index) => {
        const strong = card.querySelector('strong');
        const detail = card.querySelector('.post-card-detail');
        if (strong) strong.textContent = names[index % names.length];
        if (detail) detail.textContent = details[index % details.length];
      });
      const gold = document.querySelector('[data-testid="post-gold"] strong');
      if (gold) gold.textContent = '+99999';
      const total = document.querySelector('[data-testid="post-gold-total"]');
      if (total) total.textContent = '999999';
    },
    { names, details },
  );
}

for (const lang of ['th', 'en'] as const) {
  test(`level-up card A fits, is readable and says the level once (${lang})`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'Viewports are set inside the test');
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((locale) => localStorage.setItem('lang', locale), lang);
    await observeBoardGame(page);
    await startBattleJourney(page, 0);
    await winningPick(page);
    await expect(page.locator('[data-testid="battle-post"][data-beat="choice"]')).toBeVisible();
    await expect(page.locator('[data-testid^="perk-"]').first()).toBeVisible();
    const actor = await page.evaluate(() => {
      const state = window.__db!.getState();
      return state.phase.kind === 'levelUp' ? state.phase.seat : -1;
    });
    expect(actor).toBeGreaterThanOrEqual(0);
    const engineLevel = await page.evaluate(
      () =>
        window.__db!.getState().players[
          window.__db!.getState().phase.kind === 'levelUp'
            ? (window.__db!.getState().phase as { seat: number }).seat
            : 0
        ]!.level,
    );

    // Owner sweep: real content first (and the evidence screenshots).
    const shots = lang === 'th' ? [0, 2, 3] : [4];
    for (const [index, vp] of VIEWPORTS.entries()) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(150);
      expect(await bannerCount(page), `${vp.width}x${vp.height}: exactly one level-up banner`).toBe(
        1,
      );
      const chips = await page.evaluate(() => ({
        from: document.querySelector('.post-level-chips b')?.textContent ?? '',
        to: document.querySelector('.post-level-chips .post-chip-new')?.textContent ?? '',
      }));
      expect(chips, `${vp.width}x${vp.height}: chips equal the engine level (old -> new)`).toEqual({
        from: `Lv. ${engineLevel - 1}`,
        to: `Lv. ${engineLevel}`,
      });
      await expectOwnerCardFits(page, vp);
      const required = await page.evaluate(() => ({
        gold: document.querySelector('[data-testid="post-gold"]')?.textContent ?? '',
        total: document.querySelector('[data-testid="post-gold-total"]')?.textContent ?? '',
        waiting: document.querySelectorAll('[data-testid="post-waiting"]').length,
        overlay: document.querySelector('[data-testid="battle-post"]') !== null,
        xpTrack: document.querySelector('.post-xp-track') !== null,
        badge: document.querySelector('.post-level-badge') !== null,
      }));
      expect(required.overlay, `${vp.width}x${vp.height}: battle-post testid kept`).toBe(true);
      expect(required.gold).toContain('+');
      expect(required.total).not.toBe('');
      expect(required.waiting, 'exactly one post-waiting status element').toBe(1);
      expect(required.xpTrack, `${vp.width}x${vp.height}: no XP track in the choice state`).toBe(
        false,
      );
      expect(required.badge, 'no LV UP badge element').toBe(false);
      if (shots.includes(index) && SHOT_DIR)
        await page.screenshot({
          path: `${SHOT_DIR}/level-${vp.width}x${vp.height}-${lang}.png`,
        });
    }

    // Worst legal content: longest TH/EN perk copy and a 5+ digit gold total.
    await injectWorstLegalContent(page, lang);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(150);
      await expectOwnerCardFits(page, vp);
      expect(
        await bannerCount(page),
        `${vp.width}x${vp.height}: still exactly one level-up banner`,
      ).toBe(1);
    }

    // Read-only viewer (the online viewer of someone else's pick): the same
    // card at every viewport, waiting banner replacing the heading, dimmed
    // non-interactive cards.
    const readonlyViewer =
      (actor + 1) % (await page.evaluate(() => window.__db!.getState().players.length));
    for (const [index, vp] of VIEWPORTS.entries()) {
      await page.evaluate((viewer) => {
        const state = window.__db!.getState();
        window.__db!.post!.mountChoices(state, {
          viewer,
          dispatch: () => {},
          reduced: true,
        });
      }, readonlyViewer);
      await page.setViewportSize(vp);
      await page.waitForTimeout(150);
      await expectOwnerCardFits(page, vp);
      const readonly = await page.evaluate(() => {
        const overlay = document.querySelector('.battle-post')!;
        return {
          isReadonly: overlay.classList.contains('post-readonly'),
          banner:
            document.querySelector('.post-title')?.classList.contains('post-waiting-banner') ??
            false,
          waiting: document.querySelector('.post-title')?.textContent ?? '',
          cards: [...overlay.querySelectorAll<HTMLElement>('[data-testid^="perk-"]')].map(
            (card) => {
              const style = getComputedStyle(card);
              return {
                opacity: Number(style.opacity),
                grey: style.filter.includes('grayscale'),
                button: card.tagName === 'BUTTON',
              };
            },
          ),
        };
      });
      expect(readonly.isReadonly, `${vp.width}x${vp.height}: readonly state`).toBe(true);
      expect(readonly.banner, `${vp.width}x${vp.height}: waiting banner replaces the heading`).toBe(
        true,
      );
      expect(readonly.waiting, `${vp.width}x${vp.height}: waiting text present`).not.toBe('');
      expect(readonly.cards, `${vp.width}x${vp.height}: 3 dimmed cards`).toHaveLength(3);
      for (const card of readonly.cards) {
        expect(
          card.opacity,
          `${vp.width}x${vp.height}: readonly card opacity <= 0.55`,
        ).toBeLessThanOrEqual(0.55);
        expect(card.button, `${vp.width}x${vp.height}: readonly card is not a button`).toBe(false);
      }
      expect(
        await bannerCount(page),
        `${vp.width}x${vp.height}: readonly still says the level once`,
      ).toBe(1);
      if (lang === 'th' && index === 0 && SHOT_DIR)
        await page.screenshot({
          path: `${SHOT_DIR}/level-readonly-${vp.width}x${vp.height}-${lang}.png`,
        });
    }

    // Leave the real owner's choice mounted, untouched.
    await page.evaluate((viewer) => {
      const state = window.__db!.getState();
      window.__db!.post!.mountChoices(state, { viewer, dispatch: () => {}, reduced: true });
    }, actor);
    expect(errors, 'no page errors during the sweeps').toEqual([]);
  });
}
