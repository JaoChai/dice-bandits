# Dice Bandits M2 (Online Rooms) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `subagent-driven-development` (or
> `executing-plans`) to implement this plan task by task. Steps use `- [ ]` checkboxes.

**Goal:** Friends play one Dice Bandits game from their own devices via a 5-letter room
code, with bot takeover for idle/disconnected seats, reclaim, and 24 h resume.

**Architecture:** A pure `packages/room` reducer holds all room rules (lobby, seats,
tokens, action validation, bot chain, takeover deadlines, per-seat redaction) and is
unit-tested without Cloudflare. A thin SQLite-backed Durable Object `Room` in the
existing Worker does I/O only (storage, hibernatable WebSockets, one alarm). The client
adds an online mode that renders server views with the M1 board/battle/HUD.

**Tech stack:** TypeScript, existing `@dice-bandits/engine`, Cloudflare Workers +
Durable Objects (SQLite), Vitest 5 (repo) + Vitest 4 (Workers test package only),
Playwright, Phaser 4 (unchanged).

**Spec:** `docs/superpowers/specs/2026-09-28-dice-bandits-m2-online-design.md`
(owner-approved 2026-09-28). Branch: `feat/m2-online` from `main` @ `0d443a8`.

## Global rules for every task

- TDD: failing test first, watch it fail, implement, watch it pass.
- **Gate before every commit:** `npm run typecheck && npm run lint && npm run
format:check && npm test && npm run sim -- --games 200 --players 4 && npm run build`
  and, from Task 11 on, `npm run e2e`. Task 1 adds `npm run test:worker` to the gate.
- Do not change engine rules or balance. Engine changes are allowed only where a task
  says so.
- Hot-seat mode must behave exactly as in M1 (its unit + E2E tests stay green,
  unchanged).
- Commit locally on `feat/m2-online`. **No push, no deploy, no Cloudflare changes**
  (controller does those). Leave no temp files in the repo (use `$TMPDIR`).
- Re-check Cloudflare APIs against current docs (cloudflare-docs MCP or
  developers.cloudflare.com) before using them; record the doc URL in the report.
- Report: commit SHA, gate counts, files changed, concerns.

## File map

```
packages/room/                 NEW workspace @dice-bandits/room (pure TS, Vitest 5)
  src/protocol.ts              client/server message types + parse/validate
  src/model.ts                 Room, Seat types, createRoom, constants
  src/lobby.ts                 join / setClass / start / lobby disconnect
  src/play.ts                  action validation, step, bot chain
  src/timers.ts                idle/disconnect takeover, reclaim, claim, expiry, nextAlarmAt
  src/redact.ts                per-seat view + event redaction
  src/roomStep.ts              roomStep(room, input, now) entry point
  src/sim.ts                   all-bot room simulation CLI
  test/*.test.ts
apps/client/worker/index.ts    + /api/rooms routes, export Room
apps/client/worker/room-do.ts  NEW Durable Object shell
apps/client/wrangler.jsonc     + durable_objects binding ROOM, migrations v1
tests/worker/                  NEW workspace (Vitest 4 + Workers Vitest integration)
apps/client/src/online/        NEW socket.ts, session.ts, onlineController.ts,
                               screens.ts (create/join/lobby/claim)
apps/client/src/main.ts, ui/*  minimal hooks for online mode
apps/client/e2e/online.spec.ts NEW two-context journey
```

---

### Task 1: Workers test harness + Durable Object skeleton (de-risk first)

**Files:** Create `tests/worker/{package.json,vitest.config.ts,tsconfig.json,test/room-do.test.ts}`,
`apps/client/worker/room-do.ts`; Modify `apps/client/wrangler.jsonc`,
`apps/client/worker/index.ts`, root `package.json` (workspace + `test:worker` script),
`.github/workflows/ci.yml` (run `npm run test:worker` in `checks`),
`apps/client/worker-configuration.d.ts` (regenerate with `wrangler types`).

**Interfaces:**

- `wrangler.jsonc`: `durable_objects.bindings: [{ name: "ROOM", class_name: "Room" }]`,
  `migrations: [{ tag: "v1", new_sqlite_classes: ["Room"] }]`. Keep D1 + assets as is.
- `Room` skeleton: `fetch` accepts a WebSocket upgrade via `ctx.acceptWebSocket(server)`;
  `webSocketMessage` echoes `{ type: 'echo', data }`; stores a counter in
  `ctx.storage` to prove persistence; `alarm()` writes `alarmFired = true`.
- Worker: `GET /api/rooms/_probe/ws` → `env.ROOM.getByName('_probe')` (or
  `idFromName`+`get`, whichever current docs recommend) `.fetch(request)`. The probe
  route is removed in Task 7.
- `tests/worker`: Vitest `4.1.11` + the Workers Vitest integration. Check current docs
  and pick **one** of `@cloudflare/vitest-plugin` (`1.3.0`, newer) or
  `@cloudflare/vitest-pool-workers` (`0.22.0`); both peer `vitest ^4.1.0`. Point it at
  `../../apps/client/wrangler.jsonc`. Root Vitest 5 must not pick up these tests.

- [ ] **Step 1:** Write `room-do.test.ts`: (a) WebSocket connect + echo round-trip
      through `SELF.fetch`; (b) counter survives the DO being evicted/restarted (use the
      integration's eviction helper if present); (c) `runDurableObjectAlarm` fires
      `alarm()` after `setAlarm`.
- [ ] **Step 2:** Run `npm run test:worker` → FAIL (no DO yet).
- [ ] **Step 3:** Implement skeleton, binding, migration, probe route; `wrangler types`.
- [ ] **Step 4:** `npm run test:worker` → PASS; full gate PASS; `npx wrangler deploy
--dry-run` in `apps/client` shows `env.ROOM (Room)` + `env.DB` + `env.ASSETS`.
- [ ] **Step 5:** If the Vitest 4 package cannot run side by side, **stop** and report
      the exact error; do not downgrade repo Vitest. (Fallback decided by controller:
      Node WebSocket client against `wrangler dev`.)
- [ ] **Commit:** `test(worker): Workers test harness and Room Durable Object skeleton`

---

### Task 2: `packages/room` scaffold, protocol and lobby

**Files:** Create `packages/room/{package.json,tsconfig.json,vitest.config.ts}`,
`src/{protocol,model,lobby,roomStep,index}.ts`, `test/{protocol,lobby}.test.ts`;
Modify root `package.json`/`tsconfig` refs, `eslint.config.js` if needed.

**Interfaces:**

```ts
// model.ts
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_SEATS = 4;
export interface RoomSeat {
  seat: number; name: string; classId: ClassId;
  kind: 'human' | 'bot';
  controller: 'player' | 'botTakeover' | 'bot';
  connected: boolean; tokenHash: string | null;
  disconnectDeadline: number | null; idleDeadline: number | null;
}
export interface Room {
  code: string; status: 'lobby' | 'playing' | 'finished';
  host: number; seats: RoomSeat[]; game: GameState | null;
  turn: number; lastActivityAt: number;
  pendingBotWork: boolean; config: RoomConfig;
}
export interface RoomConfig { idleMs: number; ttlMs: number; botBatch: number } // 60_000, 86_400_000, 200
export function generateCode(random: () => number): string;
export function createRoom(code: string, hostName: string, tokenHash: string, now: number, config?: Partial<RoomConfig>): Room;

// protocol.ts
export type ClientMsg =
  | { type: 'join'; name: string } | { type: 'claim'; seat: number }
  | { type: 'setClass'; classId: ClassId } | { type: 'start' }
  | { type: 'action'; action: Action; turn: number } | { type: 'reclaim' };
export type ServerMsg =
  | { type: 'welcome'; seat: number; token?: string }
  | { type: 'lobby'; code: string; host: number; seats: PublicSeat[] }
  | { type: 'view'; turn: number; state: GameState; you: number; legal: Action[]; seats: PublicSeat[] }
  | { type: 'events'; turn: number; events: GameEvent[] }
  | { type: 'error'; key: string };
export function parseClientMsg(raw: string): ClientMsg | null; // ≤ 4096 bytes, known types, valid fields
export function validName(name: string): string | null;        // trimmed 1..16 chars

// roomStep.ts
export type RoomInput =
  | { kind: 'msg'; seat: number | null; conn: string; msg: ClientMsg; newTokenHash?: string }
  | { kind: 'connect'; seat: number | null; conn: string }
  | { kind: 'disconnect'; seat: number | null; conn: string }
  | { kind: 'alarm' };
export interface Outbound { to: number | 'all' | { conn: string }; msg: ServerMsg }
export interface RoomStepResult { room: Room | null /* null = delete */; out: Outbound[]; nextAlarmAt: number | null }
export function roomStep(room: Room, input: RoomInput, now: number): RoomStepResult;
```

`PublicSeat` = seat without `tokenHash`/deadlines. Token generation and hashing happen in
the DO (Task 7); `roomStep` only receives `newTokenHash` and never sees raw tokens.

- [ ] **Step 1: Failing tests:** protocol rejects > 4 KB, unknown type, bad name, bad
      seat; `generateCode` only uses the alphabet, length 5; `join` fills next free seat
      and replies `welcome` to that `conn` + broadcasts `lobby`; 5th join → `error
online.error.roomFull`; `setClass` by own seat only; `start` by non-host → error;
      `start` fills to 4 seats with bots (unused classes first, personalities cycle
      greedy → vengeful → cowardly), calls `createGame` with a server seed, status
      `playing`, broadcasts per-seat `view`; lobby `disconnect` sets
      `disconnectDeadline = now + idleMs`, `alarm` after it removes the seat, moves host
      to lowest remaining seat, returns `room: null` when empty.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; gate.
- [ ] **Commit:** `feat(room): room model, protocol and lobby reducer`

---

### Task 3: Play — action validation, engine step, bot chain

**Files:** Create `packages/room/src/play.ts`, `test/play.test.ts`; Modify `roomStep.ts`.

**Interfaces / rules:**

- `action` accepted only when status `playing`, sender seat is `controller: 'player'`,
  `msg.turn === room.turn`, and `legalActions(game, seat)` contains an action deep-equal
  to `msg.action`. Otherwise `error` (`online.error.staleAction` /
  `online.error.notYourTurn` / `online.error.illegalAction`) to that conn + fresh
  `view` to that seat; room unchanged.
- Accepted: `step` → `turn += 1` → collect events. Engine throw → room unchanged,
  `console.error('[room]', code, seat, phase.kind, err)`, `error
online.error.server` to sender.
- Bot chain: while some seat that is not `controller: 'player'` has legal actions
  (battle: check both sides; use the same actor rule as `legalActions`), run
  `chooseAction` + `step`, `turn += 1`, up to `config.botBatch` steps. If work remains,
  set `pendingBotWork = true` and `nextAlarmAt = now`. `alarm` with `pendingBotWork`
  continues the chain.
- Outbound per accepted input: one `events` (all events in order, redacted per seat in
  Task 4 — for now unredacted) and one `view` per seat with that seat's `legal`.
- `gameOver` → status `finished`.

- [ ] **Step 1: Failing tests:** wrong seat, stale turn, illegal action each rejected
      with room deep-equal to before; a 1-human + 3-bot room where the human always sends
      `legal[0]` reaches `finished` with no errors (seed fixed); bot batch cap: an
      all-takeover room stops at `botBatch` steps with `pendingBotWork` and alarm = now,
      and `alarm` continues; engine throw leaves room unchanged (inject via a stub).
- [ ] **Step 2–4:** FAIL → implement → PASS; gate.
- [ ] **Commit:** `feat(room): server-authoritative actions and bot chain`

---

### Task 4: Per-seat redaction

**Files:** Create `packages/room/src/redact.ts`, `test/redact.test.ts`; Modify
`play.ts`/`lobby.ts` to send only redacted views/events.

**Rules (spec §7):** for viewer seat `v`: copy state; `rng = [0,0,0,0]`,
`config.seed = ''`; in `battle`, if a side's pending pick belongs to a combatant that is
not `v`, set it to `null`, add `opponentPicked: boolean` to the view, and if that hidden
pick is `'secret'` show that combatant's `secretUsed` as `false`. Events: for every role
still pending after the input, the last `BattlePick` of that role gets `pick: 'hidden'`
for every viewer except the picking seat. Server keeps the full state.

- [ ] **Step 1: Failing tests:** hand-picked battle state: viewer sees own pick,
      opponent pick `null`, `opponentPicked: true`, `secretUsed` masked; picking seat sees
      its own pick; after both picks the events show both values; `rng`/`seed` masked;
      the server `room.game` is not mutated.
- [ ] **Step 2:** Property test: 30 seeded all-bot games driven through `roomStep`;
      for every outbound message to every seat, assert no hidden-pick leak in `view` or
      `events` (compare against the full state at that moment), `rng` all zero, `seed`
      empty.
- [ ] **Step 3–4:** implement → PASS; gate.
- [ ] **Commit:** `feat(room): per-seat redaction of hidden picks and RNG`

---

### Task 5: Takeover, reclaim, claim, expiry, alarm scheduling

**Files:** Create `packages/room/src/timers.ts`, `test/timers.test.ts`; Modify
`roomStep.ts`, `play.ts`.

**Rules (spec §8):**

- Idle: when a `player` seat gets non-empty `legal`, `idleDeadline = now + idleMs`;
  cleared when it acts or loses the turn.
- Disconnect (playing): last conn of a seat closes → `disconnectDeadline = now +
idleMs`; reconnect before it clears it.
- `alarm` at/after a deadline → seat `controller = 'botTakeover'`, run bot chain,
  broadcast `view`s (seat list shows takeover).
- `reclaim` from the seat's own conn → `controller = 'player'`, idle timer restarts if
  it must act.
- Connect with a valid token (DO resolves seat) while under takeover → auto reclaim.
- `claim { seat }` from a visitor conn with `newTokenHash`: allowed only if seat is
  `kind: 'human'` and `controller: 'botTakeover'`; sets new `tokenHash` (old token now
  invalid), `welcome` to that conn. Else `online.error.cannotClaim`.
- Expiry: every accepted msg/connect sets `lastActivityAt = now`; `alarm` at
  `lastActivityAt + ttlMs` → `room: null`.
- `nextAlarmAt` = min(pending bot work ? now, all deadlines, expiry).

- [ ] **Step 1: Failing tests** for each rule above, including: takeover then the
      bot plays the seat's pending action; reclaim mid-game; claim with old token then
      rejected; claim of a `kind: 'bot'` seat rejected; `nextAlarmAt` is the earliest
      deadline in several combinations; expiry deletes; activity pushes expiry.
- [ ] **Step 2–4:** FAIL → implement → PASS; gate.
- [ ] **Commit:** `feat(room): idle/disconnect takeover, reclaim, claim and expiry`

---

### Task 6: Room simulation gate

**Files:** Create `packages/room/src/sim.ts`, `test/sim.test.ts`; Modify root
`package.json` (`sim:room` script) and `.github/workflows/ci.yml` (run it in `checks`).

- `npm run sim:room -- --games 200` runs all-bot rooms through `roomStep` only
  (create → joins → start → alarms until `finished`), random disconnect/reconnect and
  takeover/reclaim inputs from a seeded RNG, and reports
  `{ games, finished, crashes, stuck, maxTurns }`. Stuck = 5,000 inputs without
  `finished`. Exit code 1 if `crashes + stuck > 0`.
- [ ] **Step 1:** Failing test for a 5-game run returning `crashes: 0, stuck: 0`.
- [ ] **Step 2–4:** implement → PASS; `npm run sim:room -- --games 200` → 0/0; gate.
- [ ] **Commit:** `test(room): all-bot room simulation gate`

---

### Task 7: Durable Object shell and Worker routes

**Files:** Modify `apps/client/worker/{index.ts,room-do.ts}`,
`tests/worker/test/room-do.test.ts`, `apps/client/test/worker.test.ts`.

**Interfaces:**

- `POST /api/rooms` `{ name }` → Worker generates code (retry ≤ 5 when the DO reports
  it exists), forwards `create` to `env.ROOM` by code → `{ code, seat: 0, token }`.
  Bad name → 400 `{ error: 'online.error.badName' }`.
- `GET /api/rooms/:code/ws[?token=]` → forwarded to the DO. Unknown/expired code →
  WebSocket accepted, sends `error online.error.notFound`, closes 4404.
- DO: stores the room as one JSON row (`ctx.storage` KV or SQL — follow current docs);
  token = 16 random bytes hex, stored as SHA-256 hex; socket attachment
  `{ conn, seat | null }` via `serializeAttachment`; on every input calls `roomStep`,
  persists **before** sending, sends outbound to matching sockets, sets/deletes the
  alarm to `nextAlarmAt`; `room: null` → close sockets 4404 and `deleteAll()`.
- Timer config from env `ROOM_IDLE_MS`, `ROOM_TTL_MS` (unset in production).
- Remove the `_probe` route.

- [ ] **Step 1: Failing integration tests:** create → ws with token → `welcome` +
      `lobby`; second ws joins; start → both receive `view`; action round-trip; state
      survives eviction; `runDurableObjectAlarm` after `ROOM_IDLE_MS` (set small in test
      config) → takeover visible; token reconnect reclaims; wrong code → 4404; expiry
      alarm deletes storage.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npm run test:worker`); gate;
      `wrangler deploy --dry-run` OK.
- [ ] **Commit:** `feat(worker): Room Durable Object and room API routes`

---

### Task 8: Client transport and session

**Files:** Create `apps/client/src/online/{socket.ts,session.ts}`,
`apps/client/test/{socket,session}.test.ts`.

**Interfaces:**

```ts
// session.ts — localStorage key `dice-bandits:room:<CODE>`
export interface RoomSession { code: string; seat: number; token: string; name: string }
export function saveSession(s: RoomSession): void;
export function loadSession(code: string): RoomSession | null;
export function latestSession(): RoomSession | null; // for "Back to room CODE"
export function clearSession(code: string): void;

// socket.ts
export class RoomSocket {
  constructor(opts: { url: string; onMessage(m: ServerMsg): void; onStatus(s: 'open' | 'reconnecting' | 'closed'): void;
                      wsFactory?: (url: string) => WebSocket; timers?: { set: typeof setTimeout; clear: typeof clearTimeout } });
  send(m: ClientMsg): void;   // queued while reconnecting
  close(): void;              // no reconnect
}
```

Backoff 1 s, 2 s, 4 s, 8 s, then 10 s. Close code 4404 → `closed`, no retry.

- [ ] **Step 1: Failing tests** with a fake WebSocket + fake timers: backoff sequence,
      queue flush on reopen, 4404 stops retry, session round-trip and `latestSession`.
- [ ] **Step 2–4:** FAIL → implement → PASS; gate.
- [ ] **Commit:** `feat(client): room socket with reconnect and seat session storage`

---

### Task 9: Online screens — create, join, lobby, claim

**Files:** Create `apps/client/src/online/screens.ts`, `apps/client/test/onlineScreens.test.ts`;
Modify `apps/client/src/ui/screens.ts` (title buttons), `apps/client/src/main.ts`
(route `/r/<CODE>`), `apps/client/src/i18n/{en,th}.json`,
`apps/client/worker/index.ts` only if `/r/*` needs the SPA fallback (verify first).

**UI (test ids):**

- Title: `online-create`, `online-join`, and `online-back` ("Back to room CODE") when
  `latestSession()` exists.
- Create: name input `online-name` + `online-create-submit` → POST → save session →
  lobby.
- Join: code input `online-code` (auto-uppercase, 5 chars) + name + `online-join-submit`.
- Lobby (`screen-lobby`): code shown large with copy-link button `online-copy-link`
  (`/r/CODE`), seat list with names/classes/host badge, own class picker
  `lobby-class-<classId>`, host-only `lobby-start`.
- Claim (`screen-claim`, game in progress, no token): list of bot-held human seats
  `claim-seat-<n>`; empty list → message `online.claim.none`.
- Errors: `online-error` shows the translated key; back to title.
- Every new string in both `en.json` and `th.json` (i18n key parity test must pass).

- [ ] **Step 1: Failing DOM tests** (happy-dom, fake socket): title buttons, lobby
      render from a `lobby` message, host-only start, claim list, error rendering in TH
      and EN.
- [ ] **Step 2–4:** FAIL → implement → PASS; gate; explore with `playwright-cli`
      against `wrangler dev` (two contexts) and screenshot title/lobby in TH + EN,
      desktop + mobile landscape.
- [ ] **Commit:** `feat(client): online create/join/lobby/claim screens`

---

### Task 10: OnlineController and in-game integration

**Files:** Create `apps/client/src/online/onlineController.ts`,
`apps/client/test/onlineController.test.ts`; Modify `apps/client/src/ui/hud.ts`,
`apps/client/src/ui/battleUi.ts`, `apps/client/src/main.ts`,
`apps/client/src/scenes/*.ts` only where they read `controller.state`.

**Interfaces / rules:**

- `OnlineController` exposes the same surface the UI uses from `GameController`
  (`state`, `dispatch(action)`, event callback) so scenes/HUD need minimal changes.
  `dispatch` sends `{ type: 'action', action, turn }`; on `events` it awaits the same
  `onEvents` animation callback, then applies the next `view`.
- HUD and battle UI take an optional `legal: Action[]` source. Online: buttons come only
  from the server `legal` for `you`; hot-seat keeps calling `legalActions` locally.
- Online never shows the pass-the-device screen; hidden opponent pick shows
  "Opponent has picked" when `opponentPicked`.
- Banners: `online-reconnecting` while socket status is `reconnecting`;
  `online-takeover` with button `online-reclaim` when own seat is `botTakeover`.
  Seat cards show a bot badge for takeover seats (`seat-takeover-<n>`).
- No local save (`saveGame`) in online mode; hot-seat saves unchanged.

- [ ] **Step 1: Failing tests** (fake socket, speed 0): view → HUD shows only server
      legal buttons; click sends action with current `turn`; takeover banner + reclaim
      sends `reclaim`; no `saveGame` call online; hot-seat controller tests unchanged
      and green.
- [ ] **Step 2–4:** FAIL → implement → PASS; gate; two-context manual run with
      `playwright-cli` through at least one PvP battle between the two humans (hidden
      pick not visible on the other page before resolution); screenshots.
- [ ] **Commit:** `feat(client): online controller, server-driven HUD and takeover banner`

---

### Task 11: Online E2E + CI

**Files:** Create `apps/client/e2e/online.spec.ts`; Modify
`apps/client/playwright.config.ts`, `.github/workflows/ci.yml`.

- First check whether the existing `vite preview` web server (with
  `@cloudflare/vite-plugin`) serves the Worker + Durable Object. If yes, reuse it; if not,
  add a second `webServer` running `wrangler dev` on a fixed port for `online.spec.ts`
  only. Test timers: `ROOM_IDLE_MS=3000` via `.dev.vars`/`--var` in the test server
  command only.
- Journey (two browser contexts A/B, desktop project; mobile-landscape runs the lobby
  part): A creates → B joins via `/r/CODE` → both pick classes → A starts → play until
  each human acted ≥ 3 times (helper picks first enabled action for whoever has
  buttons) → A goes offline (`context.setOffline(true)`) → B sees
  `seat-takeover-0` within 10 s and the game keeps moving → A back online → A reclaims
  automatically (no takeover banner) → new context C opens `/r/CODE` while B is offline
  and under takeover → C claims B's seat → B's old tab gets `online-error`; unknown code
  → `online-error`; TH/EN toggle in lobby.
- [ ] **Step 1:** Write spec → run → FAIL where behavior is missing.
- [ ] **Step 2:** Fix real defects in the owning module with a unit test; do not
      weaken assertions.
- [ ] **Step 3:** Full gate incl. `npm run e2e`, `npm run test:worker`,
      `npm run sim:room -- --games 200` → PASS; record counts.
- [ ] **Commit:** `test(e2e): two-device online room journey in CI`

---

### Task 12: Deploy and live verification (controller only, owner approval)

- [ ] Controller runs full gate, final whole-branch review, opens PR to `main`, waits
      for CI green, **asks owner for merge approval**.
- [ ] Merge → deploy job applies the DO migration (`v1`, `new_sqlite_classes`).
- [ ] Live check on `https://dice-bandits.anugooltippon.workers.dev`: two real browsers
      create/join/play, one goes offline > 60 s → takeover, returns → reclaim; hot-seat
      game still works; `/api/health` OK; no console errors.
- [ ] Update `README.md` (how to play online); commit via PR.

---

## Self-review

- **Spec coverage:** §2 decisions 1–6 → T2, T5, T7, T9, T10; §5 room model → T2, T5,
  T9; §6 protocol → T2, T7, T8; §7 redaction → T4; §8 flows/timers → T3, T5, T7;
  §9 errors → T3, T7, T8, T10; §10 testing → T1, T4, T6, T7, T11; §12 risks → T1
  (Vitest split), T3 (server-only bots), T6 (sim).
- **Type names** (`Room`, `RoomSeat`, `RoomInput`, `roomStep`, `ClientMsg`,
  `ServerMsg`, `PublicSeat`, `RoomSocket`, `OnlineController`) are consistent across
  tasks.
- **Order:** T1 de-risks the only unproven tool; T2–T6 are pure and fast; T7 wires the
  DO; T8–T10 client; T11 E2E; T12 controller-only.
