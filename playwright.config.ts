import { defineConfig } from '@playwright/test';

/**
 * E2E tests for the Primero Galaxy 3D experience.
 *
 * The suite runs against a production build (`next start`) so there is no
 * HMR/dev-recompile flakiness: `npm run build && npm run start -- -p 3100`.
 * Point `reuseExistingServer` at a server you started yourself to skip the
 * rebuild for local iteration.
 *
 * The build is isolated to `.next-e2e` via NEXT_E2E_DIST_DIR so it never
 * touches the dev server's `.next` (dev and prod would otherwise clobber
 * each other in a shared checkout).
 */
export default defineConfig({
  testDir: './e2e',
  // Headroom for slow teardown: closing the browser context in software
  // WebGL can outlast a 90s budget on a loaded machine.
  timeout: 150_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'NEXT_E2E_DIST_DIR=.next-e2e npm run build && NEXT_E2E_DIST_DIR=.next-e2e npm run start -- -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
