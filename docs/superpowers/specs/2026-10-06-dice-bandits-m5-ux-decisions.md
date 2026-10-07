# M5-UX · Owner/Lead decisions (binding for U1–U3)

Owner (เจ้านาย) approved the mockup direction and all four open points with "A" on 2026-10-06.
These decisions resolve every "requires owner approval" item in the brief
(`docs/superpowers/plans/2026-10-06-dice-bandits-m5-ux-brief.md`). Where this file and the brief differ, THIS FILE wins.

## Resolved decisions
- **D1 dice faces — APPROVED as recommended.** One real pip face only when `dice === 1` and `1 <= value <= sides <= 6`. Otherwise show the count/sides label plus the authoritative total (e.g. `2 × d6 · ทอยได้ 9`). Never invent per-die faces, never call RNG, never touch the engine.
- **D2 timing — APPROVED bounded policy.** Local human roll: 900 ms tumble + 1400 ms readable result, then the existing token movement. Bot rolls and online rolls: zero added awaited time. Lead addition: in bot/online mode still show the result visually, as a non-blocking result badge (no tumble) that the next HUD render may replace, plus the persistent "ทอยได้ N" chip. Reduced motion / speed 0: no tumble, no hold, result shown statically.
- **Right rail + seat details — APPROVED.** Compact phone summaries show name + gold (+ explicit takeover indicator). Every other field (level, towns, HP/max, bandit cards, takeover/reclaim) opens in an accessible detail panel. Battle HP/takeover layout from PR #39 is unchanged.
- **Open-shop coverage exemption — APPROVED.** The shop/level-up/reward dialog may cover ~43% of the phone screen while open. The ordinary board HUD target stays ≤ 22% at 915×412 with zero HUD/HUD overlaps.
- **Dicey roll tip copy — Lead picks the shared truthful copy** (tips also appear in online games, where there is no hold): TH `แตะปุ่มทอยเต๋าเพื่อดูแต้มที่ได้`, EN `Tap Roll to see your dice total.`

## Mockup defects that the build MUST fix (owner was told these are mockup-only)
1. No leftover old HUD anywhere: the old corner cards, old map pill and old bottom tray must be fully replaced, not layered under the new surfaces (U2a + U3 e2e must assert no second copy of any status/seat/tray surface is visible).
2. Shop/level-up list: every legal choice is reachable (scrollable list, `Leave` pinned), no half-clipped row at 915×412 or 932×388. Keep the existing button label text (do not invent prices that the current label does not show).
3. The standalone audio toggle and the event message (e.g. "ตลาดมืดเปิดแล้ว") stay visible in the new top bar.
4. The busy/disabled tray state ("รอสักครู่…", "เลือกของในร้าน") uses the existing theme tokens (cocoa outline, cream/panel fill), not a bare white box.

## Visual reference
Approved mockups (read-only, do not copy into the product): `/home/jaochai/Code/dice-bandits/.worktrees/ux-arch/mockup/shots/after-915-{A..E}.png`, `after-1280-{A..E}.png`, before shots `before-*.png`, measurements `mockup/measure.json`. The prototype CSS `mockup/mockup.css` documents the lane sizes.
