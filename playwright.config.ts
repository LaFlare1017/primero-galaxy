import { defineConfig } from '@playwright/test';
import { workerCount } from './e2e/workers';

/**
 * E2E tests for the Primero Galaxy 3D experience.
 *
 * The suite runs against a production build (`next start`) so there is no
 * HMR/dev-recompile flakiness. The build is isolated to `.next-e2e` via
 * NEXT_E2E_DIST_DIR so it never touches the dev server's `.next` (dev and prod
 * would otherwise clobber each other in a shared checkout).
 *
 * There is no `webServer` here any more, and that is the change that let the
 * suite run wide. Playwright starts every entry in a `webServer` array before
 * any worker exists, so there is no `parallelIndex` to give each worker a port
 * and a store by — and `use.baseURL` is one value for the whole run, so two
 * files at once would share one room. Thirteen of these specs reason about the
 * room as a whole, so sharing it was never safe; the old answer was `workers: 1`,
 * which cost the suite all of its parallelism. The server is now started per
 * worker, by `e2e/worker-server.ts`, which can do the one thing `webServer`
 * cannot: key a port and a `DELEGATE_DATA_DIR` on the worker that is running.
 * The build it serves is made once, in `globalSetup`, before any worker starts.
 */
export default defineConfig({
  testDir: './e2e',
  // Empties the suite's scratch store on every run, INCLUDING one that reuses a
  // server someone else started. That is the whole reason it is not in the
  // webServer command below: Playwright skips that command when it reuses a
  // server, so a clear living there leaves the room carrying every row of every
  // previous run — which is how nine facilitator specs failed here with a
  // shifting set, the grid's 200-row window hiding freshly seeded rows and the
  // walk tests racing it. See e2e/global-setup.ts.
  globalSetup: './e2e/global-setup.ts',
  // Headroom for slow teardown: closing the browser context in software
  // WebGL can outlast a 90s budget on a loaded machine.
  timeout: 150_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  // Playwright parallelises by FILE, so one file is always one worker, and
  // tests inside a file still share that worker's room and run in order.
  //
  // This is the machine's width, not 1. It was 1 because thirteen of these
  // specs share ONE store and reason about it as a whole — the first and last
  // row, the count in the sweep's `N of M`, what a status facet leaves visible —
  // so a second worker would have put their rows in each other's room and the
  // failures would read as console bugs. Each worker now gets its own server and
  // its own `DELEGATE_DATA_DIR` (see `e2e/worker-server.ts`), which is what
  // makes a number above 1 mean anything. `E2E_WORKERS=1` is still the serial
  // run, for when a failure needs to be reproduced without four other files
  // competing for the machine.
  workers: workerCount(),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never' }],
        // Machine-readable run for scripts/flaky-report.mjs: on CI a flaky
        // test PASSES (retries), so the failure-only artifacts would never
        // show it. The JSON report marks it `flaky` and the workflow
        // surfaces the count in the job summary.
        ['json', { outputFile: 'test-results/results.json' }],
      ]
    : [['list']],
  use: {
    // The port every worker uses is set per worker, by a fixture that knows its
    // own `parallelIndex`. This value is only what a test sees if it somehow
    // escapes that fixture, so it stays the first worker's port rather than
    // being absent.
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    // Forensics for the flakes the retries smooth over: record traces on
    // RETRY attempts only, so a stable run pays nothing and a flaky test
    // ships the trace of the attempt that failed.
    trace: process.env.CI ? 'on-all-retries' : 'retain-on-failure',
  },
});
