# Dice Bandits — M2 Online Rooms Design

- Date: 2026-09-28
- Status: Draft for owner review
- Owner: Marci · Planner/lead: Monday (Sol) · Implementation: Luna (Worker subagents)
- Builds on: `2026-09-27-dice-bandits-m1-design.md` (M1 live at
  `https://dice-bandits.anugooltippon.workers.dev`, `main` @ `0d443a8`)

## 1. Goal

Friends play one game together **from their own devices** using a short room code.
M2 proves remote play works: create/join, lobby, play, idle/disconnect takeover by a
bot, reclaim, and 24 h resume. The M1 hot-seat mode stays exactly as it is.

## 2. Owner decisions (brainstorm, 28 Sep)

| # | Decision |
|---|---|
| 1 | One player per device. Host creates a room and gets a short code; empty seats become bots. |
| 2 | A seat whose player is disconnected **or** idle on their turn for > 60 s is taken over by a bot until that player comes back and reclaims it. The game never pauses. |
| 3 | Lobby: host presses Start at any time; empty seats become bots. Everyone picks their own class and sees who has joined. |
| 4 | Same browser reclaims its seat automatically. A different device enters the code and picks its own name from the bot-held human seats (accepted risk: anyone with the code can claim such a seat; rooms are friends-only). |
| 5 | A room is kept for 24 h after the last activity, resumable with the same code; then deleted. |
| 6 | Authoritative server: one Durable Object per room runs the existing engine. |

## 3. Scope

### In scope
- Online mode entry on the title screen: **Create room** / **Join with code**.
- Room lifecycle: lobby → playing → finished; 24 h expiry.
- Server-side engine (`step`, `legalActions`, `chooseAction`), server-side bots.
- Per-seat redacted views (hidden battle picks, no RNG leakage).
- Idle/disconnect takeover, reclaim, cross-device claim.
- Thai + English strings for every new screen/message.

### Out of scope (explicit)
Accounts, match history, unlocks (M3) · matchmaking with strangers · chat ·
spectators · joining a game already in progress as a *new* player · room-creation
rate limiting · art/animation/audio changes (M4) · changing game rules or balance.

## 4. Architecture

```
dice-bandits/
  packages/engine/   unchanged rules (pure TS)
  packages/room/     NEW — pure room logic: seats, lobby, takeover, redaction,
                     protocol types. No Cloudflare APIs. Unit-tested with Vitest 5.
  apps/client/
    worker/index.ts  Worker entry: /api/health (existing), /api/rooms (new),
                     /api/rooms/:code/ws (new) → Room Durable Object
    worker/room-do.ts  NEW — thin Durable Object shell around packages/room
    src/online/      NEW — WebSocket client, online controller, lobby UI
  tests/worker/      NEW — Durable Object integration tests (see §9)
```

- **Room Durable Object** (`Room`, SQLite-backed, `new_sqlite_classes` migration).
  One instance per room code via `idFromName(code)`. It owns the room record and the
  `GameState`, validates every action with `legalActions`, runs `step`, runs bots with
  `chooseAction`, and pushes results over WebSockets.
- **Pure room core** (`packages/room`): a deterministic reducer
  `roomStep(room, input, now) → { room, outbound[], nextAlarmAt }` where `input` is a
  client message, a connect/disconnect, or an alarm tick. The DO shell only does I/O
  (storage, sockets, alarms). This keeps almost all logic testable without Workers.
- **WebSockets:** Hibernation API (`ctx.acceptWebSocket`); each socket carries a
  serialized attachment `{ seat }` so the DO can restore routing after hibernation.
- **Persistence:** after every accepted input the DO writes the room record (one JSON
  row: seats, token hashes, lobby state, `GameState`, `lastActivityAt`, deadlines) to
  its SQLite storage. Nothing is kept only in memory.
- **Alarms:** one alarm at a time, set to the earliest pending deadline
  (idle takeover, disconnect takeover, 24 h expiry). The alarm handler recomputes and
  re-arms.
- **Client online mode** reuses the M1 board, battle scene, HUD and dialogs. An
  `OnlineController` replaces `GameController` for online games: it sends actions and
  renders server views/events instead of calling `step` locally. Hot-seat code paths
  are untouched.
- **Deploy:** same Worker `dice-bandits`, same GitHub Actions pipeline (checks → deploy
  on push to `main`). Wrangler gains `durable_objects.bindings` (`ROOM` → `Room`) and a
  `migrations` entry. Durable Objects on SQLite are available on the Workers Free plan.

## 5. Room model

- **Code:** 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0 O 1 I L`).
  The Worker generates it; on collision (room already exists) it retries up to 5 times.
- **Seats:** up to 4. Each seat: `name` (1–16 chars, trimmed), `classId`,
  `kind: 'human' | 'bot'`, `controller: 'player' | 'botTakeover' | 'bot'`,
  `connected`, `tokenHash | null`, `idleSince | null`.
  - `kind: 'bot'` = a seat filled by a bot at Start; never claimable.
  - `controller: 'botTakeover'` = a human seat currently played by a bot.
- **Host:** seat 0 at creation. In the lobby, a seat disconnected > 60 s is removed
  (freeing the slot); if it was the host, host passes to the lowest remaining seat;
  if no seats remain the room is deleted.
- **Start:** fills every free slot up to 4 seats with bots (unused classes first,
  personalities cycling greedy → vengeful → cowardly).
- **Invite link:** `/r/<CODE>` opens the join/rejoin flow for that code; with a stored
  token it reconnects with no clicks. The title screen also shows "Back to room CODE"
  when a stored session exists.
- **Cross-device claim** is possible only for a human seat currently under bot
  takeover (so at most 60 s after the original device dropped).
- **Seat token:** 128-bit random, returned once to the client; only its SHA-256 hash
  is stored. The client keeps `{ code, seat, token }` in `localStorage`
  (key `dice-bandits:room:<code>`). A new-device claim issues a new token and
  invalidates the old one.
- **States:** `lobby` → `playing` → `finished`. Joining as a new player is allowed only
  in `lobby` and only while a seat is free ("room full" otherwise).

## 6. Protocol

All messages are JSON with a `type`; protocol version `v: 1` on the hello message.
Client messages larger than 4 KB or with an unknown `type` are rejected.

**HTTP**
- `POST /api/rooms` `{ name }` → `{ code, seat: 0, token }`
- `GET /api/rooms/:code/ws?token=…` → WebSocket upgrade (reconnect / same browser)
- `GET /api/rooms/:code/ws` (no token) → WebSocket upgrade as a *visitor*, who may then
  send `join` (lobby) or `claim` (game in progress).

**Client → server**
- `join { name }` · `claim { seat }` · `setClass { classId }` · `start` (host only)
- `action { action, turn }` — `action` is an engine `Action`; `turn` is the view
  sequence number the client acted on (stale actions are rejected).
- `reclaim` — "I'm back": ends a bot takeover of my own seat.

**Server → client**
- `welcome { seat, token? }` (token only when newly issued)
- `lobby { seats, host, code }`
- `view { turn, state, you, legal, seats }` — per-seat redacted view (§7) plus
  `legal`: the engine legal actions for this seat right now (empty when not acting).
- `events { turn, events }` — engine events in order, for animation.
- `error { key }` — i18n key (e.g. `online.error.roomFull`, `online.error.notFound`,
  `online.error.staleAction`), followed by a fresh `view`.

## 7. Redaction (per seat)

Before any `view` is sent, the server derives it from `GameState`:
- **Battle picks:** the opponent side's pending pick is replaced by `null`, and a
  boolean `opponentPicked` is added. Picks become visible only through the
  events emitted after both sides picked (resolution of that half-exchange).
- **Secret flag:** the engine sets `secretUsed = true` at pick time. When a hidden
  opponent pick is `secret`, the view also shows that combatant's `secretUsed` as
  `false` (a secret can only be used once, so the pre-pick value was `false`).
- **Events:** the engine emits `BattlePick` with the pick value as soon as a side picks
  (`packages/engine/src/rules/battle.ts` ~266). For every role whose pick is still
  pending after the input, the last `BattlePick` event of that role has its `pick`
  param replaced by `'hidden'` for every viewer except the picking seat.
- **RNG:** `state.rng` is replaced by `[0, 0, 0, 0]` and `state.config.seed` by `''`
  (they would let a client predict dice rolls and bot choices). The view keeps the
  `GameState` shape so M1 renderers work unchanged.
- The client never computes legality from a redacted view; it uses `legal` from the
  server. Online games show no "pass the device" screen.

## 8. Flows and timers

1. **Create:** `POST /api/rooms` → code + token → WebSocket → lobby.
2. **Join:** visitor socket → `join { name }` → next free seat + token → lobby.
3. **Lobby:** `setClass` updates are broadcast. Host `start` → empty seats become bots
   (`kind: 'bot'`), engine `createGame` runs with a server-generated seed.
4. **Play:** human `action` → validate (`turn`, seat, `legalActions`) → `step` →
   persist → broadcast `events` + per-seat `view`. Then the server runs bot seats
   (including takeovers) **immediately**, until a player-controlled seat must act or
   the game is over. Bot steps run in batches of at most 200 per input; if more bot
   work remains (e.g. every human is under takeover), the DO persists, broadcasts and
   re-arms its alarm for "now" to continue. The client paces animations; bots have no
   server-side "thinking" delay.
5. **Idle takeover:** when a player-controlled seat has a non-empty `legal` list, its
   idle deadline is `now + 60 s`. At the deadline the seat switches to
   `botTakeover` and the bot plays on. The player's screen shows
   "A bot is playing for you — tap to take back" (`reclaim`).
6. **Disconnect takeover:** when a seat's last socket closes, its deadline is
   `now + 60 s` regardless of turn. Reconnecting before the deadline cancels it.
7. **Reclaim:** same browser reconnects with its token → seat returns to `player`
   control. New device: visitor sends `claim { seat }` for a human seat under
   `botTakeover` → new token issued, old token invalid.
8. **Expiry:** every accepted input sets `lastActivityAt`; expiry = +24 h. At expiry the
   DO closes sockets and deletes all storage. A later connect to that code gets
   `online.error.notFound`.
9. **Finish:** on `gameOver` everyone sees the M1 results screen; the room stays
   `finished` until expiry (no rematch in M2).

Timers are configurable only for tests: the Worker reads optional `ROOM_IDLE_MS` and
`ROOM_TTL_MS` vars (defaults 60 000 and 86 400 000). Production config sets neither.

## 9. Error handling

- **Transient disconnect:** client reconnects automatically with backoff
  1 s, 2 s, 4 s, 8 s, then every 10 s, showing "Reconnecting…". After reconnect it
  receives a fresh `view` (no replay of missed events).
- **Invalid/stale action:** `error { key }` + fresh `view`; state unchanged.
- **Engine throws:** the input is rejected, state is not persisted, the error is
  logged (`console.error` with room code, seat, phase kind), and the room keeps the
  previous state.
- **DO restart/eviction or deploy:** state and deadlines live in storage; clients
  reconnect via backoff.
- **Input limits:** name 1–16 chars, ≤ 4 seats, message ≤ 4 KB, unknown types rejected.

## 10. Testing

1. **`packages/room` unit tests (Vitest 5):** join/full, class pick, host transfer,
   start with bot fill, action validation (wrong seat, stale `turn`, illegal action),
   bot chain after a human action, idle and disconnect takeover, reclaim, cross-device
   claim invalidates old token, expiry, alarm = earliest deadline.
2. **Redaction test:** for full bot-driven games, every `view` and `events` message sent
   to every seat is checked: no opponent pending pick (state or `BattlePick` event)
   before both picks are in, no leaked `secretUsed`, no real `rng`, no `seed`.
3. **Durable Object integration (`tests/worker`):** the Workers Vitest integration
   (`@cloudflare/vitest-plugin` `1.3.0`, or the older `@cloudflare/vitest-pool-workers`
   `0.22.0`; task 1 picks one after checking current docs) requires **Vitest ^4.1.0**, while the repo pins **Vitest 5.0.2**. So DO
   tests live in their own workspace package pinned to Vitest `4.1.11` + the plugin,
   pointing at `apps/client/wrangler.jsonc`. Covers WebSocket
   connect/reconnect, persistence across `evictDurableObject`, and
   `runDurableObjectAlarm` for takeover/expiry. Plan task 1 proves this setup; if it
   cannot work, fall back to testing the DO through `wrangler dev` with a Node
   WebSocket client and record the reason.
4. **Simulation:** run N full games through `roomStep` with all-bot rooms; 0 crashes,
   0 stuck (added to the existing `npm run sim` gate or a sibling command).
5. **E2E (Playwright, two browser contexts):** create/join, class pick, start, several
   turns each, a hidden battle pick not visible on the other page before reveal, one
   context goes offline → bot takes over (`ROOM_IDLE_MS` shortened) → back online →
   reclaim; new-context claim; unknown code error; TH/EN. Hot-seat E2E stays green.
6. **CI:** all of the above run in the `checks` job before deploy.
7. **Post-deploy:** controller plays a two-browser game on the live URL.

## 11. Documentation basis (checked 2026-09-28)

- Cloudflare docs (cloudflare-docs MCP): SQLite-backed Durable Objects are recommended
  and are the only kind on the Workers Free plan (`new_sqlite_classes` migration);
  Hibernation WebSocket API with `serializeAttachment`/`deserializeAttachment`;
  each `setAlarm()` is billed as one row written; `runDurableObjectAlarm`,
  `runInDurableObject`, `evictDurableObject` (pool-workers ≥ 0.16.20) for tests;
  WebSocket message limit 32 MiB.
- npm: `@cloudflare/vitest-plugin@1.3.0` and `@cloudflare/vitest-pool-workers@0.22.0`
  both peer `vitest ^4.1.0`; latest
  Vitest 4 = `4.1.11`. Repo: Vitest `5.0.2`, Wrangler `4.141.0`,
  `@cloudflare/vite-plugin` `1.60.2`, Phaser `4.2.1`.
- Implementation tasks must re-check any Durable Object / Wrangler API against current
  docs before use.

## 12. Risks

- **Vitest version split** for DO tests → isolated test package; fallback in §10.3.
- **Bot takeover race** (the M1 live error came from client-side bot timing) → bots run
  only on the server, synchronously after each input, inside the DO's single-threaded
  input gate.
- **Anyone with the code can claim a bot-held human seat** → accepted (decision 4).
- **Free-plan limits** → rooms are small (one JSON row, few writes per turn); expiry
  deletes storage.
