import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: '../../apps/client/wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
