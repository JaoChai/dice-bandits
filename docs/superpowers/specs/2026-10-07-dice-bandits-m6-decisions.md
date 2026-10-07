# M6 · Owner/Lead decisions (binding for R1–R3)

The owner (Marci) reviewed the M6 study, gallery, and walk/battle previews and approved option **"A"** on 2026-10-07 (recommended plan, three releases). This approval settles every "owner decision" in the brief (`docs/superpowers/plans/2026-10-07-dice-bandits-m6-brief.md`). Where this file and the brief disagree, THIS FILE wins.

## Resolved decisions
- **Visual direction:** M1 walk, M2 battle, M3 practice and M4 sound mockups are APPROVED. Reuse existing art only, with no new art.
- **Timings:** APPROVED as proposed.
  - Local human walk: 280 ms hop + 120 ms pause per space, 180 ms landing highlight, 650 ms non-modal arrival card.
  - Bot walk: 120 ms + 40 ms per space, 250 ms landing.
  - Online: 0 ms added awaited time. The detached ghost walk is capped at 600 ms.
  - Battle: seven beats totalling 2,220 ms for local humans, ≤ 600 ms for bots, and non-awaited for online.
  - Reduced motion / speed 0: static, no waits.
- **HUD coverage tradeoff:** ACCEPTED. The battle HUD lane may rise to about 28% on phone, provided the fighter, HP, command row and top controls never collide.
- **Audio defaults:** APPROVED. Fresh installs get music 0.20 and SFX 0.60. Saved player settings are preserved, with no migration and no new key.
- **Music replacement (R1-E):** NOT approved yet. It waits for the owner's listening choice, so do not touch `public/audio/**`.
- **Practice:** APPROVED on rails, with Exit and Replay always available. Prove seed feasibility (R3-A) before any practice UI. If it is infeasible, block and return the owner choice. Never silently build a different tutorial.

## Release split (Lead)
- **R1** = R1-A (all destinations animate) + R1-B (quieter defaults) + R1-C (non-gating online presentation) + R1-D (countable local walk + arrival card). They ship together in ONE PR, because R1-A must not ship without R1-C.
- **R2** = battle. **R3** = practice. They get new branches after R1 is live.

## Known source facts (Lead-verified on 6784c4b)
- `BoardScene.ts:280` clears `spacePositions`, and `:312` stores only occupied spaces. Line `:173` therefore skips every `Moved` destination that is not occupied, so tokens teleport instead of walking. This is the R1-A root cause.
- `audio/settings.ts:9-13` defaults are music 0.5 and SFX 0.8.
- `main.ts:176-225` is the ONLINE controller (`new OnlineController`, `onEvents` at :179) and `:386-437` is the LOCAL controller (`new GameController`, `onEvents` at :389). Both await `scene.playEvents(events)` inside `Promise.all` (:204 online, :412 local). R1-C changes only the online seam, and R1-D changes local playback.

## Reference (read-only, never copy into the product)
`/home/jaochai/Code/dice-bandits/.worktrees/m6-arch/m6/` contains `gallery.html`, `prototype.html`, `shots/*.png`, `previews/*.webm`, `measure.json`, `evidence/{fixtures,before}.json`, `fixtures.ts`, `STUDY.md` and `RESULTS.md`.
