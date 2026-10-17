import { test as base, type BrowserContext } from '@playwright/test';

export const test = base.extend<{ guestContext: BrowserContext }>({
  guestContext: async ({ browser, page }, use, info) => {
    const guestContext = await browser.newContext({
      storageState: 'e2e/storage-state.json',
      viewport: info.project.use.viewport,
    });
    try {
      await use(guestContext);
    } finally {
      // Context.close exports its trace BEFORE closing its pages. Stop both
      // canvases first so the host cannot keep recording during guest export.
      // Fixture teardown runs after afterEach: retain-on-failure can discard
      // successful chunks without archiving them, and still keeps failures.
      try {
        await Promise.all([page, ...guestContext.pages()].map((page) => page.close()));
      } finally {
        await guestContext.close();
      }
    }
  },
});
