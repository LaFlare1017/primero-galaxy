#!/usr/bin/env node
/**
 * Put `npm run dev` back into a state that answers.
 *
 * The failure this exists for is the one that still looks like a working
 * checkout: a `next dev` left up since yesterday begins answering `500 Internal
 * Server Error` on every route — the bare string, no stack, nothing in its log —
 * because the compile it is holding has gone stale under it, or because a second
 * dev server was started against the same `.next/` while the first was still
 * running. The repair is three commands nobody remembers in the order they
 * matter (`kill`, `rm -rf .next`, `npm run dev`), and the first of them is the
 * one that goes wrong quietly, because the process holding the port is not
 * always the one you picture.
 *
 * So it does those three, in that order, and the order is the point. Nothing is
 * killed and nothing is cleared until a server has been found that can take
 * their place: a reset that stopped the running server and then discovered there
 * is no Next.js install here would leave the checkout worse off than it found
 * it, and that check is one `existsSync` away, so it goes first.
 *
 * The kill is scoped to this checkout, and that is not politeness. A port is a
 * machine-wide number, so the process holding `:3000` may be a dev server for
 * something else entirely — and this repo runs every program under `scripts/` in
 * a throwaway repository of its own (the doctor's `entrypoints` check), so a
 * reset that killed whatever held the port would be killing somebody's server
 * from inside a check. A process is only a candidate when its working directory
 * is this repository's root, and the walk up from the listener stops at the
 * first process that is not this checkout's dev stack, so the shell somebody
 * typed `npm run dev` into is never in the set however the chain is shaped: what
 * gets signalled is the session, topmost first, which is what Ctrl-C in that
 * terminal would have done.
 *
 * What it leaves behind is a `.next/` cleared while nothing was watching it and a
 * server in a session of its own, its output in a file under the system temp
 * directory — this repository's untracked gate asks about every path here, and a
 * log inside it would be one more thing to have an opinion about, in the one
 * directory this command deletes.
 *
 * The port is not written down twice: it is read from the `dev` script that
 * declares it, so a checkout that moves this server moves the reclaim with it.
 * The server started is that command — `next dev -p <port>` here — and having
 * started it, this asks the app for a page before claiming anything, since
 * "listening" and "serving" are the two states this whole command exists to tell
 * apart: a server that answers with a 500 is the failure being repaired, and
 * reporting it as success because the port came up would be the one wrong answer
 * available here.
 *
 * Every one of those refusals is planted rather than argued, in the
 * `proveItCan…` fixtures at the bottom, and they are asked for before anything
 * is destroyed — a reset that could no longer tell its own server from a
 * stranger's, or a serving one from a broken one, is not a slower reset but a
 * wrong one, so a fixture that fails is a reset that does not run. The states
 * planted are the ones the judgments are made on: a listener this checkout owns,
 * a listener another checkout owns, a listener whose parent is the very process
 * running the fixture, an `lsof` that is not installed, and a server that answers
 * 200 beside one that answers 500. The first of those is the control — a reset
 * that refused everything would pass the other four.
 *
 * The fixtures bind ports the OS has just handed out and never the port declared
 * by a real checkout, so proving the reclaim cannot reach a developer's running
 * server, and one of them says so out loud before it signals anything: a walk
 * that climbed into the process running the fixture would be signalling the very
 * thing checking it, which is a suicide rather than a proof.
 *
 * Usage:
 *   npm run dev:reset                        # reclaim, clear, start, check
 *   npm run dev:reset -- --dry-run           # print what it would do, change nothing
 *   npm run dev:reset -- --log ./dev.log     # write the server's output somewhere else
 *
 * Exit codes: 0 the server is up and answering · 1 the port belongs to something
 * that is not this checkout (or `--dry-run`, which restarts nothing and so
 * leaves the state it was asked to repair exactly as it found it) · 2 it could
 * not run, a fixture refused to prove it, or the server it started is answering
 * with bad news.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, show } from './doctor/lib.mjs';
import { isMain } from './is-main.mjs';

/** Where the dev server listens when the `dev` script does not say. */
const DEFAULT_PORT = 3000;

/** A member of the dev stack: the Next.js CLI, the server it spawns, npm above them. */
const DEV_STACK = /next|npm/i;

/** How long the session gets to exit on SIGTERM, and then on SIGKILL. */
const TERM_GRACE = 10_000;
const KILL_GRACE = 5_000;

/** How long a fresh server gets to bind the port, and then to answer on it. */
const START_GRACE = 30_000;
const ANSWER_GRACE = 30_000;

/** How often any of those questions is asked again while it is waiting. */
const POLL = 250;

/** How far up the process tree the search for the session's top may go. */
const DEPTHS = 8;

function say(mark, text) {
  console.log(`${mark} ${text}`);
}

/** Where a server started here writes, deliberately outside the repository. */
export function logPath() {
  return join(tmpdir(), 'primero-galaxy-dev.log');
}

/**
 * The port `npm run dev` binds, read from the script that declares it rather than
 * repeated here. A manifest that is missing, unparseable, or says something this
 * cannot read is not a reason to take the run down: it is a reason to fall back
 * to the port every Next.js dev server here has used.
 */
export function devPort(root) {
  const manifest = join(root, 'package.json');
  if (!existsSync(manifest)) return DEFAULT_PORT;
  try {
    const declared = JSON.parse(readFileSync(manifest, 'utf8'))?.scripts?.dev ?? '';
    const match = declared.match(/next\s+dev\b[^&|;]*(?:-p|--port)\s+(\d+)/);
    return match ? Number(match[1]) : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

/** The Next.js CLI this checkout would run: the package's own binary, then npm's shim. */
function nextBinary(root) {
  return (
    [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), join(root, 'node_modules', '.bin', 'next')].find(
      (path) => existsSync(path),
    ) ?? null
  );
}

/**
 * The pids holding the port, or null when that could not be asked at all — two
 * different answers, and the difference is the whole of the refusal below. `lsof`
 * exits 1 saying nothing when nothing holds a port, which is an answer; a machine
 * with no `lsof` is not, and a reset that read it as "the port is free" would
 * start a second server against the cache it is about to clear.
 *
 * The binary is a parameter so that difference can be planted: the reading is
 * the code under test either way, and only where the program lives is swapped.
 */
function listeners(port, { lsof = 'lsof' } = {}) {
  const asked = spawnSync(lsof, ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
  if (asked.error) return null;
  const pids = (asked.stdout ?? '')
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(Number);
  if (pids.length > 0) return pids;
  return asked.status === 1 ? [] : null;
}

/**
 * What a pid is, as far as this can see: its command, its parent, and the real
 * path of its working directory. The cwd is resolved rather than trusted because
 * it is compared to this checkout's root, and on macOS a temp directory reached
 * through `/var` is `/private/var` for real — the same trap `is-main.mjs` exists
 * for, in the same comparison. A cwd that cannot be read stays null, and null is
 * never equal to the root: the refusal below is allowed to be wrong about a
 * stranger, and not about this checkout.
 */
function processInfo(pid) {
  const shown = spawnSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], { encoding: 'utf8' });
  const told = (shown.stdout ?? '').trim();
  const parts = told.match(/^(\d+)\s+([\s\S]+)$/);
  if (!parts) return null;
  const [, ppid, command] = parts;

  const dir = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
  const where = (dir.stdout ?? '').split('\n').find((entry) => entry.startsWith('n'));
  let cwd = null;
  if (where) {
    try {
      cwd = realpathSync(where.slice(1));
    } catch {
      cwd = null;
    }
  }
  return { pid, ppid: Number(ppid), command: command.trim(), cwd };
}

/** A process named the way its owner would recognise it. */
function describe(info) {
  return `pid ${info.pid}  ${info.command}`;
}

/**
 * This checkout's dev stack, from the listener at the port upward: every
 * consecutive ancestor that is still this repository's and still `next` or `npm`.
 * The walk stops at the first one that is neither, which is what keeps a shell —
 * or anything else that happened to start the server — out of the set.
 */
function session(pid, root) {
  const top = realpathSync(root);
  const chain = [];
  let current = pid;
  for (let depth = 0; depth < DEPTHS && current > 1; depth += 1) {
    const info = processInfo(current);
    if (!info || info.cwd !== top || !DEV_STACK.test(info.command)) break;
    chain.push(info);
    current = info.ppid;
  }
  return chain;
}

/** Sends a signal, and treats a process that is already gone as having obeyed. */
function signal(pid, name) {
  try {
    process.kill(pid, name);
    return true;
  } catch (error) {
    return error.code === 'ESRCH';
  }
}

/** Whether a process is still there, asked the only way that asks nothing. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'ESRCH' ? false : true;
  }
}

/** The port is free when nothing holds it — a question only the reader may answer. */
const free = (port, options) => {
  const held = listeners(port, options);
  return held !== null && held.length === 0;
};

/**
 * What is on the port, and whether this checkout may stop it. One question,
 * asked before anything is signalled, and it asks for nothing: a `--dry-run`
 * and a real run both come through here, so the plan they print and the kill
 * they do cannot come to disagree about who was listening.
 *
 *   free            nothing holds it
 *   ours            this checkout's dev session, named topmost first
 *   foreign         somebody else's, which is a refusal and not a judgement
 *   unanswerable    no `lsof` to ask, which is not the same as a free port
 */
function inspect(port, root, { lsof } = {}) {
  const top = realpathSync(root);
  const held = listeners(port, { lsof });
  if (held === null) return { status: 'unanswerable', held: [] };
  if (held.length === 0) return { status: 'free', held, holders: [], stopping: [] };

  const holders = held.map((pid) => ({ pid, info: processInfo(pid) }));
  const foreign = holders.filter(({ info }) => info === null || info.cwd !== top);
  if (foreign.length > 0) return { status: 'foreign', held, holders, foreign, stopping: [] };

  const stack = holders.flatMap(({ pid }) => session(pid, top));
  // The top of the session is what Ctrl-C would have signalled, and signalling
  // the whole of it in that order is what makes the port free rather than nearly
  // free: a `node .../next` left holding the listener for a second longer than
  // its server is the race that hands the next start an EADDRINUSE.
  const stopping = stack.length > 0 ? [...stack].reverse() : holders.map(({ info }) => info);
  return { status: 'ours', held, holders, foreign: [], stopping };
}

/** `inspect`, and then the signalling — the one part of this file that kills. */
async function reclaim(port, root, { lsof } = {}) {
  const found = inspect(port, root, { lsof });
  if (found.status !== 'ours') return found;

  for (const info of found.stopping) signal(info.pid, 'SIGTERM');
  if (!(await waiting(() => free(port, { lsof }), TERM_GRACE))) {
    for (const info of found.stopping) signal(info.pid, 'SIGKILL');
    if (!(await waiting(() => free(port, { lsof }), KILL_GRACE))) return { ...found, status: 'held' };
    return { ...found, status: 'stopped', escalated: true, signalled: found.stopping.map((i) => i.pid) };
  }
  return { ...found, status: 'stopped', escalated: false, signalled: found.stopping.map((i) => i.pid) };
}

/** Whether anything accepts a connection on the port, on one loopback family. */
function answers(port, host) {
  return new Promise((done) => {
    const socket = connect({ port, host });
    const settle = (yes) => {
      socket.destroy();
      done(yes);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

/** Waits for a question about the machine to change its answer, or gives up. */
async function waiting(when, grace) {
  const deadline = Date.now() + grace;
  for (;;) {
    if (await when()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((done) => setTimeout(done, POLL));
  }
}

/** Whether the server on the port is reachable at all, on either loopback address. */
const up = async (port) => (await answers(port, '127.0.0.1')) || (await answers(port, '::1'));

/** Asks the app for its landing page, the way a browser would. Null when nothing came back. */
async function probe(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(ANSWER_GRACE) });
    return response.status;
  } catch {
    return null;
  }
}

/** The program itself: reclaim, clear, start, ask. Every step here can destroy something. */
async function run({ root = null, dryRun = false, lsof = 'lsof', log = null } = {}) {
  const top = realpathSync(root ?? git(['rev-parse', '--show-toplevel']));
  const port = devPort(top);
  const where = log ?? logPath();

  // First, because everything after it destroys. There is no rearrangement of
  // these steps that makes killing the server before knowing this safe.
  const next = nextBinary(top);
  if (next === null) {
    console.error('✗ No Next.js install here — there would be nothing to start.');
    console.error('\n    npm install\n\nNothing was killed and nothing was cleared.');
    return 2;
  }

  const found = inspect(port, top, { lsof });
  if (found.status === 'unanswerable') {
    console.error(`✗ Could not ask lsof which process holds :${port} — nothing was killed.`);
    console.error(
      `\nWithout that answer there is no telling this checkout's dev server from somebody else's,\n` +
        `and starting a second one against the same .next/ is one of the states this undoes.\n\n` +
        `    lsof -iTCP:${port} -sTCP:LISTEN\n`,
    );
    return 2;
  }
  if (found.status === 'foreign') {
    console.error(`✗ Refusing to reset: :${port} is held by a process that is not this checkout.\n`);
    for (const { pid, info } of found.foreign) {
      console.error(`    ${info === null ? `pid ${pid}  (could not be read)` : describe(info)}`);
    }
    console.error(`\n    (this checkout: ${top})\n`);
    console.error('Nothing was killed and nothing was cleared. If it is yours, stop it and run this again:');
    console.error(`\n    kill ${found.foreign.map(({ pid }) => pid).join(' ')}\n`);
    return 1;
  }

  const plan = [
    found.status === 'free'
      ? `nothing to reclaim on :${port}`
      : `reclaim :${port} from ${describe(found.stopping[0])}`,
    existsSync(join(top, '.next'))
      ? 'clear .next/, the compile cache the next server reads'
      : 'no .next/ to clear',
    `start ${show(next, top)} dev -p ${port}, detached, its output in ${where}`,
    `ask http://localhost:${port}/ for a page, and report what it says`,
  ];

  if (dryRun) {
    console.log(`dev:reset would, in ${top}:`);
    for (const step of plan) console.log(`    ${step}`);
    console.log('\nNothing was killed, nothing was cleared and nothing was started.');
    return 1;
  }

  const outcome = await reclaim(port, top, { lsof });
  if (outcome.status === 'free') {
    say('·', `nothing is listening on :${port} — no server to reclaim`);
  } else if (outcome.status === 'stopped') {
    const under = outcome.stopping.length - 1;
    say(
      '✓',
      `stopped ${describe(outcome.stopping[0])}${under > 0 ? ` and the ${under} process${under === 1 ? '' : 'es'} under it` : ''}`,
    );
    if (outcome.escalated) say('⚠', `:${port} came free only on SIGKILL`);
  } else {
    console.error(`\n✗ :${port} is still held after SIGTERM and SIGKILL:`);
    for (const info of outcome.stopping) console.error(`    ${describe(info)}`);
    console.error('\nNothing was cleared and no server was started.');
    return 2;
  }

  const cache = join(top, '.next');
  if (existsSync(cache)) {
    rmSync(cache, { recursive: true, force: true });
    say('✓', 'cleared .next/');
  } else {
    say('·', 'no .next/ to clear');
  }

  const output = openSync(where, 'w');
  const child = spawn(process.execPath, [next, 'dev', '-p', String(port)], {
    cwd: top,
    detached: true,
    stdio: ['ignore', output, output],
    env: process.env,
  });
  closeSync(output);
  // Out of this process's session, so it is still there when this one is gone.
  child.unref();

  if (!(await waiting(() => up(port), START_GRACE))) {
    console.error(`\n✗ Started pid ${child.pid}, and nothing answered on :${port} within ${START_GRACE / 1000}s.`);
    console.error(`\n    ${where}\n`);
    return 2;
  }

  const serving = listeners(port, { lsof }) ?? [];
  say('✓', `next dev is listening on :${port}${serving.length > 0 ? ` (pid ${serving.join(', ')})` : ''}`);

  const status = await probe(port);
  if (status === null) {
    say('⚠', `http://localhost:${port}/ has not answered yet — the first compile may still be running`);
    console.log(`    ${where}`);
    return 0;
  }
  if (status >= 400) {
    console.error(`\n✗ http://localhost:${port}/ answers ${status} — this is the state dev:reset exists to end.`);
    console.error(`\n    ${where}\n`);
    return 2;
  }

  say('✓', `http://localhost:${port}/ answers ${status}`);
  console.log(`    http://localhost:${port}/galaxy`);
  console.log(`    log: ${where}`);
  return 0;
}

// ── the fixtures ───────────────────────────────────────────────────────────
//
// What the refusals rest on, planted rather than argued. Each is asked for once
// per process and remembered, because a reset asks for all of them on every run
// and the work is the same each time; a refusal is not remembered, so a fixture
// that fails fails again for the next caller.
//
// They call `run` and not `reset`, which is the same program with the asking
// removed — a fixture that ran the thing it is proving would ask it to prove
// itself again, for ever.

/**
 * Runs a fixture with the program's own reporting collected rather than shown,
 * and shows it only when the fixture fails. A reset should print what it did,
 * and two planted checkouts' worth of "cleared .next/" on the way there is noise
 * that makes the real lines harder to read. The lines are kept in the failure
 * message, because that is the one moment they are the point.
 */
async function quiet(proof) {
  const said = [];
  const shown = [console.log, console.error];
  console.log = (...args) => said.push(args.join(' '));
  console.error = (...args) => said.push(args.join(' '));
  try {
    await proof();
  } catch (error) {
    const transcript = said.map((line) => `    ${line}`).join('\n');
    throw new Error(`${error.message}\n\nwhat the program said while it was being asked:\n${transcript}`);
  } finally {
    [console.log, console.error] = shown;
  }
}

/**
 * Whether a process this program started is really gone, as opposed to merely
 * no longer listening. Those are different questions for a process that is still
 * this one's child: it holds nothing open and is still answerable, because a
 * child that has exited but has not been waited for keeps answering to a
 * signal-zero for as long as it stays a zombie. The exit event is the honest
 * answer, and a fixture that read a zombie as a survivor would be reporting its
 * own bookkeeping as a failure of the reclaim.
 */
function exited(child, grace) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((done) => {
    const timer = setTimeout(() => done(false), grace);
    child.once('exit', () => {
      clearTimeout(timer);
      done(true);
    });
  });
}

/** Asserts an answer, and says what was read when it is not the one wanted. */
function is(what, found, wanted) {
  if (JSON.stringify(found) !== JSON.stringify(wanted)) {
    throw new Error(`${what} reads ${JSON.stringify(found)} and not ${JSON.stringify(wanted)}`);
  }
}

/**
 * A port the OS has just handed out and given back, for a fixture to plant on.
 * The window between the release and the plant is a millisecond wide, and a
 * fixture that lost it would fail on a bind rather than pass for the wrong
 * reason.
 */
function freePort() {
  return new Promise((done) => {
    const taken = createServer();
    taken.listen(0, '127.0.0.1', () => {
      const { port } = taken.address();
      taken.close(() => done(port));
    });
  });
}

/** A scratch directory for a fixture, thrown away afterwards. */
function scratch(label) {
  return mkdtempSync(join(tmpdir(), `dev-reset-${label}-`));
}

/** The path a checkout's Next.js binary lives at, which is the one looked for. */
const binaryOf = (root) => join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

/**
 * The stand-in for Next.js a fixture runs. It holds the port it was told to
 * hold, answers every request with one status, and says which port it took so
 * the fixture never has to guess at one.
 *
 * It is written where the binary goes, because that is both the path this
 * program looks for and the path it starts — and so the command line it runs
 * under says `next`, which is what makes the session walk recognise it as part
 * of a dev stack instead of refusing it as a stranger.
 */
const SERVER = (status) => `import { createServer } from 'node:http';

const port = Number(process.argv[process.argv.indexOf('-p') + 1]);
createServer((request, response) => {
  response.writeHead(${status});
  response.end('a stand-in for the dev server\\n');
}).listen(port, () => console.log('PORT ' + port));
`;

/**
 * A checkout a fixture can point the program at: the manifest the port is read
 * from, a `.next/` whose survival or absence is an assertion, and a stand-in for
 * the Next.js binary. `install: false` is the state where there is nothing to
 * start, which is the one check that has to come before anything is destroyed.
 */
function checkout(root, port, { status = 200, install = true } = {}) {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture-checkout', scripts: { dev: `next dev -p ${port}` } })}\n`,
  );
  mkdirSync(join(root, '.next'), { recursive: true });
  writeFileSync(join(root, '.next', 'CACHE'), 'a compile cache a fixture can watch survive, or not\n');
  if (install) {
    mkdirSync(join(root, 'node_modules', 'next', 'dist', 'bin'), { recursive: true });
    writeFileSync(binaryOf(root), SERVER(status));
  }
  return root;
}

/** Starts a checkout's stand-in in that checkout, and waits until it says it is listening. */
function plant(root, port) {
  const child = spawn(process.execPath, [binaryOf(root), 'dev', '-p', String(port)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return new Promise((started, failed) => {
    let said = '';
    child.stdout.on('data', (chunk) => {
      said += chunk;
      if (said.includes('\n')) started(child);
    });
    child.once('exit', () => failed(new Error('the planted server exited before it said which port it took')));
  });
}

/** The stand-ins a proof started through `run`, which are detached by now. */
function stop(root) {
  for (const pid of listeners(devPort(root))) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone, which is the state this wanted.
    }
  }
}

/**
 * The control: it stops this checkout's own server, and stops nothing else.
 *
 * Planted: a listener running as a checkout's Next.js binary, holding a port that
 * belongs to that checkout. Without this the refusals below would prove nothing
 * at all — a reset that refused every port would pass every one of them, which is
 * the shape of a guard that has stopped guarding.
 *
 * The parent of the planted server is this very process, and it is not a dev
 * stack, so the walk has to stop there. That is checked before anything is
 * signalled rather than after: a walk that did climb in would be killing the
 * process doing the checking, and a fixture that kills itself proves nothing and
 * takes the run with it.
 */
let provedReclaim = false;
export async function proveItCanReclaimItsOwn() {
  if (provedReclaim) return;
  const port = await freePort();
  const root = checkout(scratch('own'), port);
  let child = null;
  try {
    child = await plant(root, port);
    is('the port while the planted server holds it', listeners(port), [child.pid]);

    if (session(child.pid, root).some((info) => info.pid === process.pid)) {
      throw new Error('the session walk climbed into the process running this fixture — refusing to signal it');
    }

    const outcome = await reclaim(port, root);
    is('a reclaim of this checkout\'s own server', outcome.status, 'stopped');
    is('the pids it signalled', outcome.signalled, [child.pid]);
    is('the port once the session is stopped', listeners(port), []);
    if (!(await exited(child, KILL_GRACE))) {
      throw new Error(`the planted server (pid ${child.pid}) survived the reclaim`);
    }
  } finally {
    if (child) {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        // The reclaim got it first, which is what it was for.
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
  provedReclaim = true;
}

/**
 * The refusals, and the one thing every refusal here has in common: it leaves
 * the checkout exactly as it found it. A reset that destroyed something while
 * reporting that it had not is worse than the stale server it was sent to clear.
 *
 * Planted twice, and the two states are the ones the program turns on:
 *
 *   nothing to start     a checkout with no `node_modules`, and a `.next/` full
 *                        of a cache to watch survive. This is the check that has
 *                        to come first, since everything after it destroys.
 *   not this checkout    a listener planted in a checkout of its own, on the
 *                        port this checkout declares. It has to come out of a
 *                        reclaim and a whole reset still running, still holding
 *                        the port, with this checkout's cache untouched — and
 *                        named, since a refusal that cannot name what it spared
 *                        is not much of a refusal.
 */
let provedRefusals = false;
export async function proveItCanRefuseWithoutDestroying() {
  if (provedRefusals) return;
  const home = scratch('refusals');
  const port = await freePort();
  let stranger = null;
  try {
    const empty = checkout(join(home, 'no-install'), port, { install: false });
    is('a checkout with no Next.js install', nextBinary(empty), null);
    is('a reset with nothing to start', await run({ root: empty, log: join(empty, 'fixture.log') }), 2);
    if (!existsSync(join(empty, '.next', 'CACHE'))) {
      throw new Error('a reset with nothing to start cleared .next/ anyway');
    }

    const mine = checkout(join(home, 'mine'), port);
    const theirs = checkout(join(home, 'theirs'), port);
    stranger = await plant(theirs, port);

    const outcome = await reclaim(port, mine);
    is('a reclaim of a port held elsewhere', outcome.status, 'foreign');
    is('the pids it named', outcome.foreign.map(({ pid }) => pid), [stranger.pid]);
    if (!alive(stranger.pid)) throw new Error(`the reclaim killed pid ${stranger.pid}, which is not this checkout's`);
    is('the port the stranger still holds', listeners(port), [stranger.pid]);

    is('a reset against a port held elsewhere', await run({ root: mine, log: join(mine, 'fixture.log') }), 1);
    if (!existsSync(join(mine, '.next', 'CACHE'))) {
      throw new Error('a reset that refused a port still cleared .next/');
    }
  } finally {
    if (stranger) {
      try {
        process.kill(stranger.pid, 'SIGKILL');
      } catch {
        // The proof is over; this only tidies up.
      }
    }
    rmSync(home, { recursive: true, force: true });
  }
  provedRefusals = true;
}

/**
 * "Listening" and "serving" are the two states this program exists to tell
 * apart, so the verdicts are planted rather than argued: a stand-in that answers
 * 200 beside one that answers 500, each in a checkout of its own, each with a
 * `.next/` to watch cleared and a server to watch stopped afterwards.
 *
 * This is also the only fixture that exercises the whole program end to end —
 * the start, the bind, the page request and the exit code — so it is where a
 * reset that can no longer succeed at all would be caught. The one refusal it
 * cannot plant is a port that will not free after SIGKILL: a process cannot be
 * made to ignore SIGKILL, and the one way to reach that state is a listener this
 * user may not signal. That branch stays as it is, reached rather than proved.
 */
let provedVerdicts = false;
export async function proveItCanTellServingFromBroken() {
  if (provedVerdicts) return;
  const home = scratch('verdicts');
  try {
    const serving = checkout(join(home, 'serving'), await freePort(), { status: 200 });
    is('a reset whose server answers 200', await run({ root: serving, log: join(serving, 'fixture.log') }), 0);
    if (existsSync(join(serving, '.next', 'CACHE'))) {
      throw new Error('a reset that ended with a served page left the cache it clears in place');
    }
    stop(serving);

    const broken = checkout(join(home, 'broken'), await freePort(), { status: 500 });
    is('a reset whose server answers 500', await run({ root: broken, log: join(broken, 'fixture.log') }), 2);
    stop(broken);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  provedVerdicts = true;
}

/**
 * The two answers the port question can give that are not "something is holding
 * it", told apart before anything is destroyed.
 *
 * Planted: a port nothing is holding, and an `lsof` that is not installed. The
 * second is the trap — read as the first, it is a clear cache and a second
 * server against it, which is one of the states this program exists to undo, and
 * it would undo it on a machine that simply cannot answer. A reader that said
 * `[]` for both would pass the first assertion, which is why the two are asked
 * together and never one without the other.
 *
 * The reader is then asked through a whole reset, against a checkout that is
 * perfectly healthy and whose port nobody holds — the state a wrong reading of
 * "cannot ask" would treat as an all-clear. It has to refuse, and it has to
 * refuse with the cache in place, because a machine without `lsof` is the one
 * machine where destroying first and asking later cannot be undone.
 */
let provedReader = false;
export async function proveItCanTellEmptyFromUnanswerable() {
  if (provedReader) return;
  const port = await freePort();
  const home = scratch('reader');
  try {
    is('a port nothing is holding', listeners(port), []);
    const nowhere = join(home, 'no-such-lsof');
    is('a machine with no lsof to ask', listeners(port, { lsof: nowhere }), null);

    const root = checkout(join(home, 'quiet'), port);
    is('a reset that cannot ask who holds the port', await run({ root, lsof: nowhere, log: join(root, 'fixture.log') }), 2);
    if (!existsSync(join(root, '.next', 'CACHE'))) {
      throw new Error('a reset that could not ask cleared .next/ anyway, on a free port');
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  provedReader = true;
}

/** Returns the process exit code. */
export async function reset({ dryRun = false, root = null, lsof = 'lsof', log = null } = {}) {
  // Nothing in `run` can destroy anything until this has been asked, and a
  // fixture that cannot be proved is a reset that must not run: the refusals are
  // the safety, and a program that has quietly lost one of them is not a slower
  // reset, it is a wrong one. Every refusal here throws rather than warns, which
  // is what makes the wrapper below refuse with them.
  await quiet(proveItCanReclaimItsOwn);
  await quiet(proveItCanRefuseWithoutDestroying);
  await quiet(proveItCanTellServingFromBroken);
  await quiet(proveItCanTellEmptyFromUnanswerable);
  return run({ root, dryRun, lsof, log });
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const known = new Set(['--dry-run', '--log']);
  const unknown = args.filter((arg) => arg.startsWith('--') && !known.has(arg));
  const at = args.indexOf('--log');
  const log = at === -1 ? null : args[at + 1];
  try {
    if (unknown.length > 0) {
      throw new Error(
        `unrecognised argument${unknown.length === 1 ? '' : 's'}: ${unknown.join(' ')} (usage: dev-reset.mjs [--dry-run] [--log <path>])`,
      );
    }
    if (at !== -1 && (log === undefined || log === '' || log.startsWith('--'))) {
      throw new Error('--log wants a path to write the server\'s output to (usage: dev-reset.mjs [--log <path>])');
    }
    process.exit(await reset({ dryRun: args.includes('--dry-run'), log }));
  } catch (error) {
    console.error(`✗ ${error.message}`);
    console.error('\nDev reset could not run — nothing was killed and nothing was cleared.');
    process.exit(2);
  }
}
