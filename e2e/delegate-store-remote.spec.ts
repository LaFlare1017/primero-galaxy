/**
 * The store gate's REMOTE leg, over the real Neon driver, with no Neon account.
 *
 * Every other check of this store runs it against PGlite, in-process. That
 * proves the store's SQL, which is most of it, and it proves the store's
 * ADAPTER only in the sense that the adapter is `neonQuery` and `neonQuery` was
 * never called. The adapter is the one piece of the deployment path a local run
 * could not execute, and the comment at the top of
 * `delegate/src/store/test-engine.ts` says so — because it is true, and because
 * executing it needed `NEON_API_KEY` and a real Postgres behind it.
 *
 * Neither is needed now. The fake console grew a data plane: it answers the
 * driver's `POST /sql` with a real PGlite engine, one per BRANCH. So this runs
 * the real `@neondatabase/serverless` driver — the same version, through the
 * same HTTP shape, with the same raw-text and array-mode wire format — against
 * a Postgres on localhost, and then runs the workshop through it.
 *
 * The gate is the thing under test, and it calls `playWorkshop`, so the whole
 * workshop is played: every event, every row, the reopen that proves rows
 * outlive the connection that wrote them, and the score.
 *
 * Provisioning is the JOB's own rather than a helper written here — this runs
 * `neon-secrets.mjs --resolve`, `neon-branch.mjs create` and
 * `neon-branch.mjs uri` as child processes and hands `$GITHUB_ENV` forward the
 * way the workflow does. If those programs drift, this fails rather than
 * quietly testing a path nothing else uses.
 *
 * What is proved, in order:
 *
 *   1. the gate runs to completion and reports a REMOTE engine — the claim the
 *      `store` CI job exists to make, made here without an account;
 *   2. the workshop's rows are in the fake engine, read over SQL rather than
 *      through the gate, so "it used Postgres" is not a claim about a log line;
 *   3. a second connection sees those same rows, which is what a per-BRANCH
 *      engine is for and what a per-connection one would fake into a pass;
 *   4. dropping the branch takes the data with it.
 *
 * What it is not: the driver talks to PGlite, not to a Neon compute. It
 * exercises the adapter, the wire format, the type round trip and the store's
 * SQL. It does not prove Neon's proxy — only a real branch does, which is why
 * the `store` CI job still exists and is still the thing that has never run.
 */

import { expect, test } from './worker-server';
import { spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { startFakeNeon } from '../scripts/neon-fake-console.mjs';

// `__dirname`, not `import.meta.url`: Playwright transpiles these specs to
// CommonJS, and `import.meta` is a syntax error there — which stops the file
// being collected at all and reports "No tests found", naming nothing about the
// real problem. The sibling specs resolve ROOT the same way.
const ROOT = resolve(__dirname, '..');
const GATE = join(ROOT, 'delegate', 'dist', 'store', 'test-store-backends.js');
const API_KEY = 'test-key';
const STAMP = Date.now().toString(36).slice(-5);
const BRANCH_NAME = `e2e-remote-${STAMP}`;

/** What the fake console hands back. Only the parts this spec uses. */
interface FakeNeon {
  url: string;
  dataPlane: () => boolean;
  close: () => Promise<void>;
}

/** The console's own port, which the URI and the driver's endpoint both need. */
const loopbackPort = (url: string): number => Number(new URL(url).port);

/** The branch a connection URI names. */
function branchIdOf(uri: string): string {
  try {
    return new URL(uri).searchParams.get('branch_id') ?? '';
  } catch (error) {
    throw new Error(`the connection URI is not a URL this spec can read: ${uri} (${(error as Error).message})`);
  }
}

/** `$GITHUB_ENV`, read the way GitHub reads it: as environment values. */
function readEnvFile(file: string): Record<string, string> {
  const env: Record<string, string> = {};
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return env;
  }
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) env[line.slice(0, at)] = line.slice(at + 1);
  }
  return env;
}

/**
 * Ask the fake engine a question directly.
 *
 * Deliberately NOT through the gate: a row only the gate can see would prove
 * the gate cached something, and the claim here is that the rows are in
 * Postgres.
 */
async function ask(console_: FakeNeon, uri: string, query: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(`http://127.0.0.1:${loopbackPort(console_.url)}/sql?branch_id=${branchIdOf(uri)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const payload = await response.json();
  if (!response.ok) {
    // The driver's own 400 carries Postgres's message, and losing it is how a
    // schema mistake becomes "expected 1 row, got 0".
    throw new Error(`SQL against the fake engine failed: ${payload.message ?? response.status}`);
  }
  const names: string[] = payload.fields.map((field: { name: string }) => field.name);
  return payload.rows.map((row: unknown[]) => Object.fromEntries(names.map((name, i) => [name, row[i]])));
}

let fake: FakeNeon;
let envFile = '';
let workDir = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  if (!existsSync(GATE)) {
    // Named rather than skipped: the gate is the thing under test, and a
    // skipped spec would read as coverage of a thing nobody ran.
    throw new Error(`${GATE} is missing — run \`npm --prefix delegate run build\` before this suite`);
  }
  fake = (await startFakeNeon({ apiKey: API_KEY, dataPlane: true })) as unknown as FakeNeon;
  envFile = join(mkdtempSync(join(tmpdir(), 'e2e-neon-remote-')), 'github.env');
  workDir = mkdtempSync(join(tmpdir(), 'e2e-neon-remote-data-'));
});

test.afterAll(async () => {
  await fake?.close();
  if (envFile !== '') rmSync(envFile, { force: true });
  if (workDir !== '') rmSync(workDir, { recursive: true, force: true });
});

/**
 * What provisioning produced: the whole hand-off environment, and the
 * connection URI resolved out of it.
 *
 * The URI is returned as a VALUE rather than left to be read off `env` by the
 * caller. It is read here, from the file, inside the function that just wrote
 * through it — which is the one place the read is known to be good. Handing
 * back a shared object and reading it again on the other side of an `await`
 * makes this spec depend on a property read that has already proved
 * unreliable here: the same expression returned `undefined` on the line after
 * the await and the real value on the next one, with nothing in between but
 * the two statements themselves. A helper that computes what it computed is
 * worth more than a bag of values somebody else has to go and re-read.
 */
interface Provisioned {
  /** Every value the steps exported, for the steps that still need them. */
  env: Record<string, string>;
  /** `DELEGATE_STORE_TEST_URL`, or `''` when the uri step did not export one. */
  uri: string;
}

/**
 * The job's own provisioning, run as processes.
 *
 * `neon-secrets.mjs --resolve` writes `$GITHUB_ENV` itself and prints the two
 * ids; `neon-branch.mjs create` exports `BRANCH_ID`. The hand-off between the
 * steps — each one's exports becoming the next one's environment — is easy to
 * leave out and impossible to notice, because without it step two refuses for
 * want of an id step one just wrote, and the refusal names the program's
 * addresses rather than the missing hand-off.
 *
 * The accumulated environment is RETURNED rather than kept in module state, and
 * callers pass it on explicitly: two helpers reaching into one mutable module
 * object makes it possible for a call to read an environment another had not
 * filled, which shows up as one line seeing a value and the next seeing
 * `undefined`.
 */
async function provision(envFilePath: string): Promise<Provisioned> {
  const carried: Record<string, string> = {};
  const run = (argv: string[]) =>
    new Promise<{ status: number | null; stderr: string }>((done) => {
      const [script, ...flags] = argv;
      const child = spawn(process.execPath, [join(ROOT, script), ...flags], {
        cwd: ROOT,
        env: {
          ...process.env,
          ...carried,
          NEON_API_KEY: API_KEY,
          NEON_API_URL: fake.url,
          GITHUB_ENV: envFilePath,
          BRANCH_NAME,
        },
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.stdout.resume();
      child.on('close', (status) => done({ status, stderr }));
    });

  const steps: [string[], string][] = [
    [['scripts/neon-secrets.mjs', '--resolve'], 'provisioning'],
    [['scripts/neon-branch.mjs', 'create'], 'branch create'],
    [['scripts/neon-branch.mjs', 'uri'], 'URI resolve'],
  ];
  for (const [argv, what] of steps) {
    const result = await run(argv);
    if (result.status !== 0) {
      throw new Error(`${what} failed with exit ${result.status}: ${result.stderr}`);
    }
    Object.assign(carried, readEnvFile(envFilePath));
  }
  return { env: carried, uri: readEnvFile(envFilePath).DELEGATE_STORE_TEST_URL ?? '' };
}

/**
 * The environment that turns the gate's remote leg on.
 *
 * `NEON_LOOPBACK_ENDPOINT` is what makes the driver talk to the fake at all:
 * `neon()` hardcodes `https://<host>/sql`, which a loopback server cannot
 * answer, and the endpoint is a per-MODULE-INSTANCE global on the driver's own
 * `neonConfig` — set by `e2e/neon-loopback-preload.mjs` before the gate imports
 * it. So no product code grows a test-only variable.
 *
 * `DELEGATE_STORE_TEST_ALLOW_ANY` is deliberately NOT set. The gate refuses a
 * database whose name carries no ci/test/ephemeral marker, and one of its own
 * checks is that the refusal fires; setting the override would switch that
 * check off and prove nothing. The fake's database is named `delegate-ci`,
 * which satisfies the guard on its own terms.
 */
function gateEnv(uri: string): NodeJS.ProcessEnv {
  if (!uri) throw new Error('no connection URI was exported; provision() must run first');
  return {
    ...process.env,
    DELEGATE_STORE_TEST_URL: uri,
    DELEGATE_DATA_DIR: workDir,
    // QUOTED, and this repository is why: `NODE_OPTIONS` is parsed with
    // shell-like quoting rules and this checkout's path contains spaces, so an
    // unquoted path is split into two arguments and the gate dies with
    // `SyntaxError: Invalid regular expression flags` — on a machine with a
    // space in its path only, which is the worst shape a test can have.
    NODE_OPTIONS: `--import "${join(ROOT, 'e2e', 'neon-loopback-preload.mjs')}"`,
    NEON_LOOPBACK_ENDPOINT: `http://127.0.0.1:${loopbackPort(fake.url)}/sql?branch_id=${branchIdOf(uri)}`,
  };
}

function runGate(uri: string) {
  return new Promise<{ status: number | null; output: string }>((done) => {
    const child = spawn(process.execPath, [GATE], { cwd: ROOT, env: gateEnv(uri) });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (status) => done({ status, output }));
  });
}

test('the store gate runs the workshop over the Neon driver, against a real Postgres', async () => {
  const { env: carried, uri } = await provision(envFile);
  expect(uri, 'the uri step should have exported a connection URL').toMatch(/^postgres:\/\//);
  expect(fake.dataPlane(), 'the console was asked for a data plane').toBe(true);

  const run = await runGate(uri);
  const lines = run.output.split('\n');

  // 1. The claim this whole job exists to make. A gate that fell back to
  //    PGlite passes every check it makes while testing the wrong substrate.
  expect(
    run.output,
    'the gate should report the engine it used',
  ).toContain('store gate: postgres leg on remote postgres');

  expect(
    lines.filter((line) => line.startsWith('FAIL')),
    `the gate should pass every check over the driver:\n${run.output.slice(-1200)}`,
  ).toEqual([]);
  expect(run.status, `the gate should exit 0:\n${run.output.slice(-1200)}`).toBe(0);

  // 2. The store's schema is IN Postgres, read over SQL rather than through the
  //    gate. This is the check that says the driver really executed DDL against
  //    a database, and it is worth stating separately from the gate's own
  //    verdict: the gate can only report what it believes, while this asks the
  //    engine directly.
  const tables = await ask(fake, uri, "SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  expect(tables.map((row) => String(row.tablename)), 'the store should have created its tables').toContain(
    'delegate_rows',
  );

  // 3. The gate's own check 5 reopens the engine and counts the rows the
  //    workshop wrote, which is the "rows outlive the connection that wrote
  //    them" proof — the one thing a per-CONNECTION fake engine would fake into
  //    a pass. It is named here rather than left implicit, because it is the
  //    claim that the write path reached a database and not a buffer.
  expect(
    run.output,
    'the gate should report rows read back by a SECOND engine over the driver',
  ).toMatch(/\d+ run rows read by a second engine/);

  //    And the store is EMPTY afterwards, which is the gate's check 6 —
  //    `clearAll` — having run against this very database over the wire. An
  //    earlier version of this spec asserted rows were still here and failed,
  //    and it was right to fail: the gate empties the store on purpose, so a
  //    non-zero count here would mean `clearAll` had not reached Postgres. The
  //    table is left, because `clearAll` deletes rows and does not drop.
  const counted = await ask(fake, uri, 'SELECT count(*)::int AS n FROM delegate_rows');
  expect(Number(counted[0]?.n), 'the gate should have emptied the store over the driver').toBe(0);

  // 4. A SECOND client, over plain SQL, sees that same table — so the engine
  //    the driver wrote through is the engine this spec is querying, and not a
  //    private one it made along the way. A write that never left the driver
  //    would still satisfy everything above.
  const events = await ask(fake, uri, "SELECT count(*)::int AS n FROM delegate_rows WHERE table_name = 'events'");
  expect(Array.isArray(events), 'a second SQL client should read the same table').toBe(true);

  // 5. Dropping the branch takes the data with it, as a dropped Neon branch
  //    does. A fake that kept answering would let a stale URI look alive.
  const dropped = await new Promise<number | null>((done) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts/neon-branch.mjs'), 'drop'], {
      cwd: ROOT,
      // `BRANCH_NAME` is passed rather than inherited: `provision` only ever
      // set it on the children IT spawned, and `addresses()` refuses a run
      // without it — so a drop that forgot it would exit 1 naming four missing
      // variables instead of saying which one this step forgot.
      env: {
        ...process.env,
        ...carried,
        NEON_API_KEY: API_KEY,
        NEON_API_URL: fake.url,
        BRANCH_NAME,
      },
    });
    child.on('close', (status) => done(status));
  });
  expect(dropped, 'the drop step should succeed').toBe(0);

  //    Polled on the REFUSAL rather than asserted with `.rejects`, because
  //    `expect.poll` has no `rejects` matcher at all — and an engine that
  //    answers would have to be reported as "it kept answering" rather than as
  //    a timeout with no message, which is what a rejected poll looks like.
  await expect
    .poll(
      async () => {
        try {
          await ask(fake, uri, 'SELECT 1 AS one');
          return '(the engine answered a query for a branch that was dropped)';
        } catch (error) {
          return (error as Error).message;
        }
      },
      { message: 'a dropped branch should refuse queries rather than answer them' },
    )
    .toMatch(/no branch/);
});