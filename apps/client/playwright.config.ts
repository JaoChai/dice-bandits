import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Local agent commands have a 4 GiB memory cap; CPU-based defaults choose 10 workers.
  // Measured 10/6 workers: memory.events max +7024/+774, socket throttles +20469/+1867,
  // minimum FPS 7.44/20.14. At 4/2: both counters +0, minimum FPS 59.5.
  // Four workers still had a network failure; use the verified two-worker budget locally.
  // Preserve Playwright's default parallelism in CI (RCA: PR #40).
  workers: process.env.CI ? undefined : 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    storageState: 'e2e/storage-state.json',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'mobile-landscape',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 915, height: 412 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: 'npm run preview -- --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        'node e2e/e2e-wrangler-config.mjs && npx wrangler dev --config dist/dice_bandits/wrangler.e2e.json --var ROOM_IDLE_MS:15000 --port 8787 --ip 127.0.0.1',
      url: 'http://127.0.0.1:8787/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
