/**
 * One server and one store per Playwright worker.
 *
 * Why this file exists at all: thirteen of the suite's specs reason about "the
 * room" as a whole — the first and last row, the count in the sweep's `N of M`,
 * the rows a status facet leaves visible, the page the walk lands on. Those are
 * only answerable if nothing else is writing to the room while they look at it.
 * The suite answered that by running one file at a time against one server
 * against one store, which cost the entire suite its parallelism: the galaxy
 * specs were once a single 22-test file that took fifteen minutes, and splitting
 * it into four could not buy anything while `workers` was pinned at 1.
 *
 * So isolation moves down a level, from the run to the worker. Each worker gets
 * its own `next start` on its own port, serving its own `DELEGATE_DATA_DIR`.
 * Two files running at once cannot see each other's rows, so the assertions that
 * depend on the room's contents are exactly as true as they were — and now they
 * are true per file rather than per run, which is what their own comments always
 * claimed to assume.
 *
 * `webServer` could not do this. Playwright starts every entry in a `webServer`
 * array before any worker exists, so there is no `parallelIndex` to key a port
 * by, and `use.baseURL` is one value for the whole run. What can is a
 * worker-scoped fixture: it receives `workerInfo.parallelIndex` — the same
 * number that decides which file this worker is running — and overrides
 * `baseURL`, which `use` options allow a fixture to override. So the mapping from
 * worker to port is made where the worker exists, not where it does not.
 * * That is also why the build moved to `globalSetup`: the old `webServer.command`
 * was `build && start`, and a build per worker would rebuild the same bundle
 * N times over. It now happens once, before any worker starts, and the only
 * thing a worker does is start a server against the build that is already
 * there.
 *
 * Two files pay for a server they never talk to: the cold specs start their own
 * pair, but they still reach for `page.request`, which sets up `page` and with it
 * `baseURL` and this fixture. That is one extra `next start` per cold file, and
 * it is left alone deliberately — a way to exempt them is a way for the suite to
 * disagree with itself about which specs have a room, and a cold spec is exactly
 * where an unexpected store would be hardest to notice.
 *
 * What this does NOT fix, and what `E2E_REUSE=1` used to paper over: a server
 * somebody started themselves, without this worker's `DELEGATE_DATA_DIR`, is
 * serving a different store — `delegate/data/`, the room a facilitator opens in
 * dev — and no amount of clearing the suite's own directories changes that.
 *
 * That flag is gone with the `webServer` it configured, and losing it is the
 * honest cost of this change rather than an oversight. Reuse meant "don't
 * rebuild", and it could not mean "don't start a server" — the whole point here
 * is that each worker starts its own, on a port chosen at that moment, against a
 * store chosen by that worker's index. A reused server has no way to be that
 * worker's server. What is left is the build, which `globalSetup` now does once
 * unconditionally, so the expensive part of a local iteration still happens
 * exactly once and the failure it used to cause (a reused server serving a
 * hours-old bundle, surfacing as a behavioural failure about a fix that is in
 * the source tree) can no longer happen at all.
 */
import { test as base, expect } from '@playwright/test';
import { mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { COLD_DIST, startServerOnAnyPort, stopServer, type ManagedServer } from './cold-process';

/** The build every worker's server runs, built once by `globalSetup`. */
export { COLD_DIST };

/**
 * Where worker N keeps its room. Indexed by `parallelIndex`, so a worker's store
 * is a function of the worker and not of which file it happens to be running —
 * the two are different lifetimes, and keying the directory on the file would
 * make the room outlive its worker and leak into whichever file came next.
 */
export function workerDataDir(shard: number): string {
  return `${COLD_DIST}/delegate-data-w${shard}`;
}

/** The scratch root, absolute, for the specs that read a store off disk. */
export function workerStorePath(shard: number): string {
  return resolve(process.cwd(), workerDataDir(shard));
}

export interface WorkerServer {
  /** The worker's own server. */
  url: string;
  /** Its room, as a path relative to the repo root. */
  dataDir: string;
  /** `parallelIndex`, and the number every other per-worker thing keys on. */
  shard: number;
  server: ManagedServer | null;
}

/**
 * What the worker scope adds. Both live in the SECOND type parameter — the
 * worker-scoped half of `extend` — because a test fixture cannot be declared
 * worker-scoped: the types and the runtime disagree, and the disagreement is a
 * compile error rather than a fixture that quietly outlives its worker.
 */
interface WorkerFixtures {
  shard: number;
  workerServer: WorkerServer;
}

/**
 * The suite's `test`, with the per-worker server attached.
 *
 * Every spec imports from here rather than from `@playwright/test` directly, and
 * that is the whole coupling this design has: one import line per file. A spec
 * that imported the bare `test` would get the config's `baseURL` — a port no
 * worker is ever given — and fail to connect at its first `page.goto`, which
 * names the mistake rather than looking like a console bug.
 */
export const test = base.extend<{}, WorkerFixtures>({
  // The number every other per-worker thing is derived from, hoisted out so the
  // server fixture can depend on it without re-reading `workerInfo`.
  shard: [
    async ({}, use, workerInfo) => {
      await use(workerInfo.parallelIndex);
    },
    { scope: 'worker' },
  ],

  workerServer: [
    async ({ shard }, use) => {
      const dataDir = workerDataDir(shard);
      const dir = resolve(process.cwd(), dataDir);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });

      let server: ManagedServer | null = null;
      try {
        server = await startServerOnAnyPort(dataDir);
        await use({ url: server.url, dataDir, shard, server });
      } finally {
        // Stopped even when a test threw out of the fixture, because a leaked
        // `next start` holds its port for the rest of the machine's afternoon
        // and the next run would fail to bind for a reason that reads like a
        // build problem.
        await stopServer(server);
        rmSync(dir, { recursive: true, force: true });
      }
    },
    { scope: 'worker' },
  ],

  /**
   * `baseURL` is a `use` option, and a fixture may override one — which is the
   * only reason this file is a fixture at all rather than a helper the specs
   * call. Every relative `page.goto('/delegate/facilitator')` and every
   * `page.request.post('/api/delegate/session')` in the suite resolves against
   * it, so pointing it at this worker's server is what puts a spec in its own
   * room without a single spec having to know a port exists.
   */
  baseURL: async ({ workerServer }, use) => {
    await use(workerServer.url);
  },
});

export { expect };
