import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: '../../apps/client/wrangler.jsonc' },
      miniflare: { bindings: { ROOM_IDLE_MS: '50', ROOM_TTL_MS: '500' } },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
