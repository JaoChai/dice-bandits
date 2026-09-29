// Test-only. The online E2E creates many rooms and sockets from one IP (127.0.0.1)
// within seconds, so back-to-back local runs trip the production rate limits.
// Write a copy of the built Worker config with raised limits for the E2E server only;
// the deployed config (dist/dice_bandits/wrangler.json) is left untouched.
import { readFileSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';

const dir = new URL('../dist/dice_bandits/', import.meta.url);
const config = JSON.parse(readFileSync(new URL('wrangler.json', dir), 'utf8'));
for (const limiter of config.ratelimits ?? []) limiter.simple.limit = 100_000;
writeFileSync(new URL('wrangler.e2e.json', dir), JSON.stringify(config));
