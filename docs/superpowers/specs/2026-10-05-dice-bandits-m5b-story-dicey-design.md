# Dice Bandits — M5b-1 Intro Comic + Dicey First-Time Tips — Design

Status: draft for owner review · Date: 2026-10-05 · Milestone: M5b-1 (of M5b-1, M5b-2)
Owner: Marci · Planner/lead: Monday · Implementation: dev-* kanban team

## 1. Goal

A first-time player understands **why** they are racing (story) and **how** to play
(just-in-time tips) without anyone explaining. The owner's 2026-10-01 review called the live
game "not understandable"; M5a fixed the look, M5b fixes understanding.

M5b ships in two releases, each play-tested before the next:
- **M5b-1 (this spec):** intro comic + Dicey first-time tips.
- **M5b-2 (separate spec later):** scripted tutorial game with Dicey (decision 5 below).

## 2. Owner decisions (brainstorm 2026-10-05)

| # | Decision |
|---|---|
| 1 | Story = the drafted 4-panel "Hunt for the Golden Pig" (concept `08_story_intro`), skippable. |
| 2 | Comic auto-plays only on the **first visit on a device**; a title-screen "Story" button replays it. |
| 3 | Comic art = **4 new generated panels** in the M5a chibi style, **no text in the images**; captions rendered by the game (TH/EN); light paper-puppet motion. Owner approves panels before integration. |
| 4 | Dicey teaches **both** ways: first-time tips (M5b-1) and a separate tutorial mode (M5b-2). |
| 5 | Tutorial (M5b-2) = a short scripted game, a few minutes, 1 human vs 1 bot, preset dice, Dicey guides roll → move → fork → chest → battle → shop → town → steal; ends with "Start real game"; entry from the title screen and offered after the first-visit comic. |
| 6 | Release split: **2 releases** (M5b-1 then M5b-2). |
| 7 | Overall M5b-1 design approved by the owner ("A"). |

Lead decisions (low stakes, owner may override): no voice-over (existing music/SFX only);
captions follow the existing language toggle.

## 3. Scope

In scope (M5b-1, client only — `apps/client`):
- Intro comic overlay: 4 panels, captions, skip, first-visit auto-play, title "Story" button (§5).
- Dicey tips: speech-bubble component, ~13 first-time triggers, per-device memory,
  menu on/off toggle (§6).
- New art: 4 comic panels + Dicey in 3 poses (§7).
- i18n strings EN + TH for every caption and tip.

Out of scope: tutorial mode (M5b-2); King's Orders, Baron boss, Mask Gang (M5c); any engine
rule, data or balance change; server/room protocol change; save-format change; accounts (M3);
voice-over.

## 4. Constraints kept

- `packages/engine` and the worker/room code are **not modified**. Hot-seat and online keep
  identical behaviour; tips are a pure client-side view layer.
- `SAVE_VERSION` stays 2; existing saves and live online rooms keep working.
- Every existing `data-testid` keeps its name and meaning; new elements get new ids.
- i18n: every new visible string in `en.json` and `th.json`; Thai wraps, never clips.
- `?speed=0` makes comic motion instant; `prefers-reduced-motion` shows static panels.
- Landscape only (portrait keeps the rotate hint); checked at 1280×720 and 915×412.
- No third-party CDN; assets self-hosted WebP; new art adds ≤ **1.5 MB** over the wire
  (current art ≈ 2.9 MB; M5a budget 6 MB total still holds).
- Comic and tips never block game flow: no bot timer, online turn timer or remote action waits
  on a tip.

## 5. Intro comic

Panels (captions are game text, not painted):
1. **King broke** — King Bart opens the royal treasure chest; only moths fly out.
2. **The real thief** — Baron Raccoon runs off with the Golden Pig (the kingdom's piggy bank).
3. **The decree** — the King: "Whoever brings back the most money wins the crown!" Dicey
   appears beside him as the guide.
4. **Off they go** — the four heroes race out of the gate; Mint is already pickpocketing
   Sir Bram.

Behaviour:
- Full-screen overlay above the title screen (`data-testid="intro-comic"`). Panel image fills
  the screen (cover, safe area kept for faces); caption strip at the bottom; panel dots.
- Tap/click/Enter/→ advances; ← goes back; "Skip" (`intro-skip`) always visible; last panel
  shows "Let's go!" (`intro-done`). Esc = skip.
- Motion: per panel a slow pan/zoom (≤ 6 % scale) + one small puppet hop on the key prop;
  cross-fade between panels. Reduced motion → static panels, instant swaps.
- First visit: on title-screen load, if `localStorage['dice-bandits:intro-seen']` is unset,
  the comic opens; finishing **or** skipping sets it. Storage unavailable → show once per page
  load, never crash.
- Title screen gets a "Story" button (`title-story`) that replays the comic any time.
- Not shown when the page is opened through an online invite link (room route `/r/<CODE>`) — the
  player is joining a friend; the "Story" button still works later.
- Audio: existing title music continues; existing UI click SFX on page turn.

## 6. Dicey first-time tips

### 6.1 Component
- `DiceyTip` DOM overlay (`data-testid="dicey-tip"`): Dicey portrait (pose per topic) + speech
  bubble (1–2 short lines) + "Got it" (`dicey-tip-ok`). Non-modal: the board stays visible and
  playable; the bubble sits in a corner zone measured not to cover the action tray, HP card,
  turn ribbon, seat cards or menu (0 overlap at 1280×720 and 915×412).
- One tip at a time; if several trigger together, queue them (max 2 per turn, rest wait for
  the next human turn).
- Auto-dismiss is **not** used (reading speed varies); taking a game action also dismisses
  the visible tip and still counts it as seen.

### 6.2 Triggers (13 topics)
Shown only when **the acting seat is controlled by a human on this device** (hot-seat: a human
seat; online: `online.you === activeSeat`; bot-takeover seats never), and only the first time
for that topic on the device.

| Topic id | When | Pose |
|---|---|---|
| `roll` | first `awaitRoll` for a local human | pointing |
| `fork` | first `chooseBranch` | pointing |
| `castle` `town` `shop` `chest` `monster` `event` `trap` | first landing on that space kind | happy / surprised (trap, monster) |
| `battle` | first `battle` phase involving a local human | surprised |
| `duel` | first `duelOffer` | pointing |
| `levelUp` | first `levelUp` | happy |
| `townManage` | first `townManage` (own town) | happy |

Tip text reuses the existing `space.*.info` meaning but is written in Dicey's voice (new keys
`dicey.tip.<topic>`); exact copy in the plan, reviewed by the owner with the art checkpoint.

### 6.3 Memory and switch
- `localStorage['dice-bandits:tips']` = `{ enabled: boolean, seen: string[] }`; default
  enabled, empty. Hot-seat players share one device record (accepted trade-off, decision 4).
- Board menu gets a "Dicey tips" on/off switch (`menu-dicey-tips`); turning it off hides any
  visible tip immediately. A "Reset tips" link in the same section clears `seen`.

### 6.4 Online and determinism
- Tips read state only; they never dispatch actions and never touch the controller, socket
  or save. Two browsers in one room may see different tips; game state must stay identical.

## 7. Art

- **Comic:** 4 panels, 16:9, generated with the Hermes image backend using `08_story_intro`,
  `03_cast`, `02_heroes` as references; no lettering, no speech bubbles in the image; key
  characters away from the bottom 20 % (caption strip). Shipped as WebP ≤ 300 KB each at
  1600×900, with a 960×540 variant for phones.
- **Dicey:** winged chibi die (concept `03_cast`), 3 poses (happy, pointing, surprised) on a
  flat `#bdbdbd` background → processed by `tools/cartoonize/` (alpha, trim, fit) → 256 px
  WebP atlas.
- Vision check against a written checklist (outfits, colours, character identity, no text);
  regenerate on mismatch.
- **Owner checkpoint A:** all 4 panels + 3 Dicey poses on one sheet, approved before the team
  wires them in. Raw generations are never committed; approved WebP only.

## 8. Testing and acceptance

Automated (CI, all must pass):
- **Unit:** tip trigger selection per phase/landing (each topic fires once; never for
  bot/remote/bot-takeover seats; disabled switch → none; queue cap 2); storage corrupt/absent
  fallback; comic state machine (next/back/skip/done sets flag).
- **E2E (TH + EN, 1280×720 + 915×412):** fresh storage → comic auto-opens → skip → not shown
  on reload; "Story" replays; invite-link load does not auto-open; each of the 13 tips appears
  once in a seeded hot-seat game and not again after reload; toggle off hides tips; 0 overlap
  between `dicey-tip` and HUD controls; online two-browser game with tips on both sides keeps
  identical state and no console errors; reduced-motion and `?speed=0` paths.
- **Assets:** 4 panels + 3 poses present, sizes within §7, transparency on Dicey, total new
  art ≤ 1.5 MB.
- Existing gates unchanged: typecheck, lint, format, unit, worker, sim, build, production
  build has no test hooks; existing e2e suites pass unmodified (tests that would now see the
  comic seed `intro-seen`/tips-off via helper, not by deleting assertions).

Owner checkpoints:
- **A** art sheet (§7) before integration.
- **B** preview link / screenshots before production (same as M5a).

Done when: CI green, checkpoints A and B approved, deployed, live check (fresh-browser comic,
one hot-seat game with tips, one two-browser online game, no console errors) passes. Then the
owner play-tests before M5b-2 starts.

## 9. Risks

- **Tips annoy or block** → non-modal, max 2 per turn, global off switch, one-time per topic.
- **Online desync** → tips are read-only view code; e2e asserts identical state across two
  browsers.
- **Existing e2e break on the new first-visit comic** → shared helper seeds storage; tests
  are adapted by setup, never by weakening assertions.
- **Character drift in comic panels** → always attach concept references; vision checklist;
  owner checkpoint A.
- **Hot-seat shared device** means player 2 may miss tips player 1 dismissed → accepted;
  M5b-2 tutorial covers full teaching.
