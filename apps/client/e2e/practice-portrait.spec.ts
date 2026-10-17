import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { openTitleChoice } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

// Approved mockup A (owner, 2026-10-17): in portrait practice the tutor becomes
// a bottom bar and the board takes the full width above it. Every assertion
// here is scoped to `#app.practice-root` portrait phones; landscape, desktop
// and the normal (non-practice) game must not move by a pixel.
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 360, height: 780 },
  { width: 412, height: 915 },
];

// Anything the coach bar must never cover while the player is asked to tap.
const CONTROL_SELECTORS = [
  '.practice-highlight',
  '.action-tray',
  '[data-testid="turn-ribbon"]',
  '[data-testid="menu-button"]',
  '[data-testid="map-toggle"]',
  '[data-testid^="hp-"]',
  '[data-testid^="seat-cards-"]',
];

type Geometry = {
  viewport: { width: number; height: number };
  canvas: Rect | null;
  coach: Rect | null;
  highlight: (Rect & { hit: boolean }) | null;
  exit: (Rect & { insideViewport: boolean; insideTopbar: boolean }) | null;
  topbar: Rect | null;
  intersections: { name: string; area: number }[];
  coachSmallText: string[];
  coachOverflow: { coach: boolean; card: boolean; coachDelta: number; cardDelta: number };
  ribbonLines: number | null;
  rotateHintVisible: boolean;
};

type Rect = { x: number; y: number; width: number; height: number };

async function measurePractice(page: Page): Promise<Geometry> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate((controlSelectors: string[]) => {
    const rectOf = (element: Element): Rect => {
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const visible = (selector: string): Element | null =>
      [...document.querySelectorAll(selector)].find((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      }) ?? null;
    const intersectArea = (a: Rect | null, b: Rect | null): number => {
      if (!a || !b) return 0;
      const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      return Math.max(0, width) * Math.max(0, height);
    };
    const viewport = { width: innerWidth, height: innerHeight };
    const canvasElement = document.querySelector('canvas');
    const coachElement = document.querySelector('[data-testid="practice-coach"]');
    const coach = coachElement ? rectOf(coachElement) : null;
    const cardElement = document.querySelector('.practice-coach-card');
    const highlightElement = visible('.practice-highlight');
    const exitElement = visible('[data-testid="practice-exit"]');
    const topbarElement = visible('.practice-topbar');
    const exit = exitElement ? rectOf(exitElement) : null;
    const topbar = topbarElement ? rectOf(topbarElement) : null;
    const highlight = highlightElement
      ? {
          ...rectOf(highlightElement),
          hit: (() => {
            const centre = document.elementFromPoint(
              rectOf(highlightElement).x + rectOf(highlightElement).width / 2,
              rectOf(highlightElement).y + rectOf(highlightElement).height / 2,
            );
            return centre === highlightElement || highlightElement.contains(centre);
          })(),
        }
      : null;
    const intersections = controlSelectors
      .map((selector) => {
        const element = visible(selector);
        return element
          ? { name: selector, area: intersectArea(coach, rectOf(element)) }
          : { name: selector, area: 0 };
      })
      .filter((entry) => entry.area > 0 || controlSelectors.includes(entry.name));
    const coachSmallText = [
      ...((coachElement ?? document).querySelectorAll<HTMLElement>('*') ?? []),
    ]
      .filter(
        (element) =>
          element.offsetParent !== null &&
          element.children.length === 0 &&
          element.textContent?.trim() &&
          parseFloat(getComputedStyle(element).fontSize) < 14,
      )
      .map((element) => `${element.className}:${getComputedStyle(element).fontSize}`);
    const ribbonElement = visible('[data-testid="turn-ribbon"]');
    return {
      viewport,
      canvas: canvasElement ? rectOf(canvasElement) : null,
      coach,
      highlight,
      exit: exit
        ? {
            ...exit,
            insideViewport:
              exit.x >= 0 &&
              exit.y >= 0 &&
              exit.x + exit.width <= viewport.width &&
              exit.y + exit.height <= viewport.height,
            insideTopbar:
              !!topbar &&
              exit.x >= topbar.x &&
              exit.y >= topbar.y &&
              exit.x + exit.width <= topbar.x + topbar.width &&
              exit.y + exit.height <= topbar.y + topbar.height,
          }
        : null,
      topbar,
      intersections,
      coachSmallText,
      coachOverflow: {
        coach: coachElement ? coachElement.scrollHeight > coachElement.clientHeight + 1 : false,
        card: cardElement ? cardElement.scrollHeight > cardElement.clientHeight + 1 : false,
        coachDelta: coachElement ? coachElement.scrollHeight - coachElement.clientHeight : 0,
        cardDelta: cardElement ? cardElement.scrollHeight - cardElement.clientHeight : 0,
      },
      ribbonLines: ribbonElement
        ? Math.round(
            ribbonElement.getBoundingClientRect().height /
              parseFloat(getComputedStyle(ribbonElement).lineHeight || '20'),
          )
        : null,
      rotateHintVisible: !!visible('[data-testid="rotate-hint"]'),
    };
  }, CONTROL_SELECTORS);
}

function assertPortraitGeometry(geometry: Geometry, label: string) {
  const { viewport } = geometry;
  // Board takes the full width and ends above the tutor bar.
  expect.soft(geometry.canvas, `${label}: canvas present`).not.toBeNull();
  expect.soft(Math.round(geometry.canvas!.x), `${label}: canvas left`).toBe(0);
  expect
    .soft(Math.round(geometry.canvas!.width), `${label}: canvas full width`)
    .toBe(viewport.width);
  expect
    .soft(geometry.canvas!.y + geometry.canvas!.height, `${label}: canvas bottom <= coach top`)
    .toBeLessThanOrEqual(geometry.coach!.y + 0.5);
  // The coach never covers a control the player must tap.
  for (const entry of geometry.intersections) {
    expect.soft(entry.area, `${label}: coach / ${entry.name}`).toBe(0);
  }
  // The highlighted control is visible, tappable, and on screen.
  expect.soft(geometry.highlight, `${label}: highlight present`).not.toBeNull();
  expect
    .soft(geometry.highlight!.width, `${label}: highlight min width`)
    .toBeGreaterThanOrEqual(44);
  expect
    .soft(geometry.highlight!.height, `${label}: highlight min height`)
    .toBeGreaterThanOrEqual(44);
  expect
    .soft(geometry.highlight!.x, `${label}: highlight left inside viewport`)
    .toBeGreaterThanOrEqual(0);
  expect
    .soft(geometry.highlight!.y, `${label}: highlight top inside viewport`)
    .toBeGreaterThanOrEqual(0);
  expect
    .soft(geometry.highlight!.x + geometry.highlight!.width, `${label}: highlight right`)
    .toBeLessThanOrEqual(viewport.width);
  expect
    .soft(geometry.highlight!.y + geometry.highlight!.height, `${label}: highlight bottom`)
    .toBeLessThanOrEqual(viewport.height);
  expect.soft(geometry.highlight!.hit, `${label}: highlight hit by elementFromPoint`).toBe(true);
  // Exit stays a single-line button inside the top bar.
  expect.soft(geometry.exit, `${label}: exit present`).not.toBeNull();
  expect.soft(geometry.exit!.insideViewport, `${label}: exit inside viewport`).toBe(true);
  expect.soft(geometry.exit!.insideTopbar, `${label}: exit inside top bar`).toBe(true);
  expect.soft(geometry.exit!.width, `${label}: exit tap width`).toBeGreaterThanOrEqual(44);
  expect.soft(geometry.exit!.height, `${label}: exit tap height`).toBeGreaterThanOrEqual(40);
  expect.soft(geometry.exit!.height, `${label}: exit height <= 48`).toBeLessThanOrEqual(48);
  // The bottom bar stays readable and never clips its own content.
  expect.soft(geometry.coach, `${label}: coach present`).not.toBeNull();
  expect.soft(geometry.coach!.height, `${label}: coach bar height`).toBeLessThanOrEqual(200);
  expect.soft(geometry.coachSmallText.length, `${label}: coach text below 14px`).toBe(0);
  expect
    .soft(geometry.coachOverflow.coachDelta, `${label}: coach scrollHeight <= clientHeight + 1`)
    .toBeLessThanOrEqual(1);
  expect
    .soft(geometry.coachOverflow.cardDelta, `${label}: coach card scrollHeight <= clientHeight + 1`)
    .toBeLessThanOrEqual(1);
  // The turn ribbon reads as a sentence, at most two lines.
  if (geometry.ribbonLines !== null) {
    expect.soft(geometry.ribbonLines, `${label}: turn ribbon <= 2 lines`).toBeLessThanOrEqual(2);
  }
  // The rotate prompt must not sit between the board and the tutor bar.
  expect.soft(geometry.rotateHintVisible, `${label}: rotate hint hidden in practice`).toBe(false);
}

function classifyHighlight(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const highlight = document.querySelector<HTMLElement>('.practice-highlight');
    if (!highlight) return null;
    const id = highlight.dataset.testid ?? highlight.dataset.choice ?? '';
    if (id.startsWith('action-roll')) return 'roll';
    if (id.startsWith('action-chooseBranch')) return 'chooseBranch';
    if (id.startsWith('pick-')) return 'battlePick';
    return null;
  });
}

async function saveEvidence(
  page: Page,
  info: TestInfo,
  label: string,
  geometry: Geometry,
): Promise<void> {
  await info.attach(label, {
    body: JSON.stringify(geometry, null, 2),
    contentType: 'application/json',
  });
  console.log(`practice-portrait ${label}: ${JSON.stringify(geometry)}`);
  if (process.env.PORTRAIT_EVIDENCE_DIR) {
    const name = `${label}.png`;
    await page.screenshot({ path: `${process.env.PORTRAIT_EVIDENCE_DIR}/${name}` });
  }
}

async function openPractice(
  page: Page,
  lang: 'th' | 'en',
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  await page.addInitScript((locale) => {
    localStorage.setItem('lang', locale);
    localStorage.setItem('dice-bandits:intro-seen', '1');
    localStorage.setItem('dice-bandits:tips', '{"enabled":false,"seen":["roll"]}');
  }, lang);
  await page.goto('/?speed=0');
  await openTitleChoice(page, 'title-practice');
  await expect(page.getByTestId('practice-begin')).toBeVisible();
  await page.getByTestId('practice-begin').click();
  await page.waitForFunction(() => window.__db?.art.boardReady ?? false);
}

async function advanceCoach(page: Page): Promise<void> {
  // On main's 122px board a wrong tap can error the oracle and park the
  // tutorial on its invitation dialog: resume or restart it and keep driving.
  const resume = page
    .locator('[data-testid="practice-begin"]:visible, [data-testid="practice-retry"]:visible')
    .first();
  if (await resume.count()) {
    await resume.click({ timeout: 4_000 }).catch(() => {});
    await page.waitForTimeout(500);
    return;
  }
  const highlight = page.locator('.practice-highlight');
  if ((await highlight.count()) && (await highlight.isEnabled())) {
    // Center click: main's narrow board can leave the control half outside
    // the viewport, where Playwright's scroll-into-view dance stalls.
    await highlight.click({ force: true });
  } else {
    const fallback = page
      .locator(
        '[data-testid="dicey-tip-ok"]:visible, .battle-post [data-testid^="post-"]:visible:enabled, [data-testid^="perk-"]:visible:enabled',
      )
      .first();
    if (await fallback.count()) await fallback.click({ timeout: 4_000 }).catch(() => {});
  }
  await page.waitForTimeout(500);
}

for (const viewport of VIEWPORTS) {
  for (const lang of ['th', 'en'] as const) {
    const label = `${viewport.width}x${viewport.height}-${lang}`;
    test.describe(`practice portrait ${label}`, () => {
      test(`board is full width above the tutor bar ${label}`, async ({ page }, info) => {
        test.skip(info.project.name !== 'desktop', 'Portrait viewports are set inside the test');
        test.setTimeout(150_000);
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(m.text());
        });
        await openPractice(page, lang, viewport);

        const captured = new Set<string>();
        for (let step = 0; step < 90 && captured.size < 3; step += 1) {
          await page.locator('.practice-highlight').waitFor({ state: 'visible', timeout: 20_000 });
          await expect(page.locator('.practice-highlight')).toBeEnabled({ timeout: 20_000 });
          const kind = await classifyHighlight(page);
          if (kind && !captured.has(kind)) {
            const geometry = await measurePractice(page);
            assertPortraitGeometry(geometry, `${label}-${kind}`);
            await saveEvidence(page, info, `${label}-${kind}`, geometry);
            captured.add(kind);
            if (kind === 'battlePick') {
              // The parent card's wrong-tap nudge must still fit in the bar:
              // force the muted noncanonical pick like a real finger would.
              const nudge = page.locator('[data-testid="practice-nudge"]');
              if (await nudge.count()) {
                const muted = page.locator('[data-testid="pick-attack"][aria-disabled="true"]');
                if (await muted.count()) {
                  const before = await page.evaluate(() => JSON.stringify(window.__db!.getState()));
                  await muted.first().click({ force: true });
                  expect(await page.evaluate(() => JSON.stringify(window.__db!.getState()))).toBe(
                    before,
                  );
                  await expect(nudge).toBeVisible();
                  const nudged = await measurePractice(page);
                  expect
                    .soft(nudged.coachOverflow.coachDelta, `${label}-nudge: coach fits with nudge`)
                    .toBeLessThanOrEqual(1);
                  expect
                    .soft(
                      nudged.coachOverflow.cardDelta,
                      `${label}-nudge: coach card fits with nudge`,
                    )
                    .toBeLessThanOrEqual(1);
                  expect
                    .soft(nudged.coachSmallText.length, `${label}-nudge: text below 14px`)
                    .toBe(0);
                  for (const entry of nudged.intersections) {
                    expect.soft(entry.area, `${label}-nudge: coach / ${entry.name}`).toBe(0);
                  }
                  await saveEvidence(page, info, `${label}-battlePick-nudge`, nudged);
                }
              }
            }
          }
          await advanceCoach(page);
        }
        expect
          .soft([...captured].sort(), `${label}: roll/chooseBranch/battlePick all measured`)
          .toEqual(['battlePick', 'chooseBranch', 'roll']);
        expect(errors).toEqual([]);
      });
    });
  }
}

test('rotate hint still shows in a normal portrait game', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'One project is enough');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'th');
    localStorage.setItem('dice-bandits:intro-seen', '1');
    localStorage.setItem('dice-bandits:tips', '{"enabled":false,"seen":["roll"]}');
  });
  await page.goto('/?seed=m5ab-1&speed=0');
  await openTitleChoice(page, 'new');
  for (let seat = 1; seat < 4; seat += 1) {
    await page.locator(`[data-seat="${seat}"] select[data-field="control"]`).selectOption('bot');
  }
  await page.locator('[data-seat="0"] select[data-field="classId"]').selectOption('knight');
  await page.locator('#setup-form button[type="submit"]').click();
  await expect(page.locator('[data-testid="screen-board"]')).toBeVisible();
  await expect(page.getByTestId('rotate-hint')).toBeVisible();
});
