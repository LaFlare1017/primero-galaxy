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
  workers: 1,
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
    baseURL: 'http://localhost:3100',
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    // Forensics for the flakes the retries smooth over: record traces on
    // RETRY attempts only, so a stable run pays nothing and a flaky test
    // ships the trace of the attempt that failed.
    trace: process.env.CI ? 'on-all-retries' : 'retain-on-failure',
  },
  webServer: {
    // No `rm -rf` here on purpose — the suite's store is emptied by the
    // globalSetup above, which runs whether or not this command does. Leaving
    // the clear in two places would make it possible to move one and not the
    // other, which is the bug being fixed.
    command: 'NEXT_E2E_DIST_DIR=.next-e2e npm run build && NEXT_E2E_DIST_DIR=.next-e2e npm run start -- -p 3100',
    url: 'http://localhost:3100',
    // The suite owns its own workshop store. The delegate API reads these
    // JSON files fresh on every request and its data dir is overridable
    // (delegate/src/paths.ts exists for exactly this), so the server is
    // pointed at a scratch dir under the ignored .next-e2e/ — emptied by
    // globalSetup — and a run starts with an empty room holding only the rows
    // the run itself seeded. That is what lets the console cap what it renders
    // (see GRID_WINDOW in app/delegate/facilitator/page.tsx) without ever
    // hiding a spec's own row. Before this, the suite wrote into
    // delegate/data/, the store a facilitator opens in dev: 2651 accumulated
    // runs, most of them seeded by e2e, sitting past the grid's first page —
    // real participants the console no longer renders, and specs looking for a
    // row they had just created.
    env: { DELEGATE_DATA_DIR: '.next-e2e/delegate-data' },
    // OPT-IN, and the default used to be "yes, reuse whatever is on :3100".
    // That inherited two things nobody could see: the build that server was
    // started from (so a run could test code hours older than the source tree,
    // failing as behaviour rather than as setup), and its store — which, for a
    // server started without this suite's DELEGATE_DATA_DIR, is
    // delegate/data/ itself, the room a facilitator opens in dev. Reuse is
    // worth it for local iteration, so it is one env var away:
    //
    //   E2E_REUSE=1 npm run test:e2e
    //
    // …and only against a server started the way this config starts one. With
    // reuse off, a port that is already in use fails immediately and says so,
    // which is a better outcome than nine timeouts an hour later.
    reuseExistingServer: process.env.E2E_REUSE === '1',
    timeout: 300_000,
  },
});
