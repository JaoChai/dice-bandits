# Dice Bandits M1 Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser party board-RPG (1–4 hot-seat humans + rule-based bots, Thai/English) playable to the results screen in ~30 minutes, deployed on Cloudflare Workers Static Assets.

**Architecture:** npm-workspaces monorepo. `packages/engine` is a pure, deterministic TypeScript rules engine (`step(state, action) → { state, events }`, seeded PRNG inside state, bots and simulator included). `apps/client` is Vite + Phaser 4 (canvas board/battle) with DOM overlays for menus/HUD/text, driven by a `GameController` that only calls the engine. The client is deployed as an assets-only SPA via `@cloudflare/vite-plugin`.

**Tech Stack:** TypeScript 6.0.3, Node ≥ 24 (local v26.9.0), Vitest 5.0.2, Phaser 4.2.1, Vite 8.3.1, @cloudflare/vite-plugin 1.60.2, Wrangler 4.141.0, @playwright/test 1.63.0, ESLint 10.11.0 + typescript-eslint 8.70.1, Prettier 3.9.9, tsx 4.23.15, sharp 0.35.4, @fontsource/chakra-petch 5.3.0, @fontsource/press-start-2p 5.3.0 (both OFL-1.1).

**Spec:** `docs/superpowers/specs/2026-09-27-dice-bandits-m1-design.md` — read it before any task; section numbers (§) below refer to it.

## Global Constraints

- **TypeScript is pinned to `6.0.3`, not 7.x:** `typescript-eslint@8.70.1` peer range is `>=4.8.4 <6.1.0` (checked 2026-09-27).
- Exact dependency versions (no `^`) in every `package.json`; commit `package-lock.json`.
- `packages/engine` must not import DOM, Phaser, Node built-ins, `Math.random`, or `Date`. All randomness via `packages/engine/src/rng.ts` using state held in `GameState.rng`.
- `GameState` is plain JSON (no classes, Maps, Sets, functions, `undefined` values — use `null`). `structuredClone(state)` must equal `state`.
- `step` never mutates its input; it returns a new state.
- Engine events carry i18n keys + params, never display strings.
- Balance numbers live in `packages/engine/src/data/*.json`, not in code.
- Every user-visible client string comes from `apps/client/src/i18n/{th,en}.json`; both files have identical key sets (enforced by a test).
- Quick mode = 12 rounds; Final Frenzy = rounds 10–12; start gold 300; level cap 15; inventory max 6; Bandit Cards max 2.
- Phaser config: `pixelArt: true`, base 640×360, `Scale.FIT`, `autoCenter: CENTER_BOTH`. Re-check any Phaser API against Phaser 4 docs (Context7 `/websites/phaser_io_api-documentation`) before use.
- Wrangler config: `name: "dice-bandits"`, `compatibility_date: "2026-09-27"`, `assets.not_found_handling: "single-page-application"`; no `assets.directory` (the Vite plugin wires it).
- Test hooks (`?seed=`, `?speed=`, `window.__db`) exist only when built with `VITE_TEST_HOOKS=1`.
- Commit after every task with a Conventional Commit message. Never run two Playwright runs concurrently (shared `test-results/`).
- No deploy, no GitHub Actions secret changes, and no Cloudflare account changes without the owner's explicit approval (Task 14).

## File Structure

```
package.json                     workspaces, root scripts (typecheck, lint, test, sim, e2e, build, deploy)
tsconfig.base.json               strict shared compiler options
eslint.config.js, .prettierrc.json
.github/workflows/ci.yml
packages/engine/
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts                   public API re-exports
  src/types.ts                   all state/action/event types
  src/rng.ts                     sfc32 seeded PRNG (pure)
  src/data/{classes,monsters,items,perks,worldRules,balance,chunks,pranks}.json
  src/data/index.ts              typed loaders for the JSON
  src/board.ts                   generateBoard(seed)
  src/setup.ts                   createGame(config)
  src/legal.ts                   legalActions(state, seat)
  src/step.ts                    step(state, action) dispatcher + invariants
  src/rules/{movement,spaces,battle,pvp,towns,leveling,items,underdog,endgame}.ts
  src/bots/{index,scoring}.ts    chooseAction(state, seat, rng)
  src/sim.ts                     runSimulation(n, seed) + CLI entry
  test/*.test.ts
tools/pixelize/
  pixelize.ts, palette.json, crops.json, README.md
apps/client/
  package.json, tsconfig.json, vite.config.ts, wrangler.jsonc, index.html, playwright.config.ts
  public/sprites/*.png           outputs of tools/pixelize (committed)
  src/main.ts                    bootstrap: fonts, i18n, screens, Phaser game
  src/i18n/{index.ts,th.json,en.json}
  src/save.ts                    localStorage autosave/continue
  src/controller.ts              GameController: state owner, event queue, bot loop
  src/testHooks.ts
  src/ui/{screens.ts,hud.ts,dialogs.ts,battleUi.ts,passDevice.ts,results.ts,styles.css}
  src/scenes/{BootScene,BoardScene,BattleScene}.ts
  src/fx.ts                      dice/hop/shake/coin-burst helpers
  test/*.test.ts                 vitest unit tests for client logic (i18n, save, controller)
  e2e/*.spec.ts
```

---

### Task 1: Monorepo scaffold, tooling, CI skeleton

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.nvmrc`, `.github/workflows/ci.yml`
- Create: `packages/engine/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,test/smoke.test.ts}`

**Interfaces:**
- Produces: root scripts `typecheck`, `lint`, `format:check`, `test`, `sim`, `build`, `e2e`, `deploy` (later tasks fill `sim`, `build`, `e2e`, `deploy`); workspace package name `@dice-bandits/engine`.

- [ ] **Step 1: Root `package.json`**

```json
{
  "name": "dice-bandits",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "eslint .",
    "format:check": "prettier --check .",
    "test": "npm run test --workspaces --if-present",
    "sim": "npm run sim -w @dice-bandits/engine",
    "build": "npm run build --workspaces --if-present",
    "e2e": "npm run e2e -w @dice-bandits/client",
    "deploy": "npm run deploy -w @dice-bandits/client"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "eslint": "10.11.0",
    "prettier": "3.9.9",
    "tsx": "4.23.15",
    "typescript": "6.0.3",
    "typescript-eslint": "8.70.1"
  }
}
```

Before writing, run `npm view @eslint/js version` and use the exact version compatible with eslint 10.11.0 (replace `10.0.1` if different). `.nvmrc` contains `24`.

- [ ] **Step 2: `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

- [ ] **Step 3: Engine package files**

`packages/engine/package.json`:
```json
{
  "name": "@dice-bandits/engine",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "sim": "tsx src/sim.ts"
  },
  "devDependencies": { "vitest": "5.0.2", "@types/node": "24.6.0" }
}
```
Check `npm view @types/node@24 version | tail -1` and pin that exact version (vitest peer: `^22 || >=24`).

`packages/engine/tsconfig.json`: extends `../../tsconfig.base.json`, `include: ["src", "test"]`, `compilerOptions.types: ["node"]` (node types only for `sim.ts` CLI and tests; the ESLint rule in Step 4 forbids Node imports elsewhere in `src/`).

`packages/engine/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```

`packages/engine/test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ENGINE_VERSION } from '../src/index';
describe('engine package', () => {
  it('exposes a version', () => { expect(ENGINE_VERSION).toBe(1); });
});
```

- [ ] **Step 4: Run the test — expect FAIL** (`npm install && npm test`) → `ENGINE_VERSION` not exported.

- [ ] **Step 5: Implement** `packages/engine/src/index.ts`: `export const ENGINE_VERSION = 1;`

- [ ] **Step 6: ESLint + Prettier config**

`eslint.config.js` (flat config): `@eslint/js` recommended + `typescript-eslint` recommended; ignores `**/dist`, `**/node_modules`, `**/.wrangler`, `**/test-results`, `**/playwright-report`, `apps/client/public`. Add a block for `packages/engine/src/**/*.ts` excluding `src/sim.ts`:
```js
{
  files: ['packages/engine/src/**/*.ts'],
  ignores: ['packages/engine/src/sim.ts'],
  rules: {
    'no-restricted-globals': ['error', 'window', 'document', 'localStorage'],
    'no-restricted-properties': ['error',
      { object: 'Math', property: 'random', message: 'Use rng.ts' },
      { object: 'Date', property: 'now', message: 'Engine must be deterministic' }],
    'no-restricted-imports': ['error', { patterns: ['node:*', 'phaser', 'phaser/*'] }],
  },
}
```
`.prettierrc.json`: `{ "singleQuote": true, "printWidth": 100 }`. `.prettierignore`: `docs/concepts`, `package-lock.json`, `apps/client/public`, `dist`, `.wrangler`.

- [ ] **Step 7: CI workflow** `.github/workflows/ci.yml`:
```yaml
name: ci
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run format:check
      - run: npm test
```
Before committing, confirm the current major versions of `actions/checkout` and `actions/setup-node` from their GitHub release pages and use them.

- [ ] **Step 8: Verify** `npm run typecheck && npm run lint && npm run format:check && npm test` → all PASS.
- [ ] **Step 9: Commit** `chore: scaffold monorepo, tooling and CI`, push, confirm the Actions run is green with `gh run watch`.

---

### Task 2: Engine core types, seeded RNG, data tables

**Files:**
- Create: `packages/engine/src/types.ts`, `src/rng.ts`, `src/data/*.json`, `src/data/index.ts`
- Test: `packages/engine/test/rng.test.ts`, `test/data.test.ts`

**Interfaces:**
- Produces (exact names used by every later task):

```ts
// src/rng.ts
export type RngState = [number, number, number, number]; // sfc32 words (uint32)
export function seedRng(seed: string): RngState;            // xmur3 hash → 4 words, then 15 warm-up draws
export function nextFloat(s: RngState): [number, RngState]; // [0,1)
export function nextInt(s: RngState, min: number, max: number): [number, RngState]; // inclusive
export function pick<T>(s: RngState, arr: readonly T[]): [T, RngState];
export function shuffle<T>(s: RngState, arr: readonly T[]): [T[], RngState];
```

```ts
// src/types.ts
export type ClassId = 'knight' | 'thief' | 'mage' | 'cleric';
export type Personality = 'greedy' | 'vengeful' | 'cowardly';
export type Region = 'meadow' | 'desert' | 'snow' | 'volcano';
export type SpaceKind = 'castle' | 'town' | 'shop' | 'chest' | 'monster' | 'event' | 'trap';
export type AttackPick = 'attack' | 'strike' | 'secret';
export type DefensePick = 'defend' | 'counter' | 'secret';
export type PvpReward = 'rob' | 'loot' | 'seize' | 'prank';
export type BanditCardId = 'pickpocketFar' | 'cursedLegs' | 'bounty';

export interface Stats { maxHp: number; atk: number; def: number; spd: number; mag: number }
export interface Space { id: number; kind: SpaceKind; region: Region; next: number[]; x: number; y: number }
export interface Board { spaces: Space[]; castleId: number }
export interface Town { spaceId: number; owner: number | null; value: number; guardianLevel: number }
export interface SeatConfig { name: string; classId: ClassId; control: 'human' | 'bot'; personality: Personality | null }
export interface GameConfig { seed: string; seats: SeatConfig[]; rounds: number }

export interface Player {
  seat: number; name: string; classId: ClassId; control: 'human' | 'bot'; personality: Personality | null;
  gold: number; level: number; xp: number; hp: number; stats: Stats;
  pos: number; items: string[]; weapon: string | null; armor: string | null;
  skipTurns: number; rollCap: number | null; bonusDice: number;
  prank: { alias: string; untilRound: number } | null;
  banditCards: BanditCardId[]; grudges: number[]; // grudges[otherSeat] = damage/theft points
  perks: string[];
}

export interface Combatant { kind: 'player' | 'monster'; seat: number | null; monsterId: string | null;
  level: number; hp: number; stats: Stats; secretUsed: boolean; buffs: { ironSkin: boolean; poison: boolean; halveNext: boolean } }
export interface BattleState {
  context: 'monster' | 'town' | 'pvp'; spaceId: number;
  a: Combatant; b: Combatant;       // a = initiator (current seat)
  exchange: number;                 // 1..3
  attackerSide: 'a' | 'b';          // who attacks in the current half-exchange
  half: 1 | 2;
  pending: { attack: AttackPick | null; defense: DefensePick | null };
}

export type Phase =
  | { kind: 'awaitRoll' }                                        // may use field card or bandit card first
  | { kind: 'moving'; remaining: number }                        // internal, never exposed between steps
  | { kind: 'chooseBranch'; remaining: number; options: number[] }
  | { kind: 'duelOffer'; remaining: number; targets: number[] }
  | { kind: 'battle'; battle: BattleState }
  | { kind: 'pvpReward'; winner: number; loser: number }
  | { kind: 'levelUp'; seat: number; choices: string[]; then: 'endTurn' | 'continue' }
  | { kind: 'shop'; stock: string[] }
  | { kind: 'townManage'; spaceId: number }                      // own town: invest or leave
  | { kind: 'townChallenge'; spaceId: number }                   // enemy town: attack or leave
  | { kind: 'endOfTurn' }
  | { kind: 'gameOver'; ranking: number[]; highlights: Highlight[] };

export interface Highlight { key: string; seat: number; value: number }

export type Action =
  | { type: 'roll' }
  | { type: 'useItem'; item: string; target: number | null }
  | { type: 'useBanditCard'; card: BanditCardId }
  | { type: 'chooseBranch'; to: number }
  | { type: 'duel'; target: number | null }                     // null = keep moving
  | { type: 'battlePick'; side: 'a' | 'b'; pick: AttackPick | DefensePick }
  | { type: 'pvpReward'; reward: PvpReward; item: string | null; townId: number | null; alias: string | null }
  | { type: 'pickPerk'; perk: string }
  | { type: 'shopBuy'; item: string } | { type: 'shopSell'; item: string }
  | { type: 'invest' } | { type: 'attackTown' } | { type: 'leave' }
  | { type: 'endTurn' };

export interface GameEvent { type: string; seat: number | null; params: Record<string, string | number> }

export interface GameState {
  version: 1; config: GameConfig; rng: RngState;
  round: number; turnSeat: number; worldRule: string;
  board: Board; towns: Town[]; players: Player[];
  phase: Phase; bounty: { target: number; untilRound: number } | null;
  stats: { robbedGold: number[]; townFlips: Record<number, number>; kos: number[] };
}
export interface StepResult { state: GameState; events: GameEvent[] }
export class IllegalActionError extends Error {}
```
(Keep `IllegalActionError` in `types.ts`; it is the only non-type export there. KOs are counted only in `GameState.stats.kos`.)

- [ ] **Step 1: Write failing RNG tests** `test/rng.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { seedRng, nextFloat, nextInt, shuffle } from '../src/rng';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = seedRng('abc'), b = seedRng('abc');
    expect(nextFloat(a)[0]).toBe(nextFloat(b)[0]);
  });
  it('differs between seeds', () => {
    expect(nextFloat(seedRng('a'))[0]).not.toBe(nextFloat(seedRng('b'))[0]);
  });
  it('does not mutate input state', () => {
    const s = seedRng('x'); const copy = [...s];
    nextFloat(s); expect(s).toEqual(copy);
  });
  it('nextInt stays in inclusive range and hits both ends', () => {
    let s = seedRng('range'); const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) { const [v, n] = nextInt(s, 1, 6); s = n; seen.add(v);
      expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(6); }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('shuffle is a permutation', () => {
    const [out] = shuffle(seedRng('s'), [1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it('state is JSON round-trippable', () => {
    const s = seedRng('j'); expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
```
- [ ] **Step 2: Run** `npm test -w @dice-bandits/engine` → FAIL (module missing).
- [ ] **Step 3: Implement `rng.ts`** (sfc32 + xmur3; all ops `>>> 0`):
```ts
export type RngState = [number, number, number, number];
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
}
function sfc32(s: RngState): [number, RngState] {
  let [a, b, c, d] = s;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0; a = b ^ (b >>> 9); b = (c + (c << 3)) >>> 0; c = (c << 21) | (c >>> 11); c = (c + t) >>> 0;
  return [t, [a >>> 0, b >>> 0, c >>> 0, d]];
}
export function seedRng(seed: string): RngState {
  const h = xmur3(seed); let s: RngState = [h(), h(), h(), h()];
  for (let i = 0; i < 15; i++) s = sfc32(s)[1];
  return s;
}
export function nextFloat(s: RngState): [number, RngState] { const [t, n] = sfc32(s); return [t / 4294967296, n]; }
export function nextInt(s: RngState, min: number, max: number): [number, RngState] {
  const [f, n] = nextFloat(s); return [min + Math.floor(f * (max - min + 1)), n];
}
export function pick<T>(s: RngState, arr: readonly T[]): [T, RngState] {
  const [i, n] = nextInt(s, 0, arr.length - 1); return [arr[i] as T, n];
}
export function shuffle<T>(s: RngState, arr: readonly T[]): [T[], RngState] {
  const out = [...arr]; let st = s;
  for (let i = out.length - 1; i > 0; i--) { const [j, n] = nextInt(st, 0, i); st = n; [out[i], out[j]] = [out[j] as T, out[i] as T]; }
  return [out, st];
}
```
- [ ] **Step 4: Data tables** — write these JSON files with these exact starting values (tuned later only by Task 8):

`classes.json` (base stats at level 1 and per-level growth):
```json
{
  "knight": { "base": { "maxHp": 48, "atk": 12, "def": 12, "spd": 6,  "mag": 4  }, "growth": { "maxHp": 6, "atk": 2, "def": 2, "spd": 1, "mag": 0 }, "secret": "bulwark" },
  "thief":  { "base": { "maxHp": 38, "atk": 11, "def": 7,  "spd": 13, "mag": 5  }, "growth": { "maxHp": 4, "atk": 2, "def": 1, "spd": 2, "mag": 1 }, "secret": "pickpocket" },
  "mage":   { "base": { "maxHp": 34, "atk": 6,  "def": 6,  "spd": 9,  "mag": 15 }, "growth": { "maxHp": 4, "atk": 1, "def": 1, "spd": 1, "mag": 3 }, "secret": "firestorm" },
  "cleric": { "base": { "maxHp": 42, "atk": 9,  "def": 9,  "spd": 8,  "mag": 10 }, "growth": { "maxHp": 5, "atk": 1, "def": 2, "spd": 1, "mag": 2 }, "secret": "sanctuary" }
}
```
`monsters.json`: six monsters `goldSlime, mushroomBandit, lanternGhost, mimic, rockGolem, shadowImp`, each `{ "base": Stats, "growth": Stats, "xp": number, "gold": number, "regions": Region[] }`; region tables: meadow → goldSlime, mushroomBandit; desert → mushroomBandit, mimic, lanternGhost; snow → lanternGhost, rockGolem; volcano → rockGolem, shadowImp. Monster level on spawn = region tier (meadow 1, desert 3, snow 5, volcano 7) + `nextInt(0,2)`; +1 with the Monster Surge world rule. Starting numbers: base stats ≈ 70% of a level-1 knight scaled per monster; `xp` 20/25/30/35/45/60, `gold` 40/60/50/150/90/120 in the listed order.

`items.json`: array of 30 `{ "id", "kind": "field"|"battle"|"equipment", "price", "slot": "weapon"|"armor"|null, "effect": { ... } }` covering: field — `dash` (+1 die), `dash2` (+2 dice), `warp` (to Castle), `trapCard` (place trap on current space for others), `smokeBomb` (skip next duel/monster fight), `luckyCoin` (+100 G), `mapScroll` (choose roll 1–6); battle — `potion` (+30% HP), `hiPotion` (+60%), `ironSkin` (next hit ×0.5), `poisonBlade` (target loses 10% max HP per exchange), `escapeRope` (end battle, no penalty), `rage` (next attack ×1.3); equipment — 9 weapons and 9 armors with `effect: { "atk" | "def" | "spd" | "mag": n }` in 3 tiers per 3 lines (prices 150/400/900). Every id has TH/EN names added in Task 10.

`perks.json`: 12 perks, e.g. `hpUp` (+10 maxHp), `atkUp` (+3), `defUp` (+3), `spdUp` (+3), `magUp` (+3), `taxman` (+20% tax), `looter` (Rob takes 40%), `thickSkin` (monster damage −15%), `quickFeet` (+1 move when rolling 1), `haggler` (shop −15%), `scavenger` (+50% chest gold), `grudgeHolder` (+15% dmg vs the leader).

`worldRules.json`: `goldRush`, `taxHoliday`, `monsterSurge`, `slipperyRoads`, `blackMarket`, `cursedCapital` (effects per §5.8).

`balance.json`:
```json
{ "startGold": 300, "rounds": 12, "frenzyFromRound": 10, "frenzyMultiplier": 2, "levelCap": 15,
  "xpToLevel": [0, 30, 70, 120, 180, 250, 330, 420, 520, 630, 750, 880, 1020, 1170, 1330],
  "deathGoldLossPct": 20, "robPct": 30, "prankRounds": 3, "inventoryMax": 6, "banditCardsMax": 2,
  "townBaseValue": 200, "townTaxPct": 10, "investCost": 100, "investValuePct": 50,
  "chestGold": [30, 120], "trapGoldLossPct": 10, "trapSkipChance": 0.3,
  "damageVariance": [0.9, 1.1], "attackMult": 1, "strikeMult": 1.5, "defendMult": 0.5,
  "pickpocketFarPct": 10, "bountyGold": 200, "bountyRounds": 2, "resaleRatio": 0.5 }
```
`chunks.json`: 8 hand-authored chunks (2 per region) of 8–12 spaces as ordered `SpaceKind` lists with local `x,y` offsets, one chunk per region flagged `"fork": true` containing a split of two parallel 3-space lanes that rejoin.
`pranks.json`: 12 silly aliases as i18n keys (`prank.alias.1` … `prank.alias.12`).

- [ ] **Step 5: `data/index.ts`** — `import` each JSON with `with { type: 'json' }`, export typed constants `CLASSES`, `MONSTERS`, `ITEMS` (plus `ITEM_BY_ID` record), `PERKS`, `WORLD_RULES`, `BALANCE`, `CHUNKS`, `PRANK_ALIASES`.
- [ ] **Step 6: Data validation tests** `test/data.test.ts`: 4 classes with a secret; exactly 30 unique item ids; each item kind valid and equipment has a slot; every region has ≥ 2 monsters; `xpToLevel.length === levelCap` and strictly increasing; 6 world rules; every chunk has 8–12 spaces.
- [ ] **Step 7: Run** tests → PASS; `npm run typecheck && npm run lint` → PASS.
- [ ] **Step 8: Commit** `feat(engine): types, seeded rng and data tables`.

---

### Task 3: Board generator

**Files:** Create `packages/engine/src/board.ts`; Test `packages/engine/test/board.test.ts`

**Interfaces:**
- Consumes: `seedRng`, `shuffle`, `CHUNKS`, `Board`, `Space`.
- Produces: `generateBoard(seed: string): Board` — deterministic; `castleId` is space 0; `next` holds successor ids (length 2 only at a fork start); coordinates `x,y` in 32-px tile units within a 20×11 grid area (640×360 canvas minus HUD).

- [ ] **Step 1: Failing tests** — over 10,000 seeds (`\`seed-${i}\``):
```ts
import { describe, it, expect } from 'vitest';
import { generateBoard } from '../src/board';

const SEEDS = Array.from({ length: 10_000 }, (_, i) => `seed-${i}`);
describe('generateBoard', () => {
  it('is deterministic', () => { expect(generateBoard('x')).toEqual(generateBoard('x')); });
  it.each([0, 1, 2])('guarantees hold (slice %i)', (slice) => {
    for (const seed of SEEDS.slice(slice * 3334, (slice + 1) * 3334)) {
      const b = generateBoard(seed);
      expect(b.spaces.length).toBeGreaterThanOrEqual(36);
      expect(b.spaces.length).toBeLessThanOrEqual(44);
      expect(b.spaces[b.castleId]?.kind).toBe('castle');
      for (const r of ['meadow', 'desert', 'snow', 'volcano'] as const) {
        const inR = b.spaces.filter((s) => s.region === r);
        expect(inR.filter((s) => s.kind === 'town').length).toBeGreaterThanOrEqual(2);
        expect(inR.filter((s) => s.kind === 'shop').length).toBeGreaterThanOrEqual(1);
      }
      for (const s of b.spaces) for (const n of s.next)
        expect(!(s.kind === 'trap' && b.spaces[n]?.kind === 'trap')).toBe(true);
      // reachability from castle
      const seen = new Set([b.castleId]); const q = [b.castleId];
      while (q.length) for (const n of b.spaces[q.pop()!]!.next) if (!seen.has(n)) { seen.add(n); q.push(n); }
      expect(seen.size).toBe(b.spaces.length);
      expect(b.spaces.filter((s) => s.next.length === 2).length).toBe(2);
      const coords = new Set(b.spaces.map((s) => `${s.x},${s.y}`));
      expect(coords.size).toBe(b.spaces.length);
    }
  });
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Algorithm: castle space 0 in the meadow; for each region in order meadow → desert → snow → volcano pick one of its two chunks with `pick` (exactly two regions, chosen via `shuffle`, use their fork chunk; the others use a non-fork chunk — author chunks so each region has one fork and one non-fork variant); lay chunks clockwise on a rectangular loop inside the 20×11 area; then if any guarantee fails (adjacent traps, town/shop minimum) repair by swapping kinds within the region using the same rng; the last space links back to the castle. The generator must never loop unbounded — if repair fails after 10 attempts, throw (the test will catch it).
- [ ] **Step 4: Run** → PASS (10k seeds should take < 10 s; if slower, profile before optimizing).
- [ ] **Step 5: Commit** `feat(engine): seeded board generator`.

---

### Task 4: Game setup, turn flow, movement, legal actions, invariants

**Files:** Create `src/setup.ts`, `src/step.ts`, `src/legal.ts`, `src/rules/movement.ts`; Modify `src/index.ts`; Test `test/turn.test.ts`, `test/invariants.ts` (helper, not a test file).

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces:
  - `createGame(config: GameConfig): GameState` — players at castle, gold 300, level 1, hp = maxHp, world rule drawn, phase `awaitRoll`, round 1, turnSeat 0.
  - `step(state: GameState, action: Action): StepResult` — dispatches by phase; throws `IllegalActionError` if `!legalActions(state, state.turnSeat).some(eq)` *except* `battlePick`, which is legal for whichever side still has a pending pick (checked by `legalBattlePicks`).
  - `legalActions(state: GameState, seat: number): Action[]` — full enumeration (for `useItem` targets and `pvpReward` items/towns/aliases enumerate concrete options).
  - `assertInvariants(state: GameState): void` in `test/invariants.ts` — gold ≥ 0, 0 ≤ hp ≤ maxHp, `turnSeat` valid, `round ≤ rounds`, `structuredClone(state)` deep-equals `state`.
  - Internal rule modules export pure functions `(state, …) => { state, events }` and are only called by `step`.
- Movement rules (§5.3): `roll` → 1d6 (+`bonusDice` d6, reset after), capped by `rollCap` (Cursed Legs: 1d3); Slippery Roads adds +1 when the destination is snow. Move one space at a time; at a fork phase `chooseBranch`; passing a space with other players (not the final space) → `duelOffer` (if they are not KO'd). On the final space resolve it (Task 6 fills `resolveSpace`; in this task use a stub that ends the turn and is replaced in Task 6 — the stub lives only between these two commits).
- Turn end: next seat; skip seats with `skipTurns > 0` (decrement, emit `TurnSkipped`); when wrapping to seat 0 increment round; after round `rounds` → `gameOver` (Task 7 computes ranking; in this task ranking = seat order).

- [ ] **Step 1: Failing tests** `test/turn.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createGame, step, legalActions } from '../src/index';
import { IllegalActionError, type GameConfig } from '../src/types';
import { assertInvariants } from './invariants';

const cfg = (seed = 't1'): GameConfig => ({ seed, rounds: 12, seats: [
  { name: 'A', classId: 'knight', control: 'human', personality: null },
  { name: 'B', classId: 'thief', control: 'bot', personality: 'greedy' } ] });

describe('turn flow', () => {
  it('creates a valid initial state', () => {
    const s = createGame(cfg()); assertInvariants(s);
    expect(s.players.every((p) => p.gold === 300 && p.pos === s.board.castleId)).toBe(true);
    expect(s.phase.kind).toBe('awaitRoll');
  });
  it('rejects illegal actions without changing state', () => {
    const s = createGame(cfg()); const before = JSON.stringify(s);
    expect(() => step(s, { type: 'invest' })).toThrow(IllegalActionError);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('rolling moves the player and emits DiceRolled + Moved', () => {
    const s0 = createGame(cfg());
    const { state, events } = step(s0, { type: 'roll' });
    const roll = events.find((e) => e.type === 'DiceRolled')!;
    expect(Number(roll.params.value)).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.type === 'Moved')).toBe(true);
    expect(state.players[0]!.pos).not.toBe(s0.players[0]!.pos);
    assertInvariants(state);
  });
  it('same seed + same actions ⇒ identical state', () => {
    const run = () => { let s = createGame(cfg('det'));
      for (let i = 0; i < 40 && s.phase.kind !== 'gameOver'; i++) s = step(s, legalActions(s, s.turnSeat)[0]!).state; return s; };
    expect(run()).toEqual(run());
  });
  it('step does not mutate input', () => {
    const s = createGame(cfg()); const snap = structuredClone(s); step(s, { type: 'roll' }); expect(s).toEqual(snap);
  });
});
```
Add targeted tests: fork → `chooseBranch` with 2 options and the chosen branch is followed; passing an occupied space → `duelOffer`, `duel: null` continues moving; a seat with `skipTurns: 1` is skipped once; after the last seat of round 12 ends, phase is `gameOver`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `setup.ts`, `rules/movement.ts`, `legal.ts`, `step.ts` (dispatcher: `structuredClone` input once at the top, apply the rule function, return new state + events). Export `createGame`, `step`, `legalActions`, types and `IllegalActionError` from `index.ts`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(engine): setup, turn flow and movement`.

---

### Task 5: Battle system

**Files:** Create `src/rules/battle.ts`; Test `test/battle.test.ts`

**Interfaces:**
- Consumes: `BattleState`, `Combatant`, `BALANCE`, `CLASSES`, rng.
- Produces:
  - `startBattle(state, ctx: { context: 'monster'|'town'|'pvp'; spaceId: number; opponent: Combatant }): StepResult` — sets phase `battle`, attackerSide = higher SPD (tie: initiator `a`).
  - `damage(atk: number, def: number, mult: number, variance: number): number` = `Math.max(1, Math.round((atk * mult - def / 2) * variance))`; mage uses `mag` instead of `atk` for Firestorm only.
  - `applyBattlePick(state, side, pick): StepResult` — records the pick; when both `attack` and `defense` are set, resolves the half-exchange using the §5.5 matrix, then advances `half`/`exchange`; ends on KO or after exchange 3 (`BattleEnded` with `result: 'aWin'|'bWin'|'draw'`), then calls `onBattleEnd(state, result)` which Task 6/7 implement (this task: monster rewards + KO penalty only).
  - Monster/town-guardian picks are drawn inside the engine from rng (monsters: 60% attack / 40% strike when attacking; 50/50 defend/counter when defending; never secret).
- Matrix (attacker pick × defender pick): attack×defend = ×0.5 to defender; attack×counter = ×1.0 to defender; strike×defend = ×1.5 to defender; strike×counter = attacker takes its own strike ×1.0, defender unharmed. Secret (either side) skips the matrix: Bulwark → the knight takes 0 this half and reflects 50% of the incoming damage the matrix would have produced with `attack×counter`; Pickpocket → steal 15% of target gold (0 vs monsters) then resolve as `attack×counter`; Firestorm → `damage(mag, def, 2, v)` ignoring the defender's pick; Sanctuary → heal 40% maxHp and set `halveNext`. A secret used as the defender replaces the defense. `secretUsed` blocks a second use; `legalActions` must not offer it.
- Rewards: monster win → XP + gold (`GoldGained`, `XpGained`), check level-up (Task 6 adds `levelUp` phase; here just add XP). Player KO'd (by monster/guardian/pvp) → lose `deathGoldLossPct`% gold, pos = castle, hp = maxHp, `skipTurns += 1`, `stats.kos[seat]++`.

- [ ] **Step 1: Failing tests** — use a `fixtureBattle()` helper that builds a state with fixed stats and a fixed rng seed. Assert: each of the 4 matrix cells produces the documented damage with variance forced to 1 (export `resolveHalf(attacker, defender, atkPick, defPick, variance)` as a pure helper for this); `damage` floors at 1; each secret's effect; secret is not offered twice; battle ends after 3 exchanges as `draw` with no rewards; KO applies the penalty (gold −20%, castle, skip 1); higher SPD attacks first.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(engine): battle system`.

---

### Task 6: Spaces, towns, shop, items, leveling

**Files:** Create `src/rules/spaces.ts`, `src/rules/towns.ts`, `src/rules/items.ts`, `src/rules/leveling.ts`; Modify `src/rules/movement.ts` (replace the Task-4 stub with `resolveSpace`); Test `test/spaces.test.ts`, `test/items.test.ts`, `test/leveling.test.ts`

**Interfaces:**
- Produces: `resolveSpace(state, seat): StepResult`; `collectTaxes(state, seat): StepResult` (called at turn start; `townTaxPct`% of each owned town value, ×2 in Frenzy, 0 during rounds 1–4 with Tax Holiday); `grantXp(state, seat, xp): StepResult` (sets `levelUp` phase with 3 distinct random perks from `PERKS`; full heal; stat growth from class; cap 15); `useItem(state, seat, item, target): StepResult`; `shopStock(state, spaceId): string[]` (6 items weighted by region tier; Black Market adds 1 random tier-3 equipment).
- Space behavior (§5.2): castle → full heal (50% with Cursed Capital); town unowned → `startBattle` vs guardian at `guardianLevel` (win: owner = seat, `TownClaimed`); own → `townManage` (`invest` costs `investCost`, value += `investValuePct`%); enemy → `townChallenge` (`attackTown` fights a guardian scaled to value: level = 2 + value/100; win transfers ownership, `stats.townFlips[id]++`); shop → `shop` phase; chest → gold `nextInt(chestGold)` (×2 Gold Rush, ×1.5 scavenger) or 30% chance a random tier-1/2 item if inventory not full; monster → `startBattle` vs regional monster; event → one of 6 events (gain 50–150 G, lose 10% G, heal, teleport to random town, free item, everyone else loses 5% G to you); trap → lose `trapGoldLossPct`% gold, and with `trapSkipChance` skip next turn; player-placed traps (`trapCard`) trigger for anyone except the placer.
- Inventory max 6: buying/receiving with a full inventory is illegal / converts to 50% resale gold (`ItemAutoSold`).

- [ ] **Step 1: Failing tests** for each space kind with fixture states; tax math incl. Frenzy ×2 and Tax Holiday; invest; seizing an enemy town updates owner + townFlips; shop buy/sell prices (sell = `resaleRatio`); haggler discount; full inventory; each field and battle item effect; level-up offers 3 distinct perks, applies growth, heals, respects cap.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(engine): spaces, towns, shop, items and leveling`.

---

### Task 7: PvP outcomes, underdog rule, world rules, Final Frenzy, endgame

**Files:** Create `src/rules/pvp.ts`, `src/rules/underdog.ts`, `src/rules/endgame.ts`; Modify `src/step.ts`, `src/rules/battle.ts` (`onBattleEnd` for pvp); Test `test/pvp.test.ts`, `test/underdog.test.ts`, `test/endgame.test.ts`

**Interfaces:**
- Produces: `netWorth(state, seat): number` = gold + Σ(item price × resaleRatio, incl. equipment) + Σ owned town values; `leader(state): number` (highest net worth, tie → lower seat); `applyPvpReward(state, action): StepResult`; `startOfRound(state): StepResult` (underdog card grant, bounty expiry, prank expiry, `FrenzyStarted` event at round `frenzyFromRound`); `finishGame(state): StepResult` (ranking by net worth → towns → level → shared; highlights: `biggestRobbery` (max `stats.robbedGold`), `mostKod` (max `stats.kos`), `hotTown` (max `stats.townFlips`)).
- PvP (§5.5): winner gets phase `pvpReward` with legal options: `rob` (30%, or 40% with looter), `loot` (one item the loser holds; illegal if none), `seize` (one loser town; illegal if none), `prank` (alias from `PRANK_ALIASES`, lasts `prankRounds`). Both players' `grudges` updated (loser's grudge vs winner += amount). Bounty: if the bounty target is KO'd by a player within the window, that player gets `bountyGold`.
- Underdog (§5.6): at round start, lowest net worth seat (tie → higher seat index) gets a random Bandit Card if holding < 2 and it is not also the leader. `pickpocketFar`: steal `pickpocketFarPct`% of the leader's gold; `cursedLegs`: leader `rollCap = 3` for their next roll; `bounty`: set `state.bounty = { target: leader, untilRound: round + 2 }`. Bandit Cards are legal only in `awaitRoll` and always target the current leader; illegal when the user is the leader.

- [ ] **Step 1: Failing tests** for each PvP reward incl. illegal cases; grudge update; underdog grant conditions and card effects; bounty payout and expiry; Frenzy multiplier applied to tax and rewards from round 10; prank expiry after 3 rounds; net-worth formula; ranking tie-breaks; highlights present.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(engine): pvp, underdog, world rules and endgame`.

---

### Task 8: Bots and balance simulator

**Files:** Create `src/bots/index.ts`, `src/bots/scoring.ts`, `src/sim.ts`; Test `test/bots.test.ts`, `test/sim.test.ts`

**Interfaces:**
- Produces: `chooseAction(state: GameState, seat: number): Action` — draws noise from a **separate** rng derived from `seedRng(\`${state.config.seed}:${state.round}:${seat}:${phaseKey}\`)` so bot choices never consume game rng; always returns an element of `legalActions(state, seat)` (or a legal `battlePick` for its side). `runSimulation(opts: { games: number; seedPrefix: string; players: 2|3|4 }): SimReport` with `SimReport = { games; crashes; stuck; avgRounds; classWinRate: Record<ClassId, number>; comebackRate: number; seatWinRate: number[] }`. `comebackRate` = share of games won by the player who was last in net worth at the end of round 6.
- Scoring weights per personality (§5.10) in `scoring.ts` as a plain object; `greedy` weights chest/town/rob high, `vengeful` weights actions against its top-grudge seat, `cowardly` penalizes duels/strong monsters and prefers invest/defend. Noise ±10%.
- CLI: `npm run sim -- --games 1000 --players 4` prints the report JSON and exits non-zero if any threshold fails: crashes = 0, stuck = 0, every class win rate in [0.15, 0.35], comebackRate ≥ 0.08. A game is `stuck` if it exceeds 5,000 steps.

- [ ] **Step 1: Failing tests**: bots only return legal actions across 200 random states sampled from simulated games; each personality differs in at least one decision on a crafted state; `runSimulation({games: 50, seedPrefix: 'ci', players: 4})` reports 0 crashes and 0 stuck and every game's final phase is `gameOver`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Balance pass.** Run `npm run sim -- --games 1000 --players 4`. If thresholds fail, tune **only** `data/*.json` values (class stats, secret multipliers, underdog percentages), re-run, and record each iteration's report in `docs/balance-log.md` (date, change, result). Stop after thresholds pass. If 8 tuning iterations do not pass, stop and report to Sol with the log instead of changing rules.
- [ ] **Step 6: Add to CI** after `npm test`: `- run: npm run sim -- --games 200 --players 4`.
- [ ] **Step 7: Commit** `feat(engine): rule-based bots and balance simulator`.

---

### Task 9: Pixelize pipeline and prototype sprites

**Files:** Create `tools/pixelize/{pixelize.ts,palette.json,crops.json,README.md}`, `apps/client/public/sprites/*.png`; Test `tools/pixelize/pixelize.test.ts` (run via root vitest workspace or `npx vitest run tools/pixelize`)

**Interfaces:**
- Produces sprite files consumed by Task 11/12: `hero-{knight,thief,mage,cleric}.png` (32×32), `hero-{class}-portrait.png` (48×48), `monster-{id}.png` (32×32, golem/mimic 48×48), `icons.png` (16×16 sheet: coin, sword, question, chest, heart, skull, shop, castle, town, trap, crown, hat) with `icons.json` frame map, `tiles-{region}.png` (32×32 ground tile per region).
- CLI: `npx tsx tools/pixelize/pixelize.ts --config tools/pixelize/crops.json --out apps/client/public/sprites`.
- Pipeline per crop: `sharp` extract rect from `docs/concepts/*.png` → flood-remove the flat gray background to alpha (tolerance 18) → resize to target with `kernel: 'nearest'` after an area-average pre-shrink to 2× target → map each pixel to the nearest palette color (RGB Euclidean) → alpha threshold 128 (no semi-transparency) → PNG.
- `palette.json`: 32 hex colors sampled from `style_16bit.png` (k-means on a downscaled copy, done once by the script with `--extract-palette`, then committed and frozen).
- Icons with no good concept crop are drawn as tiny 16×16 pixel matrices in `tools/pixelize/icons/*.txt` (palette indices), rendered by the same script.

- [ ] **Step 1: Failing test**: output PNGs have exact target dimensions; every opaque pixel color ∈ palette; alpha values ∈ {0, 255}.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** script, extract + commit palette, author `crops.json` by inspecting concept images (record pixel rects).
- [ ] **Step 4: Run** tests → PASS; view a contact sheet of all outputs (script writes `tools/pixelize/contact-sheet.png`, gitignored) with the vision tool and fix crops that are unreadable.
- [ ] **Step 5: Commit** `feat(art): pixelize pipeline and prototype sprites`.

---

### Task 10: Client scaffold, Cloudflare config, i18n, fonts, title/setup, save

**Files:** Create `apps/client/{package.json,tsconfig.json,vite.config.ts,wrangler.jsonc,index.html}`, `src/{main.ts,save.ts,testHooks.ts}`, `src/i18n/{index.ts,th.json,en.json}`, `src/ui/{screens.ts,styles.css}`; Test `apps/client/test/{i18n.test.ts,save.test.ts}`

**Interfaces:**
- Consumes: `@dice-bandits/engine` (`createGame`, types, `ITEMS`, `PERKS`, `WORLD_RULES`, `PRANK_ALIASES`).
- Produces: `t(key: string, params?: Record<string, string|number>): string`, `setLang(lang: 'th'|'en')`, `getLang()`, `onLangChange(cb)`; `saveGame(state)`, `loadGame(): GameState | null` (returns null + emits toast key `toast.saveDiscarded` on version mismatch or parse error), `clearSave()`; `showTitle()`, `showSetup(onStart: (cfg: GameConfig) => void)`; `testHooks: { enabled: boolean; seed: string | null; speed: number }`.
- `apps/client/package.json` deps (exact): `phaser@4.2.1`, `@fontsource/chakra-petch@5.3.0`, `@fontsource/press-start-2p@5.3.0`; devDeps: `vite@8.3.1`, `@cloudflare/vite-plugin@1.60.2`, `wrangler@4.141.0`, `vitest@5.0.2`, `@playwright/test@1.63.0`, `happy-dom` (pin current). Scripts: `dev` (`vite`), `build` (`vite build`), `preview` (`vite preview`), `typecheck` (`tsc -p tsconfig.json`), `test` (`vitest run`), `e2e` (`playwright test`), `deploy` (`vite build && wrangler deploy`).
- `vite.config.ts`: `plugins: [cloudflare()]` from `@cloudflare/vite-plugin`. `wrangler.jsonc`:
```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "dice-bandits",
  "compatibility_date": "2026-09-27",
  "assets": { "not_found_handling": "single-page-application" }
}
```
- Before coding, re-run the docs gate for `@cloudflare/vite-plugin` assets-only config (cloudflare-docs MCP) and Phaser 4 game config (Context7) and note any differences in the commit body.
- Setup screen: 4 seat rows (Human / Bot / Empty; name; class picker with portrait; personality for bots); needs ≥ 2 non-empty seats and ≥ 1 human; Start button; language toggle TH/EN on every screen; Continue button on title only when `loadGame()` is non-null.
- Fonts: import `@fontsource/chakra-petch/{400,700}.css` (includes Thai subset) and `@fontsource/press-start-2p/400.css` in `main.ts`; DOM body uses Chakra Petch; numbers/titles class `.pixel` uses Press Start 2P.
- Default language: `localStorage.lang` else `navigator.language.startsWith('th') ? 'th' : 'en'`.

- [ ] **Step 1: Failing tests**: `th.json` and `en.json` have identical key sets and no empty values; `t()` interpolates `{name}`; every item/perk/world-rule/prank/event key used by the engine data has an entry (iterate engine data ids); `saveGame`/`loadGame` round-trip; version mismatch → `null` and the save is cleared (use happy-dom `localStorage`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (write all Thai strings natively, not machine-literal; keep them short for 640×360).
- [ ] **Step 4: Run** `npm test -w @dice-bandits/client && npm run build -w @dice-bandits/client` → PASS; `npm run dev -w @dice-bandits/client` and open with `playwright-cli` to confirm title + setup render in both languages (exploration only).
- [ ] **Step 5: Commit** `feat(client): scaffold, cloudflare config, i18n, title and setup`.

---

### Task 11: Board scene, HUD, GameController, bot turns

**Files:** Create `src/controller.ts`, `src/scenes/{BootScene,BoardScene}.ts`, `src/ui/{hud.ts,dialogs.ts}`, `src/fx.ts`; Modify `src/main.ts`; Test `apps/client/test/controller.test.ts`

**Interfaces:**
- Produces:
```ts
export class GameController {
  constructor(opts: { state: GameState; speed: number; onEvents: (ev: GameEvent[], s: GameState) => Promise<void> });
  get state(): GameState;
  dispatch(action: Action): Promise<void>;       // step → autosave → await onEvents → runBotsIfNeeded
  isHumanTurn(): boolean;
  pendingHumanSides(): Array<{ seat: number; side: 'a' | 'b' }>; // for battle picks
}
```
  `runBotsIfNeeded` loops while the acting seat (or pending battle side) is a bot: `await delay(rand(400,900) * speed)` then `dispatch(chooseAction(...))`. Errors from `step` are logged (`console.error`) and state is left unchanged.
- `BoardScene`: renders spaces from `state.board` (region tile + kind icon), town ownership flags in seat colors, player tokens (sprites; multiple on one space fan out), leader crown, prank hat, current-player highlight; camera fixed (board fits 640×300, HUD strip 60 px). Animates `Moved` events with a hop per space (`fx.hop`), `DiceRolled` with a dice tumble (`fx.dice`), `GoldStolen` with a coin burst, `FrenzyStarted` with banner + shake. All tween durations × `speed` (speed 0 ⇒ instant).
- HUD (DOM): per seat — portrait, display name (prank alias if active), gold, level, HP bar, town count, bandit cards; round `x/12`; world rule chip; action bar showing only legal actions for the human seat (`Roll`, items, bandit cards, branch arrows, duel/skip, invest/attack/leave, shop list, end turn). Buttons carry `data-testid="action-<type>"` (and `-<id>` suffix for item/branch/target variants).

- [ ] **Step 1: Failing controller tests** (engine real, `onEvents` resolves immediately, speed 0): a 1-human + 3-bot game where the human always picks the first legal action reaches `gameOver`; after each `dispatch`, `loadGame()` equals `controller.state`; bots never cause `IllegalActionError`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** controller, scenes, HUD, fx.
- [ ] **Step 4: Run** tests → PASS; explore with `playwright-cli` at `?seed=demo&speed=1` (test-hooks build) and take desktop + mobile-landscape screenshots; check with the vision tool that the board, tokens and HUD are readable and not overlapping.
- [ ] **Step 5: Commit** `feat(client): board scene, HUD and game controller`.

---

### Task 12: Battle UI, pass-the-device, PvP rewards, level-up, results, rotate hint

**Files:** Create `src/scenes/BattleScene.ts`, `src/ui/{battleUi.ts,passDevice.ts,results.ts}`; Modify `src/controller.ts`, `src/ui/hud.ts`, `src/main.ts`; Test `apps/client/test/passDevice.test.ts`

**Interfaces:**
- `BattleScene` (launched over the board on `battle` phase): two combatant sprites, HP bars, exchange counter, damage numbers, hit flash + short hit-stop + shake, secret move reveal ("?" card flips).
- Battle picks (DOM): attacker sees Attack / Strike / Secret; defender sees Defend / Counter / Secret; Secret hidden after use; `data-testid="pick-<pick>"`.
- `passDevice.ts`: `needsPassScreen(state, side): boolean` — true when both battle sides are **human** seats (hot-seat PvP) — shows a full-screen "Pass the device to {name}" with a Ready button (`data-testid="pass-ready"`) before each side picks, and hides the previous pick.
- PvP reward dialog (Rob / Loot [item list] / Seize [town list] / Prank [alias list]); level-up perk picker (3 cards); shop dialog; results screen with ranking, net worth, 3 highlights, "Play again" and "Title" (`data-testid="results"`). Starting a new game clears the save.
- Rotate hint: CSS media query `(orientation: portrait) and (max-width: 900px)` shows `[data-testid="rotate-hint"]` over the game.

- [ ] **Step 1: Failing tests**: `needsPassScreen` true only for human-vs-human battles; results model built from a finished engine state lists all seats in ranking order with highlights.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; explore a seeded 2-human game with `playwright-cli` through one PvP battle; screenshot the pass screen, battle and results in TH and EN; vision-check readability.
- [ ] **Step 5: Commit** `feat(client): battle UI, hot-seat pass screen, rewards and results`.

---

### Task 13: Playwright E2E suite and CI

**Files:** Create `apps/client/playwright.config.ts`, `apps/client/e2e/{full-game,i18n,continue,rotate}.spec.ts`; Modify `.github/workflows/ci.yml`

**Interfaces:**
- `playwright.config.ts`: `webServer` = `VITE_TEST_HOOKS=1 npm run build && npm run preview -- --port 4173 --strictPort`, `url: 'http://localhost:4173'`, `reuseExistingServer: !process.env.CI`; projects `desktop` (Chromium 1280×720) and `mobile-landscape` (Chromium, viewport 915×412, `isMobile: true`, `hasTouch: true`); `retries: process.env.CI ? 1 : 0`; `trace: 'retain-on-failure'`.
- Journeys:
  - `full-game.spec.ts`: open `/?seed=e2e-1&speed=0` → setup 1 human (knight) + 3 bots → Start → loop: while `[data-testid="results"]` not visible, click the first visible enabled `[data-testid^="action-"]`, `[data-testid^="pick-"]`, perk/reward/pass button (helper `playOneStep(page)`), max 3,000 iterations → expect results visible with 4 ranked rows; assert `await page.evaluate(() => window.__db.getState().phase.kind) === 'gameOver'`.
  - `i18n.spec.ts`: toggle EN→TH on title and in-game; expect a known label to change (e.g. start button text from `en.json` → `th.json`).
  - `continue.spec.ts`: play 5 steps, reload, click Continue, expect `getState()` round/turnSeat equal pre-reload values.
  - `rotate.spec.ts` (mobile project only): set portrait viewport 412×915 → rotate hint visible; landscape → hidden.
- CI: add a job step after build: `npx playwright install --with-deps chromium` then `npm run e2e`; upload `playwright-report` as an artifact on failure.

- [ ] **Step 1: Write the specs** (they fail if any earlier behavior is missing — run them now: `npm run e2e`).
- [ ] **Step 2: Fix any real defects** found (in the owning module, with a unit test when it is engine logic). Do not weaken assertions.
- [ ] **Step 3: Run** `npm run typecheck && npm run lint && npm run format:check && npm test && npm run sim -- --games 200 --players 4 && npm run build && npm run e2e` → all PASS; record counts.
- [ ] **Step 4: Commit + push**, `gh run watch` → CI green.
- [ ] **Step 5: Commit message** `test(e2e): full-game, i18n, continue and rotate journeys in CI`.

---

### Task 14: Deploy to Cloudflare and live smoke test (owner approval required)

**Files:** Modify `README.md` (live URL, how to play, dev commands)

- [ ] **Step 1: Stop and ask the owner** for deploy approval, showing the CI run URL and test counts. Do not proceed without an explicit yes.
- [ ] **Step 2: Auth check** — `npx wrangler whoami` in `apps/client`. If not logged in, use the Cloudflare MCP (`cloudflare-api`) read-only to confirm the account id and ask the owner how to authenticate Wrangler (OAuth `wrangler login` on this machine, or an API token in an env var) — never paste tokens into chat or commit them.
- [ ] **Step 3: Deploy** — `npm run deploy` (production build **without** `VITE_TEST_HOOKS`). Record the printed `https://dice-bandits.<subdomain>.workers.dev` URL.
- [ ] **Step 4: Live smoke** with `web-ui-verification` + `playwright-cli`: load URL on desktop and mobile landscape; title renders in TH and EN; start 1 human + 3 bots; play several turns including one battle; reload → Continue works; deep link `/anything` serves the SPA; confirm `window.__db` is **undefined** in production. Screenshot evidence.
- [ ] **Step 5: README** — add the live URL and commands; commit `docs: live URL and how to play`; push; CI green.

---

## Self-Review (done while writing)

- **Spec coverage:** §3 scope → Tasks 4–12; §4 architecture → Tasks 1, 4, 10, 11; §5.1 → T4; §5.2 → T3/T6; §5.3 → T4; §5.4 → T2/T5/T6; §5.5 → T5/T7; §5.6 → T6/T7; §5.7 → T2/T6; §5.8 → T2/T6/T7; §5.9 → T7/T12; §5.10 → T8; §6 → T9–T12; §7 → T4 (illegal action), T10 (corrupt save), T11 (asset/step errors); §8 → T1, T8, T13; §9 → T13/T14; §11 hot-seat risk → T12.
- **Asset load failure (§7):** handled in Task 11 `BootScene` — on `loaderror` show a DOM error panel with Retry (`data-testid="asset-error"`) that reloads the page.
- **Type consistency:** `Action`, `Phase`, `BattleState`, `GameEvent`, `StepResult`, `chooseAction`, `legalActions`, `GameController.dispatch` names match across tasks. `stats.kos` is the single KO counter.
