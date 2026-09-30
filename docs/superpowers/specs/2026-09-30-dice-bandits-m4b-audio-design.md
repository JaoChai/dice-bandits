# Dice Bandits — M4b Audio — Design

Status: draft for owner review · Date: 2026-09-30 · Milestone: M4b (audio). Follows M4a (visuals, live).

## 1. Goal

Give the live game sound: short 8-bit sound effects on the moments that matter, one board
music loop and one battle music loop, with player controls for mute and volume. Audio must
never block, slow down or break the game.

Owner decisions (2026-09-30 brainstorm):

| # | Decision |
|---|---|
| 1 | Scope **B**: SFX + **2 music loops** (board theme, battle theme). No per-region music. |
| 2 | Source **A**: SFX are **synthesised by a script in this repo**; music is **CC0** tracks from a verified shortlist (§4.2). No CC-BY, no "free to use" licences. |
| 3 | SFX set **A**: the **12 core sounds** in §4.1. |
| 4 | Settings **A**: HUD mute button + separate **music** and **SFX** volume sliders, persisted on the device. |
| 5 | Engine **A**: a standalone `audio/` module on the **Web Audio API**; no Phaser sound, no new dependency. |

## 2. Scope

In scope:
- `apps/client/src/audio/` module: context, settings, SFX player, music player, event mapping.
- 12 generated SFX files, 2 music files, a generator script, a credits file.
- HUD mute button, title-screen "Sound settings" dialog with two sliders, TH/EN strings.
- Unit tests, E2E tests, asset-size budget test.

Out of scope: any rule, balance, engine, room, worker or protocol change; voice acting;
per-region music; accounts (M3); new game screens or modes.

## 3. Constraints kept from M1–M4a

- `packages/*`, `apps/client/worker` and `tests/worker` are untouched
  (`git diff origin/main -- packages apps/client/worker tests/worker` stays empty).
- Every existing `data-testid` keeps its name and meaning; new elements get new ids.
- **Audio is fire-and-forget.** No game code awaits an audio promise. PR #10 showed that
  awaiting something which can stay pending freezes the bot chain; audio calls return `void`.
- i18n: every new visible string exists in `en.json` and `th.json`; Thai must fit.
- No third-party CDN; all audio files are served from `apps/client/public/audio/`.
- `?speed=0` (test hook) does not change audio: because audio is fire-and-forget it cannot
  change E2E timing, and E2E needs playback calls to happen so it can assert them (§6).
- `prefers-reduced-motion` does not change audio.

## 4. Assets

### 4.1 Sound effects (12, generated)

`tools/sfx` (a new workspace, like `tools/pixelize`) synthesises each sound in pure
TypeScript from a small parameter table (wave, pitch sweep, duration, volume) and writes
16-bit mono 22.05 kHz WAV files to `apps/client/public/audio/sfx/<id>.wav`. WAV decodes in
every browser including Safari, needs no encoder (no ffmpeg in CI), and the generator is
byte-for-byte deterministic, so tweaks are one-line table edits. 12 sounds ≈ 4 s ≈ 180 KB.

| id | Sound | Triggered by (engine `GameEvent.type` / UI) |
|---|---|---|
| `click` | UI tick | any enabled `button` press (delegated listener) |
| `dice` | rattle | `DiceRolled` |
| `step` | soft hop | `Moved` (once per event, not per tile) |
| `battleStart` | rising sting | `BattleStarted` |
| `hit` | punch | `DamageDealt` |
| `ko` | falling crash | `PlayerKO` |
| `coin` | coin chime | `GoldGained`, `BountyClaimed` |
| `stolen` | descending blip | `GoldStolen` |
| `levelUp` | arpeggio up | `LevelUp` |
| `item` | pop | `ItemBought`, `ItemUsed` |
| `town` | bell | `TownClaimed`, `TownFlipped` |
| `win` | fanfare | `GameEnded` |

Unmapped event types play nothing.

### 4.2 Music (2, CC0)

**Chosen (owner approved 2026-09-30):** board = **board-2 "The Arplands"**, battle =
**battle-1 "8bit Action Boss Battle"**. Chosen after a listening review by Gemini 3.8 Flash
(OpenRouter) of each full track and of each loop seam (last 4 s + first 4 s): both scored
9/10 with a seamless seam. The full shortlist is kept below for the record. Every page was
fetched and shows **CC0** as its only licence (checked 2026-09-30).

| Slot | Title | Author | Page | Length | MP3 size |
|---|---|---|---|---:|---:|
| board-1 | Flowerbed Fields [Loop] | Zane Little Music | https://opengameart.org/content/flowerbed-fields-loop | 105.9 s | 1.27 MB |
| **board-2** ✅ | The Arplands | LordZintick | https://opengameart.org/content/the-arplands | 144.0 s | 1.44 MB |
| board-3 | Chiptune: Exploration | ansimuz | https://opengameart.org/content/chiptune-exploration | 44.3 s | 0.53 MB |
| **battle-1** ✅ | 8bit Action Boss Battle | MintoDog | https://opengameart.org/content/8bit-action-boss-battle | 62.9 s | 0.76 MB |
| battle-2 | Rin's Theme (Loopable chiptune) | request | https://opengameart.org/content/rins-theme-loopable-chiptune-adventurebattle-bgm | 129.6 s | 1.30 MB |
| battle-3 | 8-Bit Bluesy Battle Theme | emanresU | https://opengameart.org/content/8-bit-bluesy-battle-theme | 38.3 s | 0.46 MB |

Source files: `https://opengameart.org/sites/default/files/the_arplands_0.ogg` and
`https://opengameart.org/sites/default/files/8bit_action_boss_battle_bpm145_0.ogg`.

**Loudness match.** Measured mean volume: board-2 −18.0 dB, battle-1 −11.8 dB, so battle
would jump ~6 dB louder. Both tracks are normalised with
`ffmpeg -af loudnorm=I=-18:TP=-2:LRA=11 -ar 44100` before encoding (measured result:
−17.0 and −17.9 LUFS integrated).

**Encoding.** `apps/client/public/audio/music/{board,battle}.ogg` (libvorbis `-q:a 2`) plus
`.mp3` fallback (libmp3lame 64 kb/s). Measured sizes: board 1.34 MB OGG / 1.15 MB MP3,
battle 0.58 MB OGG / 0.50 MB MP3. Loops use the decoded `AudioBuffer` with `loop = true`;
OGG is preferred because MP3 encoder padding can cause an audible gap.
`apps/client/public/audio/CREDITS.md` records title, author, page URL, download URL, licence,
retrieval date and the normalisation command for each track.

### 4.3 Budgets

- All SFX files together ≤ **300 KB**.
- Each music file ≤ **1.5 MB**; total `public/audio` (both formats) ≤ **4 MB**. A player
  downloads only one format (chosen by `canPlayType`), about 1.9 MB of music at most.
- Enforced by a unit test and `scripts/check-audio-budget.mjs`, like the sprite budget.
- Music loads **lazily after the first user gesture**, so the title screen is not slower.

## 5. Runtime design

### 5.1 Units

| File | Responsibility | Depends on |
|---|---|---|
| `audio/settings.ts` | `{ muted, music, sfx }` load/save in `localStorage` key `diceBandits.audio`; defaults `{ false, 0.5, 0.8 }`; invalid or unavailable storage → defaults | — |
| `audio/context.ts` | Creates one `AudioContext` lazily; `unlock()` on the first `pointerdown`/`keydown`; master/music/sfx `GainNode`s; returns `null` when Web Audio is missing | settings |
| `audio/sfx.ts` | Decodes SFX buffers once; `playSfx(id)`; throttles the same id within **80 ms**; max **6** simultaneous voices | context |
| `audio/music.ts` | `setMusic('board' \| 'battle' \| 'none')`; 500 ms cross-fade; pauses on `visibilitychange` hidden, resumes on visible | context |
| `audio/events.ts` | Pure `sfxForEvents(events: GameEvent[]): SfxId[]` (dedupes within one batch) and `musicForState(state): 'board' \| 'battle'` | engine types only |
| `audio/index.ts` | Public API: `initAudio()`, `onGameEvents(events, state)`, `playSfx`, `setMusic`, `getAudioSettings`, `setAudioSettings` | all above |

`musicForState` returns `battle` when `state.phase.kind === 'battle'`, `board` otherwise, and
the title/setup/lobby screens call `setMusic('board')` directly. `gameOver` keeps the board
theme after the `win` sting.

### 5.2 Wiring (client only)

- `main.ts`: call `initAudio()` once at start-up.
- Both `onEvents` handlers in `main.ts` (online ≈ line 86, hot-seat ≈ line 248) call
  `onGameEvents(events, nextState)` **before** `animateThenRender`, without `await`.
- Clicks: one delegated `click` listener on the app root plays `click` for enabled buttons.
- HUD (`ui/hud.ts`): a speaker button `data-testid="audio-toggle"` with
  `aria-pressed` = muted, label from i18n.
- Title (`ui/screens.ts`): a "Sound settings" button `data-testid="audio-settings"` opening a
  dialog with two range inputs `data-testid="audio-music-volume"` / `"audio-sfx-volume"`
  (0–100) and the mute checkbox; changes apply immediately and persist.

### 5.3 Failure handling

- No `AudioContext` → every API call is a no-op; the game plays silently.
- File fetch/decode failure → that sound or track is skipped; one `console.warn('[audio] …')`
  per file, never `console.error`, never an uncaught rejection.
- Autoplay blocked → nothing plays until the first gesture; no error.
- All audio promises are caught inside the module; exported functions return `void`.

## 6. Testing and acceptance

Unit (Vitest, `apps/client/test/audio/`):
- `sfxForEvents` maps each row of §4.1, ignores unmapped types, dedupes within a batch.
- `musicForState` for `battle`, board phases and `gameOver`.
- Throttle: same id twice within 80 ms plays once; voice cap holds at 6.
- Settings: defaults, round-trip, invalid JSON, throwing `localStorage`.
- Mute: master gain goes to 0; unmute restores the saved volumes.
- No Web Audio (`AudioContext` undefined): all APIs are no-ops and do not throw.
- Budget: SFX total ≤ 300 KB, each music file ≤ 1.5 MB, total ≤ 4 MB.
- Generator: synthesising the table twice produces identical WAV bytes.

E2E (Playwright, existing suites unchanged and passing):
- `audio-toggle` visible on the board; toggling flips `aria-pressed`; state survives reload.
- Sound settings dialog: slider values persist across reload.
- A full hot-seat game with audio enabled reaches results with 0 console errors.
- With `VITE_TEST_HOOKS=1` the audio module appends each started SFX id to
  `window.__audioLog` (compiled out of production builds and checked like `__db`); the E2E
  game asserts it contains at least `dice` and `hit`.
- Every `/audio/` response in the E2E run is 200 with an `audio/*` content type (the SPA
  fallback would otherwise return HTML for a missing file).

Live acceptance after deploy:
- 3 games of 1 human + 3 bots at normal speed reach results, 0 stalls, 0 console errors.
- Two-browser online game, ≥ 5 actions each side, 0 console errors.
- Owner listens to the 12 SFX and 2 chosen tracks (sent in Telegram) before merge.

Automated tests prove *which* sound is triggered and *when*; they cannot judge how it sounds.
That judgement is the owner's listening step.

## 7. Risks

- **Audio freezes the game** → fire-and-forget rule (§3), unit test that `onGameEvents`
  returns `undefined`, plus the live 1-human/3-bot stall probe.
- **Noise during fast bot play** → 80 ms throttle, per-batch dedupe, 6-voice cap.
- **Loop gap** → loop from decoded OGG buffers; owner listens to the seam.
- **Mobile Safari** → unlock on first gesture; if OGG is not playable the MP3 music fallback
  is chosen by `canPlayType`; SFX are WAV, which every browser decodes.
- **Licence drift** → CREDITS.md stores the page URL and retrieval date for each track.
