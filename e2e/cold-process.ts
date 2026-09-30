import { expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import { once } from 'events';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * The restart trick, in one place.
 *
 * Everything else in this suite runs against one long-lived server, which is
 * also why the deployment problem these two specs exist for was invisible to
 * it. A run's `ScenarioRuntime` is held in a per-process registry, so on a
 * single machine every request about a run is served by the process that
 * created it and the lookup is a map hit. On Vercel the opposite is normal:
 * the request carrying a participant's next click is very likely a different
 * invocation from the one that carried their last, so the registry is empty and
 * the run has to be resolved from the store instead.
 *
 * A test cannot get that state by asking nicely, so it manufactures it: start a
 * server, seed a run, KILL that server, start a second one. The second process
 * is a different pid with an empty `globalThis` — there is no way for it to hold
 * anything the first one knew — and the run is still in the store. Everything
 * after the kill is therefore cold by construction, not by assertion.
 *
 * Two servers are started rather than reusing the suite's, on a port the OS
 * hands out, and both are killed in `afterAll`. That isolation is not
 * politeness: killing the suite's server would fail every spec after it,
 * because Playwright starts that server once for the whole run. The scratch
 * store is a second directory for the same reason — the suite's own room must
 * hold only the rows its own specs seeded, and a restart test that wrote into
 * it would leave a run behind for the facilitator specs to trip over. Each spec
 * passes its own `dataDir`, which is what keeps two cold specs from sharing a
 * room.
 *
 * The build is the suite's (`.next-e2e`, built by the configured webServer
 * before any spec runs), so starting a server here is `next start` and nothing
 * else — no rebuild, which is what keeps this affordable inside the per-test
 * budget along with two process starts.
 */

export const ROOT = resolve(__dirname, '..');
export const COLD_DIST = '.next-e2e';
const NEXT_BIN = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** A port nobody is holding: bind :0, read what the OS gave, let it go. */
function freePort(): Promise<number> {
  return new Promise((resolved, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('the OS handed back no TCP port')));
        return;
      }
      const { port } = address;
      probe.close(() => resolved(port));
    });
  });
}

/** True once nothing is listening on the port — i.e. the last server is gone. */
export function portReleased(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

/** The newest mtime under the paths that feed the bundle, and which file it was. */
function newestSourceMtime(): { file: string; at: number } {
  const roots = ['app', 'components', 'delegate/src', 'middleware.ts', 'next.config.js'];
  let newest = { file: '', at: 0 };
  const visit = (path: string): void => {
    let stats;
    try {
      stats = statSync(join(ROOT, path));
    } catch {
      return;
    }
    if (!stats.isDirectory()) {
      if (stats.mtimeMs > newest.at) newest = { file: path, at: stats.mtimeMs };
      return;
    }
    for (const entry of readdirSync(join(ROOT, path))) visit(join(path, entry));
  };
  for (const root of roots) visit(root);
  return newest;
}

/**
 * Refuse to test a build that predates the sources.
 *
 * A cold spec starts its own server, so it cannot be blamed on the suite's —
 * and that is exactly how it can end up serving something stale without saying
 * so. `playwright.config.ts` sets `reuseExistingServer` for local runs, so when
 * a server is already listening on :3100 the configured webServer command never
 * runs and `.next-e2e` is never rebuilt. The spec then starts a perfectly
 * healthy server on a free port, serving a build from hours ago, and the
 * failure it produces is a behavioural one: an assertion about a fix that is in
 * the source tree and not in the bundle. That is a genuinely confusing way to
 * lose an afternoon, and it has happened here once already.
 *
 * So the build is checked before anything is started, and the refusal names the
 * likely cause. The same rule the doctor's delegate check applies to
 * `delegate/dist`, for the same reason: a build is a claim about a source tree,
 * and a stale one should be caught before it is tested rather than blamed for.
 */
export function assertBuildIsCurrent(): void {
  const buildId = join(ROOT, COLD_DIST, 'BUILD_ID');
  expect(existsSync(buildId), `${COLD_DIST}/BUILD_ID is missing — the suite's webServer builds it`).toBeTruthy();
  const built = statSync(buildId).mtimeMs;
  const newest = newestSourceMtime();
  expect(
    built,
    `${COLD_DIST} was built before ${newest.file} changed. A server is probably already listening on :3100, ` +
      'so the configured webServer was reused and never rebuilt — stop it (or run with CI=1) and re-run.',
  ).toBeGreaterThanOrEqual(newest.at);
}

export interface ManagedServer {
  pid: number;
  url: string;
  child: ChildProcess;
}

/**
 * `next start` on the suite's existing build, pointed at one scratch store.
 *
 * The `next` binary is invoked directly rather than through `npm run start`, so
 * this is ONE process with ONE pid: `npm` would add a process that survives its
 * child and leaves the port held by something the spec cannot see or kill — and
 * a test about killing servers cannot use a helper that leaks them.
 *
 * `extraEnv` is how a spec gives both processes the same server-side identity —
 * the real agent provider, chiefly. Anything absent from it is inherited from
 * this process, which is how a key held in the runner's environment reaches the
 * server without the spec handling a secret it has no business reading.
 */
async function startServer(port: number, dataDir: string, extraEnv: Record<string, string>): Promise<ManagedServer> {
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NEXT_E2E_DIST_DIR: COLD_DIST, DELEGATE_DATA_DIR: dataDir, ...extraEnv },
  });

  // Drain both pipes (an undrained pipe eventually blocks the server) and keep
  // only the tail, so a failure can say what the server printed.
  let log = '';
  const keep = (chunk: unknown) => {
    log = (log + String(chunk)).slice(-4000);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);

  let ended: string | null = null;
  child.on('exit', (code, signal) => {
    ended = signal ?? `code ${String(code)}`;
  });

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (ended !== null) {
      const failure = new Error(`next start exited (${ended}) before it answered on ${url}:\n${log}`);
      // The one exit worth retrying is somebody else taking the port between
      // the probe that chose it and the bind: `freePort` cannot hold a port
      // open and hand it over, so this is a race, not a fault. Re-thrown with
      // the log attached so the caller can tell it from a real crash.
      (failure as Error & { log?: string }).log = log;
      throw failure;
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      // Any answer at all is an answer; the point is the socket, not the route.
      if (res.status > 0) return { pid: child.pid ?? -1, url, child };
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  child.kill('SIGKILL');
  throw new Error(`nothing answered on ${url} within 60s:\n${log}`);
}

/**
 * Start a server, on a port of its own, retrying a lost port race.
 *
 * `freePort` binds :0, reads the number and closes — the only way to ask the OS
 * for a port without holding it, and the reason a port can be gone by the time
 * Next binds it. The retry is bounded and only for that case: any other exit is
 * a real failure and is reported with the server's own output, which is the
 * only thing that makes a startup failure diagnosable.
 */
export async function startServerOnAnyPort(
  dataDir: string,
  extraEnv: Record<string, string> = {},
  attempts = 5,
): Promise<ManagedServer> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await startServer(await freePort(), dataDir, extraEnv);
    } catch (error) {
      last = error;
      const log = (error as Error & { log?: string }).log ?? '';
      if (!/EADDRINUSE/.test(log)) throw error;
    }
  }
  throw last;
}

/** SIGTERM, then SIGKILL, and never return while the pid is still there. */
export async function stopServer(server: ManagedServer | null): Promise<void> {
  if (server === null) return;
  const { child } = server;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const gone = await Promise.race([once(child, 'exit').then(() => true), sleep(8_000).then(() => false)]);
  if (!gone) {
    child.kill('SIGKILL');
    await Promise.race([once(child, 'exit'), sleep(3_000)]);
  }
}

/**
 * The rows the file backend wrote under a scratch store, read straight off disk.
 *
 * A process that answered is not a process that wrote, and on the cold path the
 * two come apart: the store's flush happens in the chat route's `finally`, so a
 * turn that returned is a turn whose events were persisted. Reading the file
 * rather than asking the API keeps the assertion about the store.
 */
export function storeRows<T>(dataDir: string, file: string): T[] {
  const path = join(ROOT, dataDir, file);
  expect(existsSync(path), `${path} should exist`).toBeTruthy();
  return JSON.parse(readFileSync(path, 'utf8')) as T[];
}