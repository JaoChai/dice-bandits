# Dice Bandits (โจรลูกเต๋า)

Browser party board-RPG in the spirit of Dokapon Kingdom — roll, rob, and betray your friends.
Runs entirely on Cloudflare.

**Play now:** https://dice-bandits.anugooltippon.workers.dev

- Design: [`docs/superpowers/specs/2026-09-27-dice-bandits-m1-design.md`](docs/superpowers/specs/2026-09-27-dice-bandits-m1-design.md)
- Concept art (reference only): [`docs/concepts/`](docs/concepts/)

## How to play (M1)

1. Open the link on a desktop or a phone in landscape. Switch language with **TH / EN**.
2. **New game** → set up 2–4 seats. Each seat is **Human**, **Bot** or **Empty**, with a
   name and a class. At least one seat must be human.
3. Humans share one device (hot-seat). When two humans fight, the game asks you to
   pass the device before each pick so the moves stay secret.
4. Roll, move, fight monsters, shop, take towns and rob each other. After 12 rounds the
   player with the highest net worth wins.
5. The game saves in the browser. Reload and press **Continue** to carry on.

## Development

Requires Node.js 24 or newer.

```sh
npm ci
npm run dev -w @dice-bandits/client    # local dev server (Vite)
npm run typecheck && npm run lint && npm run format:check
npm test                                # unit tests, all workspaces
npm run sim -- --games 200 --players 4  # bot-only simulation
npm run build
npm run e2e                             # Playwright end-to-end tests
```

## Deploy

Every push to `main` runs CI (`.github/workflows/ci.yml`). After the `checks` job
passes, the `deploy` job runs `npm run deploy` (Wrangler) to the Cloudflare Worker
`dice-bandits`, which is bound to the D1 database `dice-bandits`. The job needs the
repository secret `CLOUDFLARE_API_TOKEN`. Health check: `/api/health`.
