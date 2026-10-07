# M6: Feel and clarity study

Status: design proposal, not owner approval or a game release. All local evidence uses detached `origin/main` `6784c4b0e490c4ccc9aad2425105660b625ede48`. Research is based on accessible reviews and a gameplay transcript; no frame-by-frame Dokapon timing/audio measurement was possible. Never treat our proposed milliseconds or gains as measured Dokapon settings.

## 1. What Dokapon actually teaches us

1. Movement has a clear cause: spin, get an exact movement allowance, choose a reachable destination, resolve that destination. The Outerhaven explicitly describes exact landing requirements and the small opening training area. GameGrin's search excerpt also describes previewing reachable destinations. Dice Bandits differs: its engine walks its directed graph and pauses at forks; do not add Dokapon destination-selection rules.
2. Battle has distinct attack and defence roles. The Outerhaven describes Attack versus Defend, Strike versus Counter, a card draw to decide initiative, and rewards/pranks after player combat. Digitally Downloaded describes attack/defence halves, weak field monsters versus town guardians, and being sent back after defeat. Transfer readable role labels, a visible locked card back, one clear impact and a damage consequence. Do NOT import four commands, new initiative RNG, multi-turn battle persistence, or different damage equations. Our legal commands are Attack/Strike/Secret and Defend/Counter/Secret.
3. Its opening has a small training board with an equipment/starting-money objective and a two-week in-game limit (Outerhaven). Abdallah's walkthrough transcript introduces the king explaining the adventure around 6:13 and uses one human plus one CPU. Teach by doing, not by an introductory wall of rules.
4. This is not a perfect onboarding reference. Digitally Downloaded describes roughly an hour to learn the loop and criticises long multiplayer pacing and sudden difficulty. Nintendo World Report's review discusses extensive playtime. Our practice should be much shorter, forgiving and replayable, without penalising a real save.
5. The reviewers describe colourful, cute characters and funny rivalry. Keep our M5a chibi art, not realistic rendering. “Convincing battle” means a readable causal sequence, not photorealism.
6. No accessible source gives numeric mixer gains, per-step duration, damage-number hold or HP-drain duration. The walkthrough transcript includes music markers but cannot establish balance or pleasantness. Proposed quieter defaults are an owner audition decision, not a verified soundtrack improvement.

### Sources and limits

- https://www.theouterhaven.net/2023/07/dokapon-kingdom-connect-review-destroying-friends-one-town-at-a-time/ — extracted full review; movement, tutorial opening, role/command explanation and cartoon mood.
- https://www.digitallydownloaded.net/2023/05/review-dokapon-kingdom-connect-nintendo-switch.html — extracted full review; learnability, pacing, field/town combat and humour.
- https://www.nintendoworldreport.com/review/63612/dokapon-kingdom-connect-switch-review-in-progress — extracted review; pacing corroboration, not a timing benchmark.
- https://www.youtube.com/watch?v=Huswx47CBKs — accessible transcript of Abdallah's full walkthrough; opening story/one-human-one-CPU setup, spinner, map and destination explanation. Transcript obtained through web extraction; video frames and audio were NOT inspected. Time 6:13 is transcript indexing, not a measured animation interval.
- https://www.gamegrin.com/directory/game/dokapon-kingdom-connect/feed — search excerpt only; reachable-space preview. Lower evidentiary weight than extracted reviews.

Lighter references: borrow Mario Party's general “count each traversed space” mental model and Pokémon's “command → impact → HP consequence” mental model. These are design analogies, not separately measured/reference-verified claims; neither game's rules/assets are copied.

## 2. Current game: evidence supersedes the lead's timing hypothesis

### M1: not merely too fast — skipped movement

`BoardScene.ts:280` clears `spacePositions`; `:312` adds only currently occupied spaces. `:173` silently ignores a `Moved` destination missing from this map. The seeded engine replay produced five genuine events to spaces 6, 7, 8, 9, 10, all unoccupied in the before-state. Real scene playback produced ZERO movement tweens and took 0.10 ms on phone / 0.20 ms on desktop. Thus `:183`'s authored 200 ms only applies if lookup succeeds; do not report a measured 1-second walk. The before strip deliberately shows the unchanged token five times, followed by the separately mounted authoritative endpoint; it is not a fabricated interpolated walk.

Evidence: `evidence/fixtures.json` includes `createGame` config, legal replay history, before/after states and event batch; `evidence/before.json` records destination misses and empty tween list. Before playback is scene-level isolation, not end-to-end click-to-landing latency; excludes roll overlay, bot think time, fork decisions and rendering the next view.

### M2: effects exist, but their causal beats are compressed

`battle/effects.ts:64–105` already plays attack/hurt, slash, flash, shake and a damage number. It awaits 125 ms, 90 ms, then a 260 ms number fade. `battleUi.ts:49` redraws HP HTML when the state changes; no explicit drain beat. Real replay `Jelly Bun Strike → Sir Bram Defend → 1 damage` took 511.70 ms on phone / 501.10 ms on desktop. The asynchronous puppet chain can extend beyond the awaited effect; measurement is `playEvents` completion, not all idle/puppet activity ending. The mocked result is “next exchange”, NOT a fabricated win.

HUD lane union: current 21.24% phone / 11.73% desktop; proposed 27.56% / 14.79%. This includes whitespace in the full-width top flex strip; it is NOT opaque pixel coverage. The proposal adds a persistent phase/beat label and taller cards. Coverage goes UP; the benefit verified here is no fighter/HP/command collision, not a less-covered screen. Owner may request a smaller beat label before approval.

### M3/M4

Practice entry/session does not exist on this branch; the four proposed tutorial frames are design-only. Existing tips and first-visit comic already exist and must not be replaced. Current audio defaults are music 0.5, SFX 0.8, muted false; recorded from `audio/settings.ts:9–13`, not estimated from listening. Two current tracks are CC0 placeholders per `public/audio/CREDITS.md`.

## 3. Transfer decisions

| Topic | Copy | Do better | Skip / keep our rules | Our code |
|---|---|---|---|---|
| Walk | Visible allowance and traversed-space sequence | Fix all-space lookup; 280 ms hop + 120 ms planted pause; persistent remaining count; highlight the true landing | No new RNG/destination-selection mechanic; no decrement from buggy `Moved.remaining` (first event says 5, not 4) | `BoardScene.ts`, `board/camera.ts`, new pure movement plan |
| Space event | Separate arrival from consequence | Brief 650 ms non-modal event card; never duplicate shop/fork/pass/level-up dialogs | No popup for every passed space; no auto-choice of a branch | `hud.ts`, `spaceInfo.ts`, new movement readout |
| Battle | Separate command, reveal, action and consequence | Seven timed resolution beats, larger fighters, anchored damage, tweened display HP | Keep exact legal commands, secret privacy and engine damage; result may mean next half, not victory | `BattleScene.ts`, `battle/{effects,fighters,layout}.ts`, `battleUi.ts` |
| Teaching | Small scripted human/CPU session | On-rails first pass with visible one-step instructions, replay and exit; 3–5 minute target subject to seed proof | No injected RNG, fake fight, new map, silent changes to the save | `screens.ts`, `introComic.ts`, `controller.ts`, future practice coordinator |
| Audio | Cheerful comic fantasy mood | Music 0.20 / SFX 0.60 for fresh settings; preserve saved choices; user audition before replacement | No autounmute, Dokapon music extraction, unverified “royalty free” licence, or additional track download on this card | `audio/settings.ts`, `context.ts`, `music.ts` |

## 4. Proposed audio shortlist (notes only)

A. Town Theme RPG — cynicmusic. Board candidate; asset page describes harps and recorders. Source and current CC0 grant: https://opengameart.org/content/town-theme-rpg ; licence: https://creativecommons.org/publicdomain/zero/1.0/ . Verified on extracted asset page. The author's general website permission requests do not replace this page's specific CC0 grant. Attribution still recommended: cynicmusic.com / pixelsphere.org.

B. Battle Theme A — cynicmusic. Battle candidate; asset page describes strings/horns. Source and current CC0 grant: https://opengameart.org/content/battle-theme-a ; licence: https://creativecommons.org/publicdomain/zero/1.0/ . Older comments mention CC-BY-SA, but the current page says CC0 and author comments say the licence changed. Before shipping, retain a dated capture of the current grant, hash actual source bytes and record processing.

C. Monkeys Spinning Monkeys — Kevin MacLeod. Lighter board alternative; flute/pizzicato mood described in the archived artist listing. Source: https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1400011 ; archived artist grant: https://web.archive.org/web/20250813194356/https:/incompetech.com/music/royalty-free?isrc=USUAN1400011 ; licence: https://creativecommons.org/licenses/by/3.0/ . Current artist page extracted only a JavaScript loading shell, so this is PROVISIONAL, not shipping-cleared. Artist attribution, track title, licence link and modification notice required. Prefer A/B if live grant cannot be confirmed.

No candidate was downloaded, auditioned or loudness-tested; pleasantness and loop quality remain owner listening checks. Existing encoder target in CREDITS is -18 LUFS, -2 dBTP; retain initially, inspect the chosen source's actual loudness and seam before encoding. Slider 0.20 is a linear mixer gain, not “20% perceived loudness”. Replacement must fit existing per-file 1,500,000-byte and total 4,000,000-byte gates without increasing them.

## 5. Owner approval packet

Open `gallery.html`; paired before/after images at 915×412 TH and 1280×720 EN, walk strips, seven battle beats, four practice frames and silent sound settings mockup. `previews/walk-915x412-th.webm` and `battle-915x412-th.webm` show the proposed timing. These are independent HTML design specimens; their assets are crops from existing art. No new art requested in the default proposal. Reduced-motion/product networking are specified in BRIEF, not validated by these motion demos.

Decisions requested: approve overall layouts/art reuse; approve local human timings (400 ms step, 2,220 ms battle resolution); accept the HUD coverage tradeoff or ask to compact labels; choose/decline tracks after listening; approve fresh-install audio gains; approve on-rails practice with escape/replay; confirm that seed feasibility comes before promising a complete 3–5 minute preset route.
