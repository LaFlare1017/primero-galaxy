/**
 * The suite's build and rooms, established once before any worker runs.
 *
 * Every facilitator spec reasons about "the room" — the first and last row, the
 * count in the sweep's `N of M`, the rows a status facet leaves visible. Those
 * are only meaningful answers if the room holds what this run seeded, and that
 * used to depend on something outside the specs' control: the clear lived in
 * `playwright.config.ts`'s `webServer.command`, which Playwright **skips
 * entirely** when `reuseExistingServer` finds a server already listening. So a
 * developer with a server up from a previous run got a room carrying every row
 * that run and every run before it, and the specs failed in ways that read like
 * bugs in the console:
 *
 *   - the grid renders one WINDOW of the room (`GRID_WINDOW` in
 *     app/delegate/facilitator/page.tsx, 200 rows). A room bigger than that
 *     puts a spec's own freshly seeded participant past the window, so
 *     `expect(rowFor(page, SUBMITTED_S5)).toBeVisible()` fails with "element(s)
 *     not found" for a row the spec created seconds earlier;
 *   - and the window's membership slides as rows arrive, so the walk tests that
 *     read the first and last displayed row and then assert the sweep lands on
 *     them are racing the poll — the name belongs to the room at assertion time,
 *     not the one captured before the keypress.
 *
 * Both were measured here as nine failures with a shifting set, and both go
 * away with an empty room. So the empty rooms are established HERE, in a
 * `globalSetup`, which runs on every invocation whether or not Playwright is the
 * one who started the servers. It is deliberately not a `beforeAll`: this is a
 * property of the run, not of a spec, and a spec that cleared its own room would
 * clear the one the specs running alongside it are answering about.
 *
 * There is now one room per WORKER rather than one per run, which is what lets
 * the suite run wide: two files at once cannot see each other's rows, so the
 * assertions that depend on the room's contents hold per file. The count comes
 * from `workerCount()` — the same call `playwright.config.ts` sizes `workers`
 * with — because a config running six workers against five cleared rooms leaves
 * the sixth seeding into the first one's leftovers, and that failure reads as a
 * flaky spec rather than as an off-by-one.
 *
 * The build moved here too, out of the `webServer.command` that used to be
 * `build && start`. Each worker now starts its own server (see
 * `worker-server.ts`), and a build per worker would rebuild the identical bundle
 * N times over. Once, here, before any of them start — which also retires the
 * stale-build failure that function existed to catch, where a reused server
 * meant the bundle was hours old and the resulting failure was a behavioural
 * one: an assertion about a fix that is in the source tree and not in the
 * bundle.
 *
 * What this does NOT fix, and what `E2E_REUSE` still has to be careful about: a
 * server somebody started *without* this suite's `DELEGATE_DATA_DIR` is serving
 * a different store entirely — `delegate/data/`, the room a facilitator opens in
 * dev — and no amount of clearing the suite's own directories changes that. The
 * run would seed into the workshop's store. Reusing a server is therefore an
 * explicit choice, and a port already in use still fails immediately and says
 * so.
 */
import { spawnSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { COLD_DIST, workerDataDir } from './worker-server';
import { workerCount } from './workers';

export default function globalSetup(): void {
  // Built before anything else, because everything else starts a server against
  // it. `NEXT_E2E_DIST_DIR` keeps this out of the dev server's `.next`, which
  // dev and prod would otherwise clobber in a shared checkout.
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, NEXT_E2E_DIST_DIR: COLD_DIST },
  });
  if (build.status !== 0) {
    // The build's own output, because "the suite's build failed" is not a thing
    // anybody can act on and a bare exit code would leave it at that.
    throw new Error(
      `the suite's build failed (exit ${String(build.status)}), so there is nothing for the workers to serve:\n` +
        `${(build.stdout ?? '').slice(-4000)}\n${(build.stderr ?? '').slice(-4000)}`,
    );
  }

  for (let shard = 0; shard < workerCount(); shard += 1) {
    const dir = resolve(process.cwd(), workerDataDir(shard));
    rmSync(dir, { recursive: true, force: true });
    // Created empty rather than left absent: the delegate store creates it on
    // demand, and a directory that exists tells the next reader this was a reset
    // rather than a path nobody has ever written to.
    mkdirSync(dir, { recursive: true });
  }
}
