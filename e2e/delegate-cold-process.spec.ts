import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import { once } from 'events';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * The cold-process path, over real HTTP, across a real restart.
 *
 * Everything else in the suite runs against one long-lived server, which is
 * also why the deployment problem this file exists for was invisible to it. A
 * run's `ScenarioRuntime` is held in a per-process registry, so on a single
 * machine every request about a run is served by the process that created it
 * and the lookup is a map hit. On Vercel the opposite is normal: the request
 * that carries a participant's next click is very likely a different invocation
 * from the one that carried their last, so the registry is empty and the run
 * has to be resolved from the store instead. Two routes used to answer 404 in
 * exactly that case — `/api/delegate/view` and `/api/delegate/submit`, which is
 * to say the ledger pane and the score itself.
 *
 * A test cannot get that state by asking nicely, so this one manufactures it:
 * it starts a server, seeds a run, KILLS that server, and starts a second one.
 * The second process is a different pid with an empty `globalThis` — there is no
 * way for it to hold anything the first one knew — and the run is still in the
 * store. Everything after the kill is therefore a cold request by construction,
 * not by assertion.
 *
 * The shape of the proof, in order:
 *   1. the viewer answers on the WARM process — the control. Without it, a
 *      failure after the restart would be ambiguous between "the cold path is
 *      broken" and "this viewer call was never going to work".
 *   2. the same viewer call, byte for byte, on the COLD process.
 *   3. the submit scores the run on the cold process, and the score is in the
 *      store afterwards — so the cold process did not merely answer, it wrote.
 *   4. the participant's own page restores from the cold process, read-only,
 *      showing the same debrief note the cold submit returned.
 *
 * Two servers are started here rather than reusing the suite's, on a port the
 * OS hands out, and both are killed in `afterAll`. That isolation is not
 * politeness: killing the suite's server would fail every spec after it,
 * because Playwright starts that server once for the whole run. The scratch
 * store is a second directory for the same reason — the suite's own room must
 * hold only the rows its own specs seeded, and a restart test that wrote into
 * it would leave a run behind for the facilitator specs to trip over.
 *
 * The build is the suite's (`.next-e2e`, built by the configured webServer
 * before any spec runs), so starting a server here is `next start` and nothing
 * else — no rebuild, which is what keeps this affordable inside the 150s
 * per-test budget along with two process starts.
 */

const ROOT = resolve(__dirname, '..');
const DIST = '.next-e2e';
const DATA_DIR = '.next-e2e/delegate-data-cold';
const NEXT_BIN = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

const STAMP = Date.now().toString(36).slice(-5);
const PARTICIPANT = `E2E Cold ${STAMP}`;
const SCENARIO = 's1';

/** A bank line from the shared ledger, and the viewer action that reads it. */
const BANK_LINE = { id: 'BK-IN-INV-00001', type: 'bank_line' };

/** Over the server's own 40-word gate (delegate/src/api/validate.ts). */
const ANSWER =
  'WHAT I CONCLUDED: the reconciliation break is the supplier invoice booked ' +
  'against the wrong entity, and the bank line alone does not explain it. ' +
  'WHAT I CHECKED: I opened the bank feed, the matching journal entries, and ' +
  'the counterparty accounts for the period. WHAT I AM UNSURE ABOUT: whether ' +
  'the duplicate payment was reversed in the following week.';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** A port nobody is holding: bind :0, read what the OS gave, let it go. */
function freePort(): Promise<number> {
  return new Promise((resolved, rejected) => {
    const probe = createServer();
    probe.on('error', rejected);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => rejected(new Error('the OS handed back no TCP port')));
        return;
      }
      const { port } = address;
      probe.close(() => resolved(port));
    });
  });
}

/** True once nothing is listening on the port — i.e. the last server is gone. */
function portReleased(port: number): Promise<boolean> {
  return new Promise((resolved) => {
    const probe = createServer();
    probe.once('error', () => resolved(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolved(true)));
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
 * This spec starts its own server, so it cannot be blamed on the suite's — and
 * that is exactly how it can end up serving something stale without saying so.
 * `playwright.config.ts` sets `reuseExistingServer` for local runs, so when a
 * server is already listening on :3100 the configured webServer command never
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
function assertBuildIsCurrent(): void {
  const buildId = join(ROOT, DIST, 'BUILD_ID');
  expect(existsSync(buildId), `${DIST}/BUILD_ID is missing — the suite's webServer builds it`).toBeTruthy();
  const built = statSync(buildId).mtimeMs;
  const newest = newestSourceMtime();
  expect(
    built,
    `${DIST} was built before ${newest.file} changed. A server is probably already listening on :3100, ` +
      'so the configured webServer was reused and never rebuilt — stop it (or run with CI=1) and re-run.',
  ).toBeGreaterThanOrEqual(newest.at);
}

interface ManagedServer {
  pid: number;
  url: string;
  child: ChildProcess;
}

/**
 * `next start` on the suite's existing build, with the suite's scratch store.
 *
 * The `next` binary is invoked directly rather than through `npm run start`, so
 * this is ONE process with ONE pid: `npm` would add a process that survives its
 * child and leaves the port held by something the spec cannot see or kill — and
 * a test about killing servers cannot use a helper that leaks them.
 */
async function startServer(port: number): Promise<ManagedServer> {
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NEXT_E2E_DIST_DIR: DIST, DELEGATE_DATA_DIR: DATA_DIR },
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
async function startServerOnAnyPort(attempts = 5): Promise<ManagedServer> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await startServer(await freePort());
    } catch (error) {
      last = error;
      const log = (error as Error & { log?: string }).log ?? '';
      if (!/EADDRINUSE/.test(log)) throw error;
    }
  }
  throw last;
}

/** SIGTERM, then SIGKILL, and never return while the pid is still there. */
async function stopServer(server: ManagedServer | null): Promise<void> {
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

async function startRun(page: Page, url: string): Promise<{ sessionId: string; runId: string }> {
  const res = await page.request.post(`${url}/api/delegate/session`, {
    data: { participantLabel: PARTICIPANT, scenarioId: SCENARIO },
  });
  expect(res.ok(), 'the session route should start a run').toBeTruthy();
  return (await res.json()) as { sessionId: string; runId: string };
}

/** One viewer action. The response body is compared warm against cold. */
async function openBankLine(page: Page, url: string, runId: string): Promise<APIResponse> {
  return page.request.post(`${url}/api/delegate/view`, {
    data: { runId, action: 'get_record', args: BANK_LINE },
  });
}

function scoreRows(): Array<{ runId: string; dimension: string; value: number }> {
  const path = join(ROOT, DATA_DIR, 'scores.json');
  expect(existsSync(path), `${path} should hold the scores the cold process wrote`).toBeTruthy();
  return JSON.parse(readFileSync(path, 'utf8')) as Array<{ runId: string; dimension: string; value: number }>;
}

test.describe('Delegate cold process', () => {
  let first: ManagedServer | null = null;
  let second: ManagedServer | null = null;

  test.beforeAll(() => {
    // The suite's webServer builds .next-e2e before any spec runs, so a missing
    // build is only reachable if the suite was pointed elsewhere — but a STALE
    // one is easy to reach, and it fails as behaviour rather than as setup.
    assertBuildIsCurrent();
    // One store for both servers, which is the whole point: the second process
    // finds the run here and nowhere else.
    rmSync(join(ROOT, DATA_DIR), { recursive: true, force: true });
  });

  test.afterAll(async () => {
    await stopServer(second);
    await stopServer(first);
  });

  test('a run started on one process is viewable and submittable on the next one', async ({ page }) => {
    // Two process starts and a restart, on top of a browser and a build that may
    // be cold on the first run of the day.
    test.setTimeout(240_000);

    let runId = '';
    let sessionId = '';
    let firstPid = 0;
    let warmBody = '';
    // Held as a URL rather than as the server handle: the steps after the
    // restart only need somewhere to send a request, and a handle that
    // TypeScript cannot narrow across a closure is a handle somebody will
    // eventually use before it is set.
    let coldUrl = '';

    await test.step('a run is started, and the viewer answers, on a warm process', async () => {
      first = await startServerOnAnyPort();
      const seeded = await startRun(page, first.url);
      runId = seeded.runId;
      sessionId = seeded.sessionId;
      expect(runId).toMatch(/^run-/);

      const warm = await openBankLine(page, first.url, runId);
      expect(warm.ok(), 'the control: the viewer route works while the process is warm').toBeTruthy();
      warmBody = JSON.stringify(await warm.json());
      expect(warmBody).toContain(BANK_LINE.id);
    });

    await test.step('the first process is stopped, and its port comes back', async () => {
      firstPid = first!.pid;
      const firstPort = Number(new URL(first!.url).port);
      await stopServer(first);
      first = null;
      // The port must actually be free, or "the second process" would be the
      // first one still answering under a new name and the whole test a no-op.
      await expect
        .poll(() => portReleased(firstPort), { timeout: 20_000, intervals: [200, 500, 1_000] })
        .toBe(true);
    });

    await test.step('a different process starts, on a port of its own', async () => {
      // Its own port rather than the same one: the proof here is the pid, and
      // reusing the port would add a race (something else could take it between
      // the release above and the bind) to a step whose job is only to be a
      // different process.
      second = await startServerOnAnyPort();
      coldUrl = second.url;
      // Distinct pids is what makes the rest of the test a cold-process test: a
      // new process has an empty `globalThis`, so the registry this deployment
      // path depends on cannot have survived it.
      expect(second.pid).toBeGreaterThan(0);
      expect(second.pid, 'the second server must not be the first one').not.toBe(firstPid);
    });

    await test.step('the run is still there — the store outlived the process', async () => {
      const state = await page.request.get(`${coldUrl}/api/delegate/run/${runId}/state`);
      expect(state.ok(), 'the state route reads the run from the store').toBeTruthy();
      const body = (await state.json()) as { sessionId?: string; scenarioId?: string; submittedAt?: string };
      expect(body.scenarioId).toBe(SCENARIO);
      expect(body.submittedAt ?? '').toBe('');
    });

    await test.step('the viewer answers on a process that has never seen the run', async () => {
      const cold = await openBankLine(page, coldUrl, runId);
      const text = await cold.text();
      // The pre-fix failure was a 404 reading "no runtime for run …" — named
      // here so a regression says what regressed rather than just "not 200".
      expect(text, 'the cold process must not answer with the no-runtime refusal').not.toContain(
        'no runtime for run',
      );
      expect(cold.ok(), `the cold viewer call answered ${cold.status()}: ${text.slice(0, 300)}`).toBeTruthy();
      // Same bytes as the warm control: the ledger is deterministic, so a
      // difference would mean this process built a different world.
      expect(JSON.stringify(JSON.parse(text))).toBe(warmBody);
    });

    let debrief = '';
    await test.step('submit scores the run from the cold process', async () => {
      const submit = await page.request.post(`${coldUrl}/api/delegate/submit`, {
        data: { runId, answer: ANSWER },
      });
      const text = await submit.text();
      expect(text, 'the cold process must not answer with the no-runtime refusal').not.toContain(
        'no runtime for run',
      );
      expect(submit.ok(), `the cold submit answered ${submit.status()}: ${text.slice(0, 300)}`).toBeTruthy();
      const body = JSON.parse(text) as { detected?: boolean; debriefNote?: string; scored?: number };
      expect(typeof body.detected).toBe('boolean');
      expect(body.debriefNote ?? '').not.toBe('');
      expect(body.scored ?? 0).toBeGreaterThan(0);
      debrief = body.debriefNote ?? '';

      // …and the score is in the store, so the cold process wrote rather than
      // merely answered. Read through the file the suite's server backend uses.
      const rows = scoreRows().filter((row) => row.runId === runId);
      expect(rows.length, 'the cold process persisted score rows for this run').toBeGreaterThan(0);
      expect(rows.every((row) => typeof row.value === 'number')).toBe(true);
    });

    await test.step("the participant's page restores from the cold process, read-only", async () => {
      await page.goto(`${coldUrl}/delegate?run=${runId}&session=${sessionId}`);
      // The preview reads the run off the cold process before any consent, and
      // states the submitted state — a page that cannot find the run would
      // offer "start fresh" instead.
      const preview = page.getByRole('region', { name: 'Run preview' });
      await expect(preview.getByText('submitted — reopens read-only')).toBeVisible();

      await page.getByRole('button', { name: 'Reopen previous session' }).click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get('run'), { timeout: 15_000 })
        .toBe(runId);

      // The composer is disabled on a submitted run, so the run cannot be
      // polluted by whatever the cold process did or did not remember.
      await expect(page.locator('input[placeholder="Scenario submitted"]')).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Submit answer' })).toHaveCount(0);
      // The note the cold submit returned is the note on screen: the same
      // process scored it and the same process served the page.
      await expect(page.getByText(debrief.slice(0, 60), { exact: false })).toBeVisible();
    });
  });
});
