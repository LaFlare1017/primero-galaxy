#!/usr/bin/env node
/**
 * The per-run Neon branch the store gate needs: created, resolved, dropped.
 *
 * This used to be ninety lines of shell inside `.github/workflows/ci.yml`, and
 * that is the problem with it. Every other part of this repository's CI is a
 * program somebody can run and a check that can fail a build; this part was
 * prose in a YAML block, which meant the whole lifecycle — create, wait for the
 * compute to start, resolve a connection URI, delete — had never been executed
 * without a Neon account. This repository has no `NEON_API_KEY`, so a run of
 * this job has never reached the code that does any of it. A branch created
 * without `read_write`, a readiness poll that gives up one attempt early, a URI
 * resolved for the wrong branch: each of those would first be seen as "the
 * driver is untested", which is the failure message this job is built around
 * and the least useful one to read.
 *
 * So it is a program now, and it has the two modes the provisioning script
 * beside it has:
 *
 *   --self-test       the decisions, against a stubbed fetch
 *   --self-test-e2e   the whole lifecycle against a fake console on localhost,
 *                     over real HTTP, writing nothing anywhere
 *
 * The second is the one that matters. A stub proves the program decided to
 * create; only a real request proves the console would have understood it. And
 * one behaviour here has no stub at all: a Neon branch is created with its
 * compute still starting and answers `current_state: init` for a while, so
 * anything that connects the moment it is handed an id gets a database that is
 * not there yet. The fake console can be told to hold a branch back for a
 * number of polls, and the lifecycle is then run against a branch that is
 * genuinely not ready — which is the whole reason the poll exists.
 *
 * Every refusal the shell made is kept, and each one is a decision somebody
 * will want to make again in six months: a branch created without an expiry
 * does not fail, it silently never cleans itself up; a create that answers with
 * no id is an empty variable, which the next step reads as "the remote leg did
 * not run"; a URI printed whole is a database password in a CI log. A delete
 * that fails is a WARNING and not a failure, because the gate has already
 * answered by then and failing the run over untidiness would bury the verdict
 * that matters.
 *
 * Usage, which is what the workflow calls:
 *   node scripts/neon-branch.mjs create   create, wait for ready, export BRANCH_ID
 *   node scripts/neon-branch.mjs uri      resolve and export DELEGATE_STORE_TEST_URL
 *   node scripts/neon-branch.mjs drop     delete the branch
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './is-main.mjs';
import { neon } from './neon-api.mjs';
import { startFakeNeon } from './neon-fake-console.mjs';

/** Where this job's addresses come from. Overridable so the self-test can point elsewhere. */
function apiBase(env = process.env) {
  return (env.NEON_API_URL ?? '').trim() || 'https://console.neon.tech/api/v2';
}

/** How long a branch may take to start before the job gives up on it. */
const READY_ATTEMPTS = 60;
const READY_INTERVAL_MS = 2_000;

/** Long enough for six hours to be comfortably inside Neon's 30-day cap. */
const EXPIRY_HOURS = 6;

/**
 * The window this run asked for, in hours.
 *
 * Read from the environment so the refusal is provable from OUTSIDE the
 * process: the console's expiry rules can only be tested by a child that
 * computes a bad expiry, and the only way to make a child do that is to tell
 * it to. It is also a real input rather than a test-only hook — a job that
 * needs a longer window for a slow gate sets it, and gets the same refusal if
 * it asks for one the console will not take.
 *
 * Throws rather than falling back, and that is the same reasoning as
 * `expiresAt`: a value that is not a number would otherwise become `NaN` deep
 * inside a `Date`, where it surfaces as `Invalid time value` — an error about
 * time formatting raised at the moment somebody tried to set a window, which
 * names neither the variable nor its value.
 */
export function expiryHours(env = process.env) {
  const asked = (env.EXPIRY_HOURS ?? '').trim();
  if (asked === '') return EXPIRY_HOURS;
  const hours = Number(asked);
  if (!Number.isFinite(hours)) {
    throw new Error(`EXPIRY_HOURS is ${JSON.stringify(asked)}, which is not a number of hours`);
  }
  return hours;
}

/**
 * When this branch deletes itself.
 *
 * The backstop for the one case the job cannot cover: GitHub does not run the
 * later steps of a cancelled job, so a cancelled run never reaches `drop`. Six
 * hours is far longer than the gate needs and short enough that an abandoned
 * branch costs nothing. Throws rather than returning something empty, because
 * a branch created with an empty or unparseable expiry does not fail — it
 * simply never cleans itself up, which is the leak this exists to prevent.
 */
export function expiresAt(now = new Date(), hours = EXPIRY_HOURS) {
  // The clock is checked BEFORE it is formatted, not after: an invalid date
  // throws from `toISOString()` too, so a message that named the bad time
  // would replace this error with `Invalid time value` — which is exactly the
  // kind of message this refusal exists to avoid being.
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error(`could not compute an expiry ${hours}h out: the clock returned ${String(now)}, which is not a date`);
  }
  const at = new Date(now.getTime() + hours * 60 * 60 * 1000);
  if (Number.isNaN(at.getTime())) {
    throw new Error(`could not compute an expiry ${hours}h out from ${now.toISOString()}`);
  }
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The three secrets the remote leg needs, and what each one is for.
 *
 * Exported rather than written into the refusal inline, so a check can assert
 * against the same text the job prints. A refusal that names a secret nobody has
 * to set is a worse instruction than no refusal, and the way that happens is
 * usually an edit to a message that nothing reads back.
 */
export const REQUIRED_SECRETS = [
  'NEON_API_KEY',
  'NEON_PROJECT_ID',
  'NEON_PARENT_BRANCH_ID',
];

/**
 * What the job says when the remote leg did not run.
 *
 * Two things are being claimed and both have to survive an edit. It names all
 * three secrets, because the reader's first question is "what do I set" — and it
 * says that the KEY is what fixes it, because the two ids are optional: the
 * resolve step finds or creates them by name, so telling somebody to go and mint
 * three secrets when one is enough is how a correct refusal gets ignored.
 *
 * The step that prints this keys on the connection URI rather than on the API
 * key, so a create that failed is reported as the failure it is instead of
 * reading as a run that never had credentials. That is why this text can talk
 * about a missing URI without assuming why it is missing.
 */
export function remoteLegRefusal(event = 'this event') {
  return (
    `no connection URI for a per-run branch on ${event}, so the store gate ran on its in-process ` +
    'engine only. The serverless driver is the one piece an in-process engine cannot execute, and it is ' +
    'now untested rather than assumed.\n' +
    `  Fix it with ${REQUIRED_SECRETS[0]} alone — a key at console.neon.tech → Account Settings → API keys. ` +
    `The resolve step then finds or creates the other two by name, so ${REQUIRED_SECRETS[1]} and ` +
    `${REQUIRED_SECRETS[2]} are only needed to pin them rather than look them up.\n` +
    "  If a key IS set, read the create step's own output above: it says which call failed. " +
    'See delegate/README.md#the-store-gate-against-a-real-database.'
  );
}

/** The same fact, said as a notice, for the one case where it is not a failure. */
export function forkPullRequestNotice() {
  return (
    'no Neon API key on a fork pull request — GitHub passes no secrets, so the remote leg did not run. ' +
    'The in-process one did.'
  );
}

/**
 * Report whether the remote leg ran, and fail the job when it did not.
 *
 * The one mode that does NOT need an address: it runs precisely when there is
 * none, so asking it for one first would be asking the question it answers.
 */
export function reportRemoteLeg(env = process.env, { forkPullRequest = false } = {}) {
  const url = (env.DELEGATE_STORE_TEST_URL ?? '').trim();
  if (url !== '') {
    // Keyed on the URI, and this is the case that keying on the key would get
    // wrong: a run that has a database is a run whose leg ran, whatever its
    // key looks like.
    say('the remote leg has a connection URI, so it ran');
    return { level: 'pass', message: '' };
  }
  if (forkPullRequest) {
    const message = forkPullRequestNotice();
    process.stderr.write(`::notice title=Store gate::${message}\n`);
    return { level: 'notice', message };
  }
  const message = remoteLegRefusal(env.GITHUB_EVENT_NAME ?? 'this event');
  process.stderr.write(`::error title=Store gate::${message}\n`);
  return { level: 'error', message };
}

/** The name this run's branch carries, which is what somebody sees in the console. */
function branchName(env = process.env) {
  return (env.BRANCH_NAME ?? '').trim();
}

/** What this run has to work with, refused here rather than half-used later. */
export function addresses(env = process.env) {
  const apiKey = (env.NEON_API_KEY ?? '').trim();
  const projectId = (env.NEON_PROJECT_ID ?? '').trim();
  const parentBranchId = (env.NEON_PARENT_BRANCH_ID ?? '').trim();
  const name = branchName(env);
  const missing = [
    ['NEON_API_KEY', apiKey],
    ['NEON_PROJECT_ID', projectId],
    ['NEON_PARENT_BRANCH_ID', parentBranchId],
    ['BRANCH_NAME', name],
  ]
    .filter(([, value]) => value === '')
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(', ')} not set, so this run cannot have a branch of its own. ` +
        'The store job runs these steps only when NEON_API_KEY is present; if you are running this by hand, ' +
        'that is four environment variables, not one.',
    );
  }
  return { apiKey, projectId, parentBranchId, name };
}

/**
 * One management call.
 *
 * Status is checked by the caller rather than thrown from here, because every
 * step in this lifecycle has a different answer for a given status: a create
 * that is not 200/201 is fatal, a delete that is not 200/204 is a warning, and a
 * connection URI that is not 200 is fatal with a different sentence. One shared
 * `throw` would flatten three decisions into one.
 */
async function call(ctx, path, { method = 'GET', body } = {}) {
  const response = await ctx.fetchImpl(`${ctx.base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  return { ok: response.ok, status: response.status, json, text };
}

/**
 * Create this run's branch, and return its id.
 *
 * `read_write` is asked for explicitly even though a branch may not need it
 * named: this branch exists to be written to by a gate that calls `clearAll`,
 * and a default that silently made it read-only would fail at the first write
 * with a message about permissions rather than about a branch nobody could use.
 */
export async function createBranch(ctx, { name, parentId, expires }) {
  const created = await call(ctx, `/projects/${ctx.projectId}/branches`, {
    method: 'POST',
    body: {
      endpoints: [{ type: 'read_write' }],
      branch: { name, parent_id: parentId, expires_at: expires },
    },
  });
  if (!created.ok) {
    const detail = created.json?.error?.message ?? created.json?.message ?? created.text ?? '(no message)';
    return { error: `creating branch ${name} returned HTTP ${created.status}: ${detail}`, status: created.status };
  }
  const id = created.json?.branch?.id ?? '';
  if (id === '') {
    // Loud, because an empty id downstream is read by the next step as "the
    // remote leg did not run" — a quiet skip where a failure belongs.
    return {
      error: `the console accepted branch ${name} but answered with no id: ${created.text.slice(0, 200)}`,
      status: created.status,
    };
  }
  return { id, expires };
}

/**
 * Wait until the branch's compute has started.
 *
 * A branch is created before it can serve, and querying it too early fails in a
 * way that reads like a broken driver rather than a branch that does not exist
 * yet. So this polls and reports how many attempts it took, because "ready
 * after 1 attempt" and "ready after 47" are different stories about somebody's
 * console and the log should say which happened.
 */
export async function awaitReady(ctx, { attempts = READY_ATTEMPTS, intervalMs = READY_INTERVAL_MS, sleep } = {}) {
  const wait = sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  let state = 'absent';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const listed = await call(ctx, `/projects/${ctx.projectId}/branches`);
    if (!listed.ok) {
      const detail = listed.json?.error?.message ?? listed.text ?? '(no message)';
      return { error: `listing branches to wait for readiness returned HTTP ${listed.status}: ${detail}`, status: listed.status };
    }
    state = (listed.json?.branches ?? []).find((b) => b.id === ctx.branchId)?.current_state ?? 'absent';
    if (state === 'ready') return { ready: true, attempt };
    if (attempt === attempts) break;
    await wait(intervalMs);
  }
  return { error: `branch ${ctx.branchId} never became ready (last state: ${state})`, status: 0 };
}

/**
 * The connection URI for this branch, and the password in it, kept apart.
 *
 * The password is returned rather than redacted here so the caller can hand it
 * to GitHub's `::add-mask::` — which masks it in every later line of the log,
 * including the ones this program cannot see. Redacting before masking would
 * print a URL with no password in it and mask nothing, and the unredacted form
 * would still be in the shell history of whoever ran this by hand.
 */
export async function connectionUri(ctx) {
  const path =
    `/projects/${ctx.projectId}/connection_uri` +
    `?branch_id=${encodeURIComponent(ctx.branchId)}`;
  const resolved = await call(ctx, path);
  if (!resolved.ok) {
    const detail = resolved.json?.error?.message ?? resolved.text ?? '(no message)';
    return { error: `resolving a connection URI returned HTTP ${resolved.status}: ${detail}`, status: resolved.status };
  }
  const uri = resolved.json?.uri ?? '';
  if (uri === '') {
    return { error: `the console answered with no connection URI: ${resolved.text.slice(0, 200)}`, status: resolved.status };
  }
  // Parsed rather than sedded. The shell version took the password out with a
  // regex over the whole string, which is fine until a URI carries something it
  // did not expect; this knows which part is which.
  let password = '';
  let host = '';
  let database = '';
  try {
    const parsed = new URL(uri);
    password = decodeURIComponent(parsed.password);
    host = parsed.hostname;
    database = parsed.pathname.replace(/^\//, '');
  } catch {
    return { error: `the console answered with a URI this program cannot parse: ${uri.slice(0, 120)}`, status: resolved.status };
  }
  return { uri, password, host, database };
}

/** Delete the branch. Returns whether it went, never throws: see the header. */
export async function dropBranch(ctx) {
  const dropped = await call(ctx, `/projects/${ctx.projectId}/branches/${ctx.branchId}`, { method: 'DELETE' });
  return {
    ok: dropped.status === 200 || dropped.status === 204,
    status: dropped.status,
    detail: dropped.json?.error?.message ?? dropped.text ?? '',
  };
}

/**
 * A line for the job log. Written to stderr so a caller can redirect stdout —
 * which is how the ids reach `$GITHUB_ENV`, where a stray line becomes an
 * environment variable nothing reads.
 */
function say(message) {
  process.stderr.write(`${message}\n`);
}

/** GitHub's own failure channel: renders as a red annotation on the run. */
function fail(message) {
  process.stderr.write(`::error title=Store gate::${message}\n`);
  return 1;
}

/** And the softer one, for a problem that must not bury the gate's verdict. */
function warn(message) {
  process.stderr.write(`::warning title=Store gate::${message}\n`);
  return 0;
}

/**
 * Appended to `$GITHUB_ENV`, one line, opened and closed per write.
 *
 * No-op when there is no such file, which is the case when a person runs this by
 * hand — and the reason the ids are also logged, so a by-hand run is not a
 * silent one.
 */
function exportEnv(name, value) {
  const file = process.env.GITHUB_ENV;
  if (!file) return;
  appendFileSync(file, `${name}=${value}\n`, 'utf8');
}

/** `create`, `uri`, `drop`, `report` — the four things the workflow calls. */
async function lifecycle(mode, env = process.env, argv = []) {
  // Before `addresses`, deliberately: this mode runs precisely when the
  // addresses are missing, so asking for them first would refuse for the wrong
  // reason and name the wrong thing.
  if (mode === 'report') {
    const reported = reportRemoteLeg(env, { forkPullRequest: argv.includes('--fork-pr') });
    return reported.level === 'error' ? 1 : 0;
  }

  const { apiKey, projectId, parentBranchId, name } = addresses(env);
  const ctx = { apiKey, projectId, parentBranchId, base: apiBase(env), fetchImpl: fetch };

  if (mode === 'create') {
    let expires;
    try {
      expires = expiresAt(new Date(), expiryHours(env));
    } catch (error) {
      return fail(`${error.message} — refusing to create a branch that cannot delete itself`);
    }
    const made = await createBranch(ctx, { name, parentId: parentBranchId, expires });
    if (made.error) return fail(made.error);
    exportEnv('BRANCH_ID', made.id);
    say(`created branch ${name} (${made.id}), expiring ${expires}`);

    const ready = await awaitReady({ ...ctx, branchId: made.id });
    if (ready.error) return fail(ready.error);
    say(`branch ready after ${ready.attempt} attempt(s)`);
    return 0;
  }

  const branchId = (env.BRANCH_ID ?? '').trim();
  if (branchId === '') {
    // Reached when the create step never got far enough to export one. That is
    // a setup failure, not something to invent an id for.
    return fail('BRANCH_ID is not set, so there is no branch to work on — the create step did not get that far');
  }

  if (mode === 'uri') {
    const resolved = await connectionUri({ ...ctx, branchId });
    if (resolved.error) return fail(resolved.error);
    if (resolved.password !== '') process.stderr.write(`::add-mask::${resolved.password}\n`);
    say(`store gate database: ${resolved.host}/${resolved.database} (password masked)`);
    exportEnv('DELEGATE_STORE_TEST_URL', resolved.uri);
    return 0;
  }

  if (mode === 'drop') {
    const dropped = await dropBranch({ ...ctx, branchId });
    if (dropped.ok) {
      say(`dropped branch ${name} (${branchId})`);
      return 0;
    }
    return warn(`could not drop branch ${name} (HTTP ${dropped.status}) — it expires on its own: ${dropped.detail}`);
  }

  return fail(`unknown mode "${mode}" — this program does create, uri, drop and report`);
}

/**
 * The decisions, against a stub. Proves the properties that matter and that no
 * account is needed to check: a branch is asked to be writable, a branch that
 * is not ready is waited for rather than used, an expiry that cannot be computed
 * refuses the run instead of creating something that never cleans itself up,
 * and a delete that fails is a warning rather than a verdict on the gate.
 */
function selfTest() {
  let failures = 0;
  const check = (name, passed, detail) => {
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
    if (!passed) failures += 1;
  };

  /**
   * Runs something with both streams captured, and hands them back.
   *
   * The checks below assert on what a refusal PRINTS, so they cannot let it
   * print: a self-test whose own output is interleaved with the annotations it
   * is testing is harder to read than one that is not, and `::error` in the
   * middle of a list of passes reads as a failure that did not happen.
   */
  const silenced = async (run) => {
    const out = [];
    const err = [];
    const realOut = process.stdout.write.bind(process.stdout);
    const realErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (chunk) => (out.push(String(chunk)), true);
    process.stderr.write = (chunk) => (err.push(String(chunk)), true);
    try {
      // AWAIT FIRST. An object literal evaluates its properties in order, so
      // `out: out.join(''), result: await run()` would read both arrays before
      // anything was ever written to them — and would report "printed nothing"
      // for a refusal that printed everything.
      const result = await run();
      return { out: out.join(''), err: err.join(''), result };
    } finally {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
    }
  };

  const base = 'https://console.neon.tech/api/v2';
  const recorder = (routes) => {
    const seen = [];
    const stubFetch = async (url, init = {}) => {
      const method = init.method ?? 'GET';
      const path = url.replace(base, '');
      seen.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
      const route = routes[`${method} ${path.split('?')[0]}`];
      if (!route) return { ok: false, status: 404, text: async () => JSON.stringify({ error: { message: `no route for ${method} ${path}` } }) };
      const { status = 200, body = {} } = route;
      return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
    };
    return { seen, stubFetch };
  };

  return (async () => {
    const env = {
      NEON_API_KEY: 'k',
      NEON_PROJECT_ID: 'proj-1',
      NEON_PARENT_BRANCH_ID: 'br-parent',
      BRANCH_NAME: 'ci-123-1',
    };
    const ctx = { apiKey: 'k', projectId: 'proj-1', base };

    // A branch nobody can write is a branch the gate cannot use.
    {
      const { seen, stubFetch } = recorder({
        'POST /projects/proj-1/branches': { status: 201, body: { branch: { id: 'br-run' } } },
        'GET /projects/proj-1/branches': { body: { branches: [{ id: 'br-run', current_state: 'ready' }] } },
      });
      const made = await createBranch(
        { ...ctx, fetchImpl: stubFetch },
        { name: 'ci-123-1', parentId: 'br-parent', expires: expiresAt() },
      );
      const post = seen.find((c) => c.method === 'POST');
      check(
        'a branch is created writable, from the parent, and it expires',
        made.id === 'br-run' &&
          post.body.endpoints.some((e) => e.type === 'read_write') &&
          post.body.branch.parent_id === 'br-parent' &&
          post.body.branch.expires_at !== undefined,
        `endpoints ${JSON.stringify(post.body.endpoints)}, parent ${post.body.branch.parent_id}, expires ${post.body.branch.expires_at}`,
      );
    }

    // A branch that has not started yet is waited for.
    {
      const states = ['init', 'init', 'ready'];
      let call_ = 0;
      const stubFetch = async (url) => {
        const state = states[Math.min(call_, states.length - 1)];
        call_ += 1;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ branches: [{ id: 'br-run', current_state: state }] }),
        };
      };
      let slept = 0;
      const ready = await awaitReady(
        { ...ctx, branchId: 'br-run', fetchImpl: stubFetch },
        { intervalMs: 1, sleep: async (ms) => { slept += ms; } },
      );
      check(
        'a branch still initialising is polled until it is ready, not used',
        ready.ready === true && ready.attempt === 3 && slept === 2,
        `ready after attempt ${ready.attempt}, having waited ${slept}ms`,
      );
    }

    // A branch that never starts is a failure naming itself, not a hang.
    {
      let stubFetch = async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ branches: [{ id: 'br-run', current_state: 'init' }] }),
      });
      const ready = await awaitReady({ ...ctx, branchId: 'br-run', fetchImpl: stubFetch }, {
        attempts: 3,
        intervalMs: 1,
        sleep: async () => {},
      });
      check(
        'a branch that never becomes ready gives up and says so',
        ready.error?.includes('never became ready') && ready.error.includes('init'),
        ready.error ?? '(no error — it waited forever instead)',
      );
    }

    // A create that answers with no id is loud: an empty id is read downstream
    // as "the remote leg did not run".
    {
      const stubFetch = async () => ({ ok: true, status: 201, text: async () => JSON.stringify({ branch: {} }) });
      const made = await createBranch({ ...ctx, fetchImpl: stubFetch }, { name: 'x', parentId: 'p', expires: 'e' });
      check(
        'a create answered with no id is refused rather than exported empty',
        made.error !== undefined && made.error.includes('no id'),
        made.error ?? 'it returned an empty id',
      );
    }

    // The password is separated from the URI, because one is masked and one is
    // exported.
    {
      const stubFetch = async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ uri: 'postgres://ci:s3cret@ep-x.neon.tech/mydb' }),
      });
      const resolved = await connectionUri({ ...ctx, branchId: 'br-run', fetchImpl: stubFetch });
      check(
        'a connection URI yields its password and host separately, never by regex',
        resolved.password === 's3cret' && resolved.host === 'ep-x.neon.tech' && resolved.database === 'mydb',
        `host ${resolved.host}, database ${resolved.database}, password ${resolved.password === '' ? '(none)' : '(found)'}`,
      );
    }

    // A URI that is not a URI is refused, not exported for a driver to choke on.
    {
      const stubFetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ uri: 'not a uri' }) });
      const resolved = await connectionUri({ ...ctx, branchId: 'br-run', fetchImpl: stubFetch });
      check(
        'a URI this program cannot parse is refused rather than exported',
        resolved.error !== undefined && resolved.error.includes('cannot parse'),
        resolved.error ?? 'it passed a string nobody can parse straight to the driver',
      );
    }

    // A delete is allowed to fail without failing the job.
    {
      const stubFetch = async () => ({ ok: false, status: 500, text: async () => JSON.stringify({ error: { message: 'boom' } }) });
      const dropped = await dropBranch({ ...ctx, branchId: 'br-run', fetchImpl: stubFetch });
      check(
        'a delete that fails is reported as not-dropped, not thrown',
        dropped.ok === false && dropped.status === 500 && dropped.detail.includes('boom'),
        `HTTP ${dropped.status}, ${dropped.detail}`,
      );
    }

    // An expiry that cannot be computed refuses the run.
    {
      let refused = '(nothing thrown)';
      try {
        expiresAt(new Date(Number.NaN));
      } catch (error) {
        refused = error.message;
      }
      check(
        'an expiry that cannot be computed refuses rather than creating a branch that never expires',
        refused.includes('could not compute an expiry') && !refused.includes('Invalid time value'),
        refused,
      );
    }

    // And a real expiry is six hours out, in the shape Neon accepts.
    {
      const at = expiresAt(new Date('2026-01-01T00:00:00.000Z'));
      const hours = (new Date(at).getTime() - Date.parse('2026-01-01T00:00:00.000Z')) / 3_600_000;
      check(
        'an expiry is six hours from now, to the second, and parseable',
        hours === 6 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(at) && !Number.isNaN(Date.parse(at)),
        `${at} (+${hours}h)`,
      );
    }

    // Missing addresses are refused by name, not half-used.
    {
      let refused = '(nothing thrown)';
      try {
        addresses({ NEON_API_KEY: 'k', NEON_PROJECT_ID: '', NEON_PARENT_BRANCH_ID: '', BRANCH_NAME: '' });
      } catch (error) {
        refused = error.message;
      }
      check(
        'missing addresses are named together, so one run says everything it lacks',
        ['NEON_PROJECT_ID', 'NEON_PARENT_BRANCH_ID', 'BRANCH_NAME'].every((k) => refused.includes(k)),
        refused.split('.')[0],
      );
    }

    // ── the refusal a job actually fails on ──────────────────────────────
    //
    // This is the message the store job goes red with every push while there is
    // no Neon account, and it was a string in a YAML shell block that nothing
    // read back. A refusal nobody checks is prose; these are the properties that
    // make it worth printing at all.
    {
      const refusal = remoteLegRefusal('push');
      const named = REQUIRED_SECRETS.filter((secret) => refusal.includes(secret));
      check(
        'the refusal names all three secrets, so the reader knows what to set',
        named.length === 3,
        `${named.length} of 3: ${named.join(', ') || 'none'}`,
      );

      check(
        'and it says the KEY alone fixes it, because the two ids are found by name',
        refusal.includes('NEON_API_KEY alone') &&
          refusal.includes('finds or creates the other two by name'),
        'an edit that told somebody to mint three secrets when one is enough would send them down the wrong path',
      );

      check(
        'it says what went untested, not only that something is missing',
        refusal.includes('serverless driver') && refusal.includes('untested rather than assumed'),
        'the reader has to know WHY this fails a job rather than which variable is empty',
      );

      check(
        'and it points at the step that would say more when a key IS present',
        refusal.includes('create step') && refusal.includes('#the-store-gate-against-a-real-database'),
        'the two failures — no key, and a key whose call failed — must not read the same',
      );
    }

    // The severity split, which is the reason this is not one message.
    {
      const { result: reported } = await silenced(() =>
        reportRemoteLeg({ DELEGATE_STORE_TEST_URL: '' }, { forkPullRequest: true }),
      );
      check(
        'a fork pull request is a NOTICE, because GitHub sends it no secrets and the leg cannot run',
        reported.level === 'notice' && reported.message.includes('fork pull request'),
        `level ${reported.level}`,
      );
    }

    // And the leg that ran is not a failure, whatever else is missing.
    {
      const { result: reported } = await silenced(() =>
        reportRemoteLeg({ DELEGATE_STORE_TEST_URL: 'postgres://u:p@h/d' }, { forkPullRequest: true }),
      );
      check(
        'a run WITH a connection URI is not refused, even on a fork — the key is not the claim, the URI is',
        reported.level === 'pass' && reported.message === '',
        `level ${reported.level}${reported.message ? `: ${reported.message}` : ''}`,
      );
    }

    // The refusal goes to stderr as a GitHub annotation. Stdout here is
    // $GITHUB_ENV, and a stray line there is an environment variable nothing reads.
    {
      const { out, err, result: code } = await silenced(() =>
        lifecycle('report', { DELEGATE_STORE_TEST_URL: '', GITHUB_EVENT_NAME: 'push' }, []),
      );
      check(
        'the refusal is a ::error on stderr, exits 1, and prints nothing to stdout',
        code === 1 &&
          err.startsWith('::error title=Store gate::') &&
          out === '' &&
          REQUIRED_SECRETS.every((s) => err.includes(s)),
        `exit ${code}, stdout ${out === '' ? 'empty' : 'HAD A LINE'}, ${err.split('\n')[0]?.slice(0, 48) ?? '(silent)'}`,
      );
    }

    console.log(failures === 0 ? '\nall neon-branch checks passed' : `\n${failures} neon-branch check(s) FAILED`);
    return failures === 0 ? 0 : 1;
  })();
}

/**
 * The whole lifecycle against a fake console, over real HTTP.
 *
 * The branch is deliberately held in `init` for its first three polls, because
 * that window is the reason the poll exists and no stub has ever modelled it.
 * Then: the URI resolves for THAT branch, and the delete is followed by a
 * lookup that has to come back 404 — a delete that reported success while
 * leaving the branch would leave every subsequent run seeding into a database
 * the gate believes it dropped.
 */
async function selfTestE2e() {
  let failures = 0;
  const check = (name, passed, detail) => {
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
    if (!passed) failures += 1;
  };

  // The parent, created the way the provisioning script creates it: no parent,
  // so it starts empty and the run branch is branched from nothing but the
  // schema it will be given.
  const fake = await startFakeNeon({ apiKey: 'test-key', readyAfter: 3 });
  const base = fake.url;
  const ctx = {
    apiKey: 'test-key',
    projectId: 'proj-1',
    parentBranchId: 'br-parent',
    base,
    fetchImpl: fetch,
  };
  try {
    // The fake needs a project and a parent before a branch means anything.
    const project = await neon('/projects', { apiKey: 'test-key', base, method: 'POST', body: { name: 'primero-galaxy-ci' } });
    await neon(`/projects/${project.project.id}/branches`, {
      apiKey: 'test-key',
      base,
      method: 'POST',
      body: { branch: { name: 'ci-parent' } },
    });

    const name = 'ci-12345-1';
    const expires = expiresAt();
    const made = await createBranch(ctx, { name, parentId: 'br-parent', expires });
    check(
      'the create is accepted, returns an id, and asks for a writable branch that expires',
      made.id !== undefined && made.expires === expires,
      `branch ${made.id ?? '(none)'}, expiring ${expires}`,
    );

    const post = fake.requests.find((r) => r.method === 'POST' && r.path.endsWith('/branches') && r.body?.branch?.name === name);
    // The expiry is checked as a TIME, not for equality with what we computed:
    // an implementation that computed nothing and sent nothing would satisfy an
    // equality check against its own empty string, and a branch with no expiry is
    // exactly the leak this program exists to prevent.
    const sentExpiry = Date.parse(post.body.branch.expires_at ?? '');
    check(
      'the request carries read_write, the parent, and a real future expiry — over HTTP',
      post.body.endpoints.some((e) => e.type === 'read_write') &&
        post.body.branch.parent_id === 'br-parent' &&
        post.body.branch.expires_at === expires &&
        Number.isFinite(sentExpiry) &&
        sentExpiry > Date.now(),
      `endpoints ${JSON.stringify(post.body.endpoints)}, parent ${post.body.branch.parent_id}, expires ${post.body.branch.expires_at}`,
    );

    const ready = await awaitReady({ ...ctx, branchId: made.id }, { intervalMs: 1, sleep: async () => {} });
    check(
      'a branch held in init is waited for rather than used, and the wait is counted',
      ready.ready === true && ready.attempt === 3,
      `ready after attempt ${ready.attempt} — the console held it back for the first two`,
    );

    const resolved = await connectionUri({ ...ctx, branchId: made.id });
    const uriCall = fake.requests.filter((r) => r.path.endsWith('/connection_uri'));
    check(
      'the URI is resolved for the branch that was created, asked for by id',
      uriCall.length === 1 && uriCall[0].query.get('branch_id') === made.id && resolved.uri.includes(made.id),
      `asked for branch_id=${uriCall[0]?.query.get('branch_id')}`,
    );

    check(
      'the password is separated from the URI for masking, and is never in what is logged',
      resolved.password === 'hunter2' && !resolved.uri.replace(resolved.password, '(masked)').includes('hunter2'),
      `password found for ${resolved.host}/${resolved.database}`,
    );

    const dropped = await dropBranch({ ...ctx, branchId: made.id });
    check('the delete is accepted', dropped.ok === true, `HTTP ${dropped.status}`);

    const afterDelete = await fetch(`${base}/projects/proj-1/branches`, {
      headers: { Authorization: 'Bearer test-key' },
    }).then((r) => r.json());
    check(
      'after the delete the branch is gone from the console, not merely reported dropped',
      !(afterDelete.branches ?? []).some((b) => b.id === made.id),
      `${(afterDelete.branches ?? []).length} branch(es) left: ${(afterDelete.branches ?? []).map((b) => b.name).join(', ')}`,
    );

    // And a URI for a dropped branch is refused, which is what a retry would hit.
    const afterDrop = await connectionUri({ ...ctx, branchId: made.id });
    check(
      'resolving a URI for the dropped branch is refused rather than answered',
      afterDrop.error !== undefined && afterDrop.error.includes('404'),
      afterDrop.error ?? 'the console answered for a branch that no longer exists',
    );

    // A wrong key fails the whole lifecycle rather than half-creating it.
    const refusedCtx = { ...ctx, apiKey: 'not-the-key' };
    const refused = await createBranch(refusedCtx, { name: 'ci-nope', parentId: 'br-parent', expires });
    check(
      'a key the console rejects is refused at the create, not after it',
      refused.error !== undefined && refused.error.includes('401'),
      refused.error ?? 'it got past the console',
    );

    // ── the expiry, as the CONSOLE judges it ───────────────────────────
    //
    // The four rules below are Neon's, not ours, and they are enforced by the
    // fake because they are the ones we cannot check ourselves: this program
    // can prove it SENT a well-formed expiry, and only the server can say
    // whether that expiry is one the console accepts. Each is a distinct 400,
    // because "invalid expires_at" with no reason is a message that sends
    // somebody to the wrong hour of the wrong day.
    //
    // Absent is deliberately still ACCEPTED. `neon-secrets.mjs` creates the
    // parent branch with no expiry because it must outlive the run, so a fake
    // that refused one would fail a correct program over a rule the console
    // does not enforce.
    {
      const cases = [
        ['no expiry at all', undefined, null],
        ['an expiry six hours out', expiresAt(), null],
        ['an expiry in the past', '2020-01-01T00:00:00Z', 'not in the future'],
        ['an expiry past the 30-day limit', expiresAt(new Date(), 24 * 40), 'more than 30 days out'],
        ['an expiry with no time zone', '2030-01-01T00:00:00', 'no time zone'],
        ['an expiry that is not a date', '2030-13-45T99:99:99Z', 'not a date the console can read'],
        ['an expiry that is not a string', 12345, 'must be an RFC 3339 timestamp'],
      ];
      const wrong = [];
      for (const [about, value, expected] of cases) {
        const at = await createBranch(
          { ...ctx, parentId: 'br-parent' },
          { name: `ci-expiry-${String(value).replace(/\W+/g, '-').slice(0, 24)}`, parentId: 'br-parent', expires: value },
        );
        if (expected === null) {
          if (at.error !== undefined) wrong.push(`${about} should have been accepted but was refused: ${at.error}`);
        } else if (at.error === undefined) {
          wrong.push(`${about} should have been refused and was not`);
        } else if (!at.error.includes(expected)) {
          // Refused, but for a reason nobody would recognise as the problem.
          wrong.push(`${about} was refused without saying "${expected}": ${at.error}`);
        }
      }
      check(
        'the console accepts a good expiry and refuses each bad one by name, and still accepts no expiry at all',
        wrong.length === 0,
        wrong.length === 0 ? `${cases.length} expiries judged, none wrongly` : wrong.join('; '),
      );
    }

    // ── and the four refusals on the CREATE paths ───────────────────────
    //
    // These are the console's strictness — the properties its own header names
    // as the reason it exists — and nothing in this repository asserted them.
    // Every other refusal it enforces was already pinned by a check in one of
    // the two programs: the bad bearer and the expired branch above, the URI for
    // a dropped branch above that. These four had no check anywhere, which meant
    // the strictness was a sentence in a comment rather than a behaviour. A fake
    // that forgave them would pass every program here, and it would pass the
    // doctor's own fixture that proves the nested `branch.name` matters — a
    // fixture that would then be green for the wrong reason instead of red for
    // the right one.
    //
    // Each asserts the refusal AND what the console KEPT, because the two halves
    // fail apart. A console that stopped answering 409 but still stored the row
    // looks correct from the client's side, and the harm is in what it kept: two
    // projects by one name, or two branches that every later run would pick
    // between at random.
    {
      // What the console said to a request it should have refused, or '' when
      // it let the request through. `neon()` frames every failure the same way,
      // so the reason is the part of the message worth reading back.
      const refusalOf = async (path, options) => {
        try {
          await neon(path, { apiKey: 'test-key', base, ...options });
          return '';
        } catch (error) {
          return error.message;
        }
      };
      const said = (message) => (message === '' ? 'the console let it through' : message.replace(/^Neon \w+ \S+ answered /, ''));

      const nameless = await refusalOf('/projects', { method: 'POST', body: { label: 'no name at all' } });
      check(
        'a project create with no name is refused rather than created nameless',
        nameless.includes('400') && nameless.includes('a project needs a name') && fake.projects().length === 1,
        `${said(nameless)}; ${fake.projects().length} project(s) exist`,
      );

      const twice = await refusalOf('/projects', { method: 'POST', body: { name: 'primero-galaxy-ci' } });
      const byName = fake.projects().filter((p) => p.name === 'primero-galaxy-ci');
      check(
        'a second project of the same name is a 409 rather than a second row',
        twice.includes('409') && byName.length === 1,
        `${said(twice)}; ${byName.length} project(s) named primero-galaxy-ci`,
      );

      const flat = await refusalOf(`/projects/${project.project.id}/branches`, { method: 'POST', body: { name: 'ci-nested' } });
      check(
        'a branch create whose name is not nested under `branch` is refused',
        flat.includes('400') &&
          flat.includes('nested branch.name') &&
          fake.branches(project.project.id).every((b) => b.name !== 'ci-nested'),
        `${said(flat)}; ${fake.branches(project.project.id).map((b) => b.name).join(', ') || '(no branches)'}`,
      );

      const twiceBranch = await refusalOf(`/projects/${project.project.id}/branches`, {
        method: 'POST',
        body: { branch: { name: 'ci-parent' } },
      });
      const parents = fake.branches(project.project.id).filter((b) => b.name === 'ci-parent');
      check(
        'a second branch of the same name is a 409 rather than a second row',
        twiceBranch.includes('409') && parents.length === 1,
        `${said(twiceBranch)}; ${parents.length} branch(es) named ci-parent`,
      );
    }

    // ── and the thing CI actually runs ────────────────────────────────���──
    //
    // Everything above calls the functions. CI does not: it runs this program
    // as a process, three times, with its addresses in the environment and its
    // output going to `$GITHUB_ENV`. That wrapper is where the answers actually
    // leave — a missed env write is a `BRANCH_ID` the next step cannot find,
    // and a masked password printed the wrong way round is a credential in a
    // log — so it is run here as a process rather than described as covered.
    const envFile = join(tmpdir(), `neon-branch-e2e-${process.pid}.env`);
    const scriptPath = fileURLToPath(import.meta.url);
    /**
     * ASYNC on purpose. The fake console is served by THIS process, so a
     * synchronous spawn would block the only thing that can answer the child's
     * HTTP: the child would wait for a response nobody was listening for and
     * this would wait for a child that cannot finish. Two minutes of hanging is
     * what that looks like, and the fix is not a longer timeout.
     */
    const runCli = (mode, extra = {}) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [scriptPath, mode], {
          env: {
            ...process.env,
            NEON_API_KEY: 'test-key',
            NEON_PROJECT_ID: 'proj-1',
            NEON_PARENT_BRANCH_ID: 'br-parent',
            BRANCH_NAME: 'ci-cli-1',
            NEON_API_URL: base,
            GITHUB_ENV: envFile,
            ...extra,
          },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => (stdout += chunk));
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('close', (status) => resolve({ status, stdout, stderr }));
      });

    rmSync(envFile, { force: true });
    try {
      const cliCreate = await runCli('create');
      const created = readFileSync(envFile, 'utf8');
      check(
        'the create step CI runs exports BRANCH_ID and reports the branch ready',
        cliCreate.status === 0 && /^BRANCH_ID=br-\d+$/m.test(created) && cliCreate.stderr.includes('branch ready after'),
        `${cliCreate.status === 0 ? 'exit 0' : `exit ${cliCreate.status}`}, wrote ${created.trim() || '(nothing)'}`,
      );

      // GitHub reads $GITHUB_ENV between steps and injects what it finds into
      // the next step's environment. Without that hand-off the `uri` step is
      // CORRECT to refuse — it has no BRANCH_ID — so the test has to make the
      // same hand-off, or it would be testing a sequence CI never runs.
      const exportedEnv = (key) =>
        (readFileSync(envFile, 'utf8').split('\n').find((line) => line.startsWith(`${key}=`)) ?? '').slice(key.length + 1);
      const branchId = exportedEnv('BRANCH_ID');

      const cliUri = await runCli('uri', { BRANCH_ID: branchId });
      const uriLine = (readFileSync(envFile, 'utf8').split('\n').find((line) => line.startsWith('DELEGATE_STORE_TEST_URL=')) ?? '');
      const exported = uriLine.slice('DELEGATE_STORE_TEST_URL='.length);
      check(
        'the URI step exports a usable URL and masks the password before logging it',
        cliUri.status === 0 &&
          /^postgres:\/\//.test(exported) &&
          exported.includes('hunter2') &&
          cliUri.stderr.includes('::add-mask::hunter2') &&
          !cliUri.stdout.includes('hunter2'),
        `exported ${exported.replace(/:[^:@]*@/, ':(masked)@')}; stdout carries ${
          cliUri.stdout.includes('hunter2') ? 'the PASSWORD' : 'no password'
        }`,
      );

      const cliDrop = await runCli('drop', { BRANCH_ID: branchId });
      const left = await fetch(`${base}/projects/proj-1/branches`, {
        headers: { Authorization: 'Bearer test-key' },
      }).then((r) => r.json());
      check(
        'the drop step CI runs removes the branch it was given',
        cliDrop.status === 0 &&
          !(left.branches ?? []).some((b) => b.name === 'ci-cli-1') &&
          cliDrop.stderr.includes('dropped branch ci-cli-1'),
        `${(left.branches ?? []).map((b) => b.name).join(', ') || 'no branches'} left`,
      );

      // And the OTHER half of the drop step: one the console refuses.
      //
      // This is the severity split the job lives on, and it is the reason
      // `warn()` exists separately from `fail()`. By the time this step runs the
      // gate has already answered; a cleanup that fails afterwards has nothing
      // left to say about the run's verdict, and a red job for it would bury
      // the one annotation somebody needs. What it must do instead is be loud
      // enough to be noticed and harmless enough not to stop anything.
      //
      // So the claim is three things together, and any one of them alone would
      // be the wrong thing to assert: the annotation is a `::warning` and not a
      // `::error` (the severity is the whole point — an error here would fail
      // the job over untidiness), the process still exits 0, and the message
      // says the branch expires on its own so the leak is bounded.
      //
      // `dropBranch` returning `{ ok: false }` is already asserted above, in
      // this program's stub mode, and that is a weaker claim by a long way: a
      // function that returns a failure nobody renders is not a warning, it is
      // an ignored result.
      {
        const doomed = await createBranch(ctx, {
          name: 'ci-cli-undroppable',
          parentId: 'br-parent',
          expires: expiresAt(),
        });
        const faultsBefore = fake.faults().length;
        // `on: 'DELETE'` — a method on its own, so this is every delete rather
        // than one of them. It is also the spelling that silently matched
        // nothing until the check that wanted it was written, which is why the
        // fired-fault assertion below is not ceremony.
        fake.failNext({ on: 'DELETE', status: 500 });
        const stuck = await runCli('drop', {
          BRANCH_ID: doomed.id,
          BRANCH_NAME: 'ci-cli-undroppable',
        });
        const firedNow = fake.faults().slice(faultsBefore);
        const survivors = await fetch(`${base}/projects/proj-1/branches`, {
          headers: { Authorization: 'Bearer test-key' },
        }).then((r) => r.json());
        check(
          'the console was actually asked to fail the delete, so this is about a refused drop',
          firedNow.length === 1 && firedNow[0].status === 500,
          firedNow.length === 0
            ? 'the 500 never arrived — the drop succeeded and the assertions below would have passed anyway'
            : `${firedNow[0].status} answered ${firedNow[0].call}`,
        );
        check(
          'a drop the console refuses is a ::warning and the step still exits 0',
          stuck.status === 0 &&
            stuck.stderr.startsWith('::warning title=Store gate::') &&
            !stuck.stderr.includes('::error') &&
            /HTTP 500/.test(stuck.stderr) &&
            /it expires on its own/.test(stuck.stderr) &&
            stuck.stdout === '',
          `exit ${stuck.status}, ${
            stuck.stderr.split('\n')[0]?.replace('::warning title=Store gate::', '').slice(0, 88) ?? '(it said nothing)'
          }${stuck.stdout === '' ? '' : `; WROTE ${stuck.stdout.split('\n')[0]}`}`,
        );
        check(
          'and the branch really is still there, so the warning is about a cleanup that did not happen',
          (survivors.branches ?? []).some((b) => b.id === doomed.id),
          `console holds ${(survivors.branches ?? []).map((b) => b.name).join(', ') || 'nothing'}`,
        );
      }

      // And a run with no addresses at all says which are missing, rather than
      // reaching the console with an empty project id.
      const bare = await runCli('create', {
        NEON_API_KEY: '',
        NEON_PROJECT_ID: '',
        NEON_PARENT_BRANCH_ID: '',
        BRANCH_NAME: '',
      });
      check(
        'a run with no addresses names all of them and creates nothing',
        bare.status === 1 &&
          bare.stderr.includes('::error') &&
          ['NEON_PROJECT_ID', 'NEON_PARENT_BRANCH_ID', 'BRANCH_NAME'].every((k) => bare.stderr.includes(k)) &&
          bare.stdout === '',
        bare.stderr.split('\n')[0]?.slice(0, 90) ?? '(it said nothing)',
      );

      // ── and the refusal as it reaches the LOG ────────────────────────
      //
      // A 400 from the console is only worth anything if it arrives as
      // something a person reads. The create step's own error path is
      // `fail()`, which writes a `::error` annotation to stderr, and THAT is
      // the claim being tested here: the console's reason, the HTTP status, and
      // the annotation all have to arrive together. A refusal that printed a
      // bare message to stdout would be invisible as a red annotation AND
      // corrupt `$GITHUB_ENV`, since stdout here is the file the next step
      // reads.
      //
      // `EXPIRY_HOURS` is the seam. It is a real input, not a test hook: the
      // refusal must be provable from outside the process, and the only way to
      // make a child compute a bad expiry is to tell it to.
      {
        // A SEPARATE $GITHUB_ENV. The file used above holds a BRANCH_ID from
        // the create that succeeded, so asserting on it here would pass
        // because of the earlier step rather than because this one wrote
        // nothing — the exact mistake the comment above is about.
        const refusalEnv = join(tmpdir(), `neon-branch-refused-${process.pid}.env`);
        rmSync(refusalEnv, { force: true });
        const refuse = (branch, hours) =>
          runCli('create', { BRANCH_NAME: branch, EXPIRY_HOURS: hours, GITHUB_ENV: refusalEnv });
        const zero = await refuse('ci-exp-zero', '0');
        const negative = await refuse('ci-exp-neg', '-4');
        const silly = await refuse('ci-exp-silly', 'banana');
        // The console's own words have to survive the trip, because "invalid
        // expires_at" without a reason sends a reader to the wrong hour.
        // Only the two the CONSOLE refuses are asked to carry an HTTP 400:
        // `banana` never reaches the console at all, because `expiryHours`
        // refuses it first, and its own annotation is checked below instead.
        const saidWhy = /::error title=Store gate::.*HTTP 400.*invalid expires_at.*(?:future|time zone|30 days)/s;
        const unreachable = /^::error title=Store gate::EXPIRY_HOURS is "banana", which is not a number of hours/;
        check(
          'a console refusal reaches the log as a ::error carrying the status AND the reason',
          [zero, negative].every(
            (run) => run.status === 1 && run.stderr.startsWith('::error title=Store gate::') && saidWhy.test(run.stderr),
          ) && silly.status === 1 && unreachable.test(silly.stderr),
          `0h and -4h annotated with the console's reason; "banana" hours ${
            unreachable.test(silly.stderr) ? 'refused before the call' : `said ${silly.stderr.split('\n')[0]?.slice(0, 60) ?? 'nothing'}`
          }`,
        );

        check(
          'and a refused create writes NOTHING to stdout, so a bad $GITHUB_ENV cannot become a branch id',
          [zero, negative, silly].every((run) => run.stdout === ''),
          [zero, negative, silly].map((run) => (run.stdout === '' ? 'clean' : `WROTE ${run.stdout.split('\n')[0]}`)).join(' / '),
        );

        // Nothing was created, and no BRANCH_ID was exported — so the next step
        // in the job cannot pick up an id for a branch that does not exist.
        const left = await fetch(`${base}/projects/proj-1/branches`, {
          headers: { Authorization: 'Bearer test-key' },
        }).then((r) => r.json());
        const stray = (left.branches ?? []).filter((b) => b.name.startsWith('ci-exp-'));
        const exportedId = existsSync(refusalEnv) && /^BRANCH_ID=/m.test(readFileSync(refusalEnv, 'utf8'));
        rmSync(refusalEnv, { force: true });
        check(
          'a refused create leaves no branch behind, and exports no id for one',
          stray.length === 0 && !exportedId,
          `${stray.length} stray branch(es); BRANCH_ID ${exportedId ? 'was exported anyway' : 'not exported'}`,
        );
      }
    } finally {
      rmSync(envFile, { force: true });
    }
  } finally {
    await fake.close();
  }

  console.log(
    failures === 0
      ? '\nall neon-branch end-to-end checks passed'
      : `\n${failures} end-to-end check(s) FAILED`,
  );
  return failures === 0 ? 0 : 1;
}

async function main(argv) {
  if (argv.includes('--self-test')) return selfTest();
  if (argv.includes('--self-test-e2e')) return selfTestE2e();
  const mode = argv.find((arg) => !arg.startsWith('-'));
  if (!mode) {
    console.error(
      'Usage: node scripts/neon-branch.mjs <create|uri|drop|report>\n' +
        '       node scripts/neon-branch.mjs report --fork-pr\n' +
        '       node scripts/neon-branch.mjs --self-test\n' +
        '       node scripts/neon-branch.mjs --self-test-e2e',
    );
    return 2;
  }
  try {
    return await lifecycle(mode, process.env, argv);
  } catch (error) {
    return fail(error.message);
  }
}

// Guarded like every other program here, and this one has to be: importing the
// module to reach a function used to RUN it, printing a usage message and
// setting the exit code of whatever imported it.
if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
