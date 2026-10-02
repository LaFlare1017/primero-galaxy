#!/usr/bin/env node
/**
 * The Lighthouse gate, and the server it audits, as one program.
 *
 * This was a `run:` block of twenty lines in `.github/workflows/ci.yml`, and it
 * was doing three jobs: it started a production server, it waited for that
 * server to answer, and it killed it afterwards. The middle one is a
 * correctness claim rather than plumbing, and it was resting on shell features
 * again — `&` for the background process, `$!` for its pid, a `for`/`seq` loop
 * of `curl`s, and `kill $SERVER 2>/dev/null || true` to clean up.
 *
 * Two things were wrong with that, and only one of them is about the shell:
 *
 *   1. **The wait could time out silently.** `curl -sf … && break` inside a
 *      loop with no `else` means a server that never came up fell through to
 *      the audits, which then reported on a connection refused and produced a
 *      Lighthouse JSON with no categories in it. The gate reads categories and
 *      reports nothing found, which is a pass-shaped hole: the run goes green
 *      because the audits produced nothing to complain about.
 *   2. **The server was killed only if nothing threw.** `kill $SERVER` ran
 *      after the audits, so a lighthouse failure — the normal case this gate
 *      exists to catch — skipped the cleanup and left a `next start` holding
 *      port 3100 for the rest of the job. On a throwaway runner that is
 *      survivable, which is exactly why it survived.
 *
 * So the server is started here, waited for with a real HTTP request and a real
 * deadline, and killed in a `finally` that runs whatever happened. Both routes
 * are audited, and the gate still decides the verdict — this program owns the
 * lifecycle, not the score.
 *
 * A note on why this is not just `npm run start` plus a `wait-on`: the audits
 * need the app built and the port free, and the sequence is three steps with
 * dependencies between them. Writing it as a program means the doctor's checks
 * can exercise the wait — including the timeout that must NOT pass — without a
 * browser or a build.
 *
 * Usage (what the workflow calls):
 *   node scripts/lighthouse-run.mjs
 *   node scripts/lighthouse-run.mjs --self-test
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { isMain } from './is-main.mjs';
import { auditReports } from './lighthouse-gate.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PORT = Number(process.env.LIGHTHOUSE_PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;

/**
 * The routes, and how long the second one is given to settle.
 *
 * The galaxy route is a WebGL scene, and Lighthouse's own load heuristics give
 * a heavier page a fixed budget it can overrun; the extra wait is why this
 * route is not simply audited twice with the same flags. It is a real
 * difference between the two routes, so it is named here rather than being two
 * nearly-identical shell lines where the difference is a backslash nobody
 * reads.
 */
const ROUTES = [
  { path: '/', label: 'root', maxWaitForLoad: undefined },
  { path: '/galaxy', label: 'galaxy', maxWaitForLoad: 60_000 },
];

/** How long the server is given to start answering before the run gives up. */
const READY_TIMEOUT_MS = 30_000;
const READY_INTERVAL_MS = 1_000;

/**
 * Wait for the server, and say so plainly when it never came up.
 *
 * Returns `true` only if the server answered. A timeout is a FAILURE and not a
 * shrug: the audits would run against nothing, and the gate would read their
 * empty reports as a pass. That is the bug this function exists to not have.
 *
 * `fetchImpl` is passed in so the self-test can exercise the timeout without
 * waiting thirty seconds for it.
 */
export async function waitForServer({
  url = BASE,
  timeoutMs = READY_TIMEOUT_MS,
  intervalMs = READY_INTERVAL_MS,
  fetchImpl = fetch,
  sleepImpl = sleep,
  now = () => Date.now(),
} = {}) {
  const until = now() + timeoutMs;
  let attempts = 0;
  let lastWhy = 'never asked';
  while (now() < until) {
    attempts += 1;
    try {
      const response = await fetchImpl(url, { redirect: 'manual' });
      // Any answer at all means the server is listening. A 404 or a 500 is
      // still an answer, and refusing to proceed on one would make this a
      // health check dressed up as a readiness wait.
      if (response.status > 0) return { ready: true, attempts, status: response.status };
      lastWhy = `answered with status ${response.status}`;
    } catch (error) {
      lastWhy = error.message;
    }
    await sleepImpl(intervalMs);
  }
  return { ready: false, attempts, lastWhy };
}

/** GitHub's failure channel. */
function annotate(message) {
  process.stderr.write(`::error title=Lighthouse::${message}\n`);
}

/**
 * Run the whole gate: server, two audits, verdict, cleanup.
 *
 * The server is killed in a `finally` rather than after the audits, which is
 * the second of the two bugs above and the cheaper of the two to fix.
 */
export async function runGate({
  startServer = defaultStartServer,
  fetchImpl = fetch,
  waitImpl = waitForServer,
  runAudits = defaultRunAudits,
  judge = defaultJudge,
} = {}) {
  const server = await startServer();
  try {
    const ready = await waitImpl({ fetchImpl });
    if (!ready.ready) {
      return {
        level: 'error',
        code: 1,
        message:
          `the server never answered on ${BASE} after ${ready.attempts} attempt(s) (${ready.lastWhy}) — ` +
          'auditing it anyway would produce an empty report, which this gate would read as a pass',
      };
    }

    const reports = await runAudits(ROUTES, BASE);
    // AWAITED, and not incidentally: `judge` is allowed to be async, and an
    // un-awaited call hands back a Promise whose `.level` is undefined. The
    // self-test caught exactly that — a verdict of `undefined` reads as neither
    // pass nor error, and a run whose level is undefined falls through every
    // `if` and reports success.
    const judged = await judge(reports);
    return { level: judged.level, code: judged.code, message: judged.message, reports };
  } finally {
    // Runs whether the audits passed, failed, or threw. A server left holding
    // the port is the kind of thing that makes the NEXT run's failure look
    // like a port conflict rather than a real regression.
    await server.stop();
  }
}

/** `npm run start` as a child, and the handle needed to stop it. */
function defaultStartServer() {
  const child = spawn('npm', ['run', 'start', '--', '-p', String(PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so the kill reaches the `next start` node process
    // rather than only the `npm` wrapper that spawned it. Killing the wrapper
    // and leaving the server is a leak with extra steps.
    detached: true,
  });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  return {
    child,
    log: () => log,
    stop: async () => {
      try {
        // Negative pid: the whole group, as `detached: true` asked for.
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // Already gone, which is the state this wanted. A cleanup that throws
        // would replace the audit's verdict with a signal's opinion of it.
      }
    },
  };
}

/** Both routes, through lighthouse, into files the gate reads. */
async function defaultRunAudits(routes, base) {
  const { writeFileSync, readFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'lighthouse-run-'));
  const reports = [];
  for (const route of routes) {
    const out = join(dir, `${route.label}.json`);
    const argv = [
      'lighthouse',
      `${base}${route.path}`,
      '--output=json',
      `--output-path=${out}`,
      '--only-categories=accessibility,seo',
      '--chrome-flags=--headless=new --no-sandbox',
      '--quiet',
      ...(route.maxWaitForLoad === undefined ? [] : [`--max-wait-for-load=${route.maxWaitForLoad}`]),
    ];
    const code = await new Promise((done) => {
      const child = spawn('npx', argv, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      let said = '';
      child.stdout.on('data', (chunk) => (said += chunk));
      child.stderr.on('data', (chunk) => (said += chunk));
      child.on('error', () => done(1));
      child.on('close', (status) => {
        if (status !== 0) process.stderr.write(said);
        done(status ?? 1);
      });
    });
    let report = null;
    try {
      report = JSON.parse(readFileSync(out, 'utf8'));
    } catch {
      report = null;
    }
    // A report that is missing or empty is a FAILURE and not an absence: the
    // gate below counts categories, and a null report would read as a route
    // with nothing in it rather than as an audit that never ran.
    reports.push({ route, code, report, file: out });
  }
  writeFileSync(join(dir, '.keep'), '', 'utf8');
  return reports;
}

/** Hand the reports to the existing gate, and say what it decided. */
async function defaultJudge(reports) {
  const missing = reports.filter((entry) => entry.report === null);
  if (missing.length > 0) {
    return {
      level: 'error',
      code: 1,
      message: `lighthouse produced no readable report for ${missing.map((m) => m.route.path).join(', ')} — a route that was never audited is not a route that passed`,
    };
  }
  const failing = reports.filter((entry) => entry.code !== 0);
  if (failing.length > 0) {
    return {
      level: 'error',
      code: 1,
      message: `lighthouse itself failed for ${failing.map((f) => f.route.path).join(', ')}`,
    };
  }
  // The same function CI scores with, imported rather than reimplemented. It
  // is behind an `isMain` guard now, so importing it scores nothing by itself —
  // which it used to do, on the importer's argv, before exiting.
  const failed = auditReports(reports.map((entry) => entry.file));
  return {
    level: failed ? 'error' : 'pass',
    code: failed ? 1 : 0,
    message: failed
      ? 'a score fell below the floor'
      : 'both routes hold 100/100 on accessibility and SEO',
  };
}

async function main(argv) {
  if (argv.includes('--self-test')) return selfTest();

  const outcome = await runGate();
  if (outcome.level === 'pass') {
    process.stderr.write(`${outcome.message}\n`);
    return 0;
  }
  annotate(outcome.message);
  return outcome.code;
}

/**
 * The decisions, with no browser and no build.
 *
 * The two that matter are the timeout — a server that never answers must fail,
 * not audit nothing and pass — and the cleanup, which has to happen on the
 * failing path too.
 */
function selfTest() {
  let failures = 0;
  const check = (name, passed, detail) => {
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
    if (!passed) failures += 1;
  };

  return (async () => {
    // A server that answers first time.
    {
      const ready = await waitForServer({
        fetchImpl: async () => ({ status: 200 }),
        sleepImpl: async () => {},
        now: (() => {
          let t = 0;
          return () => (t += 1_000);
        })(),
      });
      check('a server that answers is ready, on the first attempt', ready.ready && ready.attempts === 1, `after ${ready.attempts} attempt(s)`);
    }

    // A server that takes a moment. This is the normal case, and the reason the
    // wait exists at all.
    {
      let calls = 0;
      const ready = await waitForServer({
        fetchImpl: async () => {
          calls += 1;
          if (calls < 3) throw new Error('ECONNREFUSED');
          return { status: 200 };
        },
        sleepImpl: async () => {},
        now: (() => {
          let t = 0;
          return () => (t += 1_000);
        })(),
      });
      check(
        'a server that refuses connections is waited for rather than audited',
        ready.ready && ready.attempts === 3,
        `ready after ${ready.attempts} attempts, the first two refused`,
      );
    }

    // THE one. A server that never comes up must NOT be reported ready — the
    // shell version fell through to the audits, which produced empty reports
    // the gate read as a pass.
    {
      const ready = await waitForServer({
        fetchImpl: async () => {
          throw new Error('ECONNREFUSED');
        },
        sleepImpl: async () => {},
        now: (() => {
          let t = 0;
          return () => (t += 1_000);
        })(),
        timeoutMs: 5_000,
      });
      check(
        'a server that never answers is NOT ready — an empty report must not read as a pass',
        ready.ready === false && ready.lastWhy.includes('ECONNREFUSED'),
        `${ready.attempts} attempts, last: ${ready.lastWhy}`,
      );
    }

    // And a server that answers with an error is still ANSWERING, which is not
    // what a readiness wait is for.
    {
      const ready = await waitForServer({
        fetchImpl: async () => ({ status: 500 }),
        sleepImpl: async () => {},
        now: (() => {
          let t = 0;
          return () => (t += 1_000);
        })(),
      });
      check(
        'a 500 is an answer — this waits for the server, it is not a health check',
        ready.ready && ready.status === 500,
        `accepted status ${ready.status}`,
      );
    }

    // The cleanup, on the failing path. This is the second bug: `kill` after the
    // audits never ran when they failed, which is the only time it matters.
    {
      let stopped = 0;
      const server = { stop: async () => (stopped += 1) };
      const outcome = await runGate({
        startServer: async () => server,
        fetchImpl: async () => {
          throw new Error('ECONNREFUSED');
        },
        waitImpl: async () => ({ ready: false, attempts: 2, lastWhy: 'ECONNREFUSED' }),
        runAudits: async () => {
          throw new Error('the audits should not have run at all');
        },
        judge: async () => ({ level: 'pass', code: 0, message: 'unreachable' }),
      });
      check(
        'a server that never came up fails the run AND is stopped — no audits, no leaked process',
        outcome.level === 'error' && stopped === 1,
        `verdict ${outcome.level}, server stopped ${stopped} time(s)`,
      );
    }

    // And the same on the path where the audits themselves fail.
    {
      let stopped = 0;
      const outcome = await runGate({
        startServer: async () => ({ stop: async () => (stopped += 1) }),
        fetchImpl: async () => ({ status: 200 }),
        waitImpl: async () => ({ ready: true, attempts: 1, status: 200 }),
        runAudits: async () => [{ route: ROUTES[0], code: 1, report: null, file: '/tmp/x.json' }],
        judge: async (reports) =>
          reports[0].report === null
            ? { level: 'error', code: 1, message: 'lighthouse produced no readable report for / — a route that was never audited is not a route that passed' }
            : { level: 'pass', code: 0, message: 'unreachable' },
      });
      check(
        'a route with no readable report fails the run and the server is still stopped',
        outcome.level === 'error' && stopped === 1 && outcome.message.includes('never audited'),
        `verdict ${outcome.level}, stopped ${stopped} — ${outcome.message.slice(0, 70)}`,
      );
    }

    // The passing path, and the routes are two and they are named.
    {
      let stopped = 0;
      const audited = [];
      const outcome = await runGate({
        startServer: async () => ({ stop: async () => (stopped += 1) }),
        fetchImpl: async () => ({ status: 200 }),
        waitImpl: async () => ({ ready: true, attempts: 1, status: 200 }),
        runAudits: async (routes) => {
          for (const route of routes) audited.push(route.path);
          return routes.map((route) => ({ route, code: 0, report: { categories: {} }, file: `/tmp/${route.label}.json` }));
        },
        judge: async () => ({ level: 'pass', code: 0, message: 'both routes hold 100/100' }),
      });
      check(
        'a clean run audits BOTH routes and stops the server',
        outcome.level === 'pass' && audited.join(',') === '/,/galaxy' && stopped === 1,
        `audited ${audited.join(' and ')}, stopped ${stopped}`,
      );
    }

    // The galaxy route's longer load budget is a real difference between the
    // routes, and it must not quietly become the same value twice.
    check(
      'the two routes carry different load budgets, and the galaxy one names why',
      ROUTES.length === 2 &&
        ROUTES[1].maxWaitForLoad === 60_000 &&
        ROUTES[0].maxWaitForLoad === undefined,
      `${ROUTES[0].path} default, ${ROUTES[1].path} ${ROUTES[1].maxWaitForLoad}ms`,
    );

    console.log(failures === 0 ? '\nall lighthouse-run checks passed' : `\n${failures} lighthouse-run check(s) FAILED`);
    return failures === 0 ? 0 : 1;
  })();
}

if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
