# Dice Bandits M5b-1 Intro Comic + Dicey Tips Implementation Plan

**Goal:** First-visit intro comic (4 panels, skippable, replayable) and Dicey first-time tips (13 topics, non-modal, per-device, switchable), client only.

**Spec:** `docs/superpowers/specs/2026-10-05-dice-bandits-m5b-story-dicey-design.md` (owner-approved 2026-10-05).

**Art (owner checkpoint A approved 2026-10-06, already committed on this branch):**
- `apps/client/public/art/story/panel{1..4}.webp` (1600×900) and `panel{1..4}-sm.webp` (960×540). Use `-sm` when `window.innerWidth <= 960`.
- `apps/client/public/art/dicey.webp` + `dicey.json` (frames `happy`, `point`, `surprised`; produced by `tools/cartoonize` entry `dicey`). DOM-only asset: do NOT add it to `ART_ATLASES` / BootScene.
- Shipped art total after this commit: 4 364 940 bytes (budget 6 000 000, checked by `scripts/check-art-budget.mjs`).

## Global constraints

- Do not modify `packages/engine`, `apps/client/src/online/*` protocol code, `apps/server`/worker code, or `save.ts` (`SAVE_VERSION` stays 2).
- Every existing `data-testid` keeps name and meaning. Existing tests are adapted only by setup (storage seeding), never by deleting/weakening assertions; list every touched existing test file in the PR body.
- Every new string in `apps/client/src/i18n/en.json` **and** `th.json`; Thai wraps, never clips, at 915×412.
- `?speed=0` → comic motion instant; `prefers-reduced-motion: reduce` → static panels, no pan/zoom/hop, instant swaps.
- Tips are read-only view code: never dispatch actions, never touch controller/socket/save, never await anything the game loop waits on.
- Landscape only; verify 1280×720 and 915×412.
- Full gate (repo root): `npm run typecheck && npm run lint && npm run format:check && npm test && npm run test:worker && npm run build -w @dice-bandits/client && npm run sim -- --games 200 --players 4 && npm run sim:room -- --games 200 && run-locked dice-bandits-e2e npm run e2e`.

## Storage keys

- `dice-bandits:intro-seen` = `"1"` once the comic is finished or skipped.
- `dice-bandits:tips` = JSON `{ "enabled": boolean, "seen": string[] }`; default `{enabled:true, seen:[]}`. Corrupt/absent/throwing storage → defaults, never crash (comic: show once per page load).

## E2E storage seeding (keeps existing suites stable)

Existing specs open `/` and would now see the comic and tips. Add `apps/client/e2e/storage-state.json` with localStorage for origin `http://localhost:4173`: `dice-bandits:intro-seen = "1"`, `dice-bandits:tips = {"enabled":false,"seen":[]}`, and set `use.storageState` in `playwright.config.ts`. Specs that build their own context with `browser.newContext()` — `layout.spec.ts:44,80` and `online.spec.ts:123` (`newContext` helper) — must pass the same `storageState`; include an entry for every origin those contexts load (e.g. `http://127.0.0.1:8787` if online pages are served there). New M5b specs override it with an empty state where they test first-visit behaviour.

## Copy (EN / TH)

Comic captions (`intro.caption1..4`):
1. "King Bart opens the royal treasure chest… only moths fly out!" / "หีบสมบัติของราชาบาร์ตเหลือแต่ผีเสื้อกลางคืน!"
2. "Baron Raccoon runs off with the Golden Pig — the kingdom's piggy bank!" / "บารอนแรคคูนแบกหมูทองคำ กระปุกออมสินของอาณาจักร หนีไปกลางดึก"
3. "“Whoever brings back the most gold wins the crown!” Dicey will guide you." / "“ใครหาเงินคืนอาณาจักรได้มากที่สุด จะได้มงกุฎ!” ไดซี่จะคอยนำทาง"
4. "The heroes dash off… and Mint is already picking Sir Bram's pocket!" / "เหล่าฮีโร่ออกวิ่งทันที… แต่มินต์ล้วงกระเป๋าเซอร์แบรมตั้งแต่ยังไม่พ้นประตูเมือง!"

UI: `intro.skip` Skip / ข้าม · `intro.next` Next / ถัดไป · `intro.back` Back / ย้อนกลับ · `intro.done` Let's go! / ไปกันเลย! · `title.story` Story / ดูเรื่องย่อ · `dicey.name` Dicey / ไดซี่ · `dicey.ok` Got it / เข้าใจแล้ว · `menu.diceyTips` Dicey tips / ไดซี่สอนเล่น · `menu.diceyReset` Reset tips / ให้ไดซี่สอนใหม่

Tips (`dicey.tip.<topic>`, pose in brackets):
- `roll` [point] "Tap the big die to roll, then move that many spaces!" / "แตะลูกเต๋าใหญ่เพื่อทอย แล้วเดินตามแต้มที่ได้!"
- `fork` [point] "A fork! Tap an arrow to pick your road." / "ทางแยก! แตะลูกศรเพื่อเลือกทางเดิน"
- `castle` [happy] "The castle heals you fully. Come back when you're hurt!" / "ปราสาทรักษาเลือดเต็ม เจ็บเมื่อไหร่ก็แวะมา!"
- `town` [happy] "A town! Claim it, invest to grow it, or battle its guardian." / "เมือง! ยึดไว้ ลงทุนให้โต หรือสู้กับผู้เฝ้าเมือง"
- `shop` [happy] "Shop time! Buy gear to win more fights." / "ร้านค้า! ซื้อของไว้สู้ให้ชนะ"
- `chest` [happy] "A chest! Free gold — sometimes an item too." / "หีบสมบัติ! ได้เงินฟรี บางทีได้ของด้วย"
- `monster` [surprised] "A monster! Beat it for gold and XP — or pay the toll." / "มอนสเตอร์! สู้ชนะได้เงินกับค่าประสบการณ์ หรือจ่ายค่าผ่านทาง"
- `event` [surprised] "Something random happens here. Good luck!" / "ช่องนี้สุ่มเรื่องแปลก ๆ ขอให้โชคดี!"
- `trap` [surprised] "Ouch, a trap! You may lose gold or your next move." / "โดนกับดัก! อาจเสียเงินหรือเสียตาเดิน"
- `battle` [surprised] "Battle! Pick a card each round and outguess your foe." / "ต่อสู้! เลือกการ์ดทีละรอบ เดาใจคู่ต่อสู้ให้ได้"
- `duel` [point] "You caught up with a rival! Duel to rob them — or keep moving." / "ตามทันคู่แข่งแล้ว! ท้าดวลเพื่อปล้น หรือจะเดินต่อก็ได้"
- `levelUp` [happy] "Level up! Pick a perk to get stronger." / "เลเวลอัป! เลือกความสามารถให้เก่งขึ้น"
- `townManage` [happy] "Your own town! Invest gold to raise its income." / "เมืองของเรา! ลงทุนเพื่อให้ได้เงินมากขึ้น"

If a tip contradicts actual engine behaviour, change the wording minimally in both languages and list it in the PR body (owner reviews copy at the preview checkpoint).

## Task 1 — Intro comic (dev card T1)

Files: create `apps/client/src/ui/introComic.ts`, `apps/client/src/ui/introComic.test.ts`, `apps/client/e2e/intro.spec.ts`, `apps/client/e2e/storage-state.json`; modify `apps/client/src/ui/screens.ts` (title "Story" button `data-testid="title-story"` + first-visit auto-open in `showTitle`), `apps/client/src/ui/styles.css`, `apps/client/src/i18n/en.json`, `th.json`, `apps/client/playwright.config.ts`, plus `online.spec.ts` only if it creates contexts manually.

Behaviour: `openIntroComic({ onClose })` mounts `data-testid="intro-comic"` (role dialog, aria-modal, focus trapped) over the title; panel image `intro-panel` (object-fit cover), caption `intro-caption` (bottom strip, Thai wraps), dots, buttons `intro-back`, `intro-next`, `intro-skip` (always visible), `intro-done` on panel 4. Keys: →/Enter/Space next, ← back, Esc skip; tap on panel = next. Done or skip sets `intro-seen` and removes the overlay. Motion: slow pan/zoom ≤ 6 % per panel + cross-fade 250 ms; reduced motion / speed 0 → none. Title music keeps playing; reuse the existing UI click SFX on page turn if a helper exists (no new audio files). Auto-open only from `showTitle` when `intro-seen` is unset; the `/r/<CODE>` route never reaches `showTitle` on first load so it never auto-opens there — keep it that way.

Tests: unit (state machine next/back/skip/done, flag set on both exits, storage throwing → no crash); e2e (empty storage → comic auto-opens, 4 captions in EN then TH, skip → gone and absent after reload; `title-story` replays; `/r/ABCDE` load with empty storage → no comic; comic fully inside viewport and caption not clipped at 915×412; no console errors).

## Task 2 — Dicey tips core (dev card T2)

Files: create `apps/client/src/tutor/tips.ts` (pure), `apps/client/src/tutor/tips.test.ts`, `apps/client/src/ui/diceyTip.ts`, `apps/client/src/ui/diceyTip.test.ts`; modify `apps/client/src/main.ts` (both `onEvents` handlers: hot-seat ~line 309, online ~line 131), `styles.css`, i18n files.

`tips.ts`: `topicsFor(input: { prev: GameState; events: GameEvent[]; next: GameState; isLocalHuman: (seat: number) => boolean }): TipTopic[]` — pure, ordered: `roll` when `next.phase.kind === 'awaitRoll'` for a local human; `fork` on `chooseBranch`; `duel` on `duelOffer`; `battle` on `battle` phase involving a local human seat; `levelUp`; `townManage`; space topics from the final landing of a local human this batch (last `Moved` event of that seat; kind = the space whose `id === to` in `next.board.spaces` (look up by id, not index)). Plus `loadTips()/markSeen()/setEnabled()/resetTips()` over the storage key, and a queue that shows at most 2 tips per human turn (carry the rest to the next local human turn). `isLocalHuman`: hot-seat `players[seat].control === 'human'`; online `seat === online.you` and that seat's controller is not `botTakeover`.

`diceyTip.ts`: `data-testid="dicey-tip"` (role status, not modal, no focus steal), Dicey sprite via CSS background from `/art/dicey.webp` using the frame rects in `dicey.json` (import the JSON), bubble text, `dicey-tip-ok` button. Any game action button press or a new state from the controller dismisses the visible tip (counts as seen). Placement: a fixed corner zone that has 0 px² overlap with action tray, HP/seat cards, turn ribbon, menu/map buttons and battle HUD at 1280×720 and 915×412 — measure with the existing overlap helpers. Missing art → text-only bubble + `console.warn`.

Tests: unit for every topic trigger, never for bot/remote/botTakeover seats, disabled → none, seen → none, queue cap 2, storage corrupt → defaults; DOM test for the component.

## Task 3 — Menu switch + E2E (dev card T3)

Files: modify `apps/client/src/ui/menu.ts` (new section `data-testid="menu-dicey"` with switch `menu-dicey-tips` aria-pressed and button `menu-dicey-reset`; turning off hides any visible tip at once), i18n; create `apps/client/e2e/dicey.spec.ts`.

E2E (desktop + mobile projects, TH and EN): tips enabled, seeded hot-seat game via test hooks → `roll` tip appears, Got it closes it, does not reappear after reload; drive with existing helpers until at least `fork`, one space topic and `battle` have each appeared exactly once; switch off → tip hidden and none appear; reset → `roll` appears again; overlap 0 between `dicey-tip` and HUD controls on both viewports; online two-browser game (existing online helpers) with tips enabled on both: 8+ actions each, both clients show identical state (same comparison the online spec already uses), no console errors.

## Done for M5b-1

CI green on the PR to `main`; QA evidence; owner checkpoint B (screenshots/preview) approved; release merges and deploys; live check: fresh browser shows comic, one hot-seat game with tips, one two-browser online game, no console errors.
