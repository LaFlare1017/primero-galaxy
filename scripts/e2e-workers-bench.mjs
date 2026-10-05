#!/usr/bin/env node
/**
 * How long the suite takes at each worker count, measured rather than argued.
 *
 * `E2E_WORKERS: '3'` in `.github/workflows/ci.yml` is a number somebody chose,
 * and the reasoning behind it is a sentence in a comment: the local ceiling in
 * `e2e/workers.ts` was measured on a fourteen-core laptop, GitHub's runner has
 * four vCPUs, so the pin is a compromise between two machines and a guess about
 * a third. That is not a wrong way to choose a number. It is a way that goes
 * stale silently — the suite grows, the slowest file changes, the runner's
 * hardware is not the runner it was two years ago — and nothing in the workflow
 * can tell, because a suite that is slower than it was still passes.
 *
 * So this runs the suite at each worker count and prints the curve: how long it
 * took, what failed, what the slowest file was, and what one more worker bought
 * over the last one. The last column is the one a decision needs. Amdahl is not
 * a footnote here — `fullyParallel: false` means Playwright parallelises by FILE
 * and one file is always one worker, so the floor is the slowest file and no
 * worker count reaches below it. Past that floor, more workers stop buying time
 * and start buying timeouts, which is a failure the pin needs to hear about
 * rather than a reason to keep the number quiet.
 *
 * Four decisions worth stating, because each of them is a way this could have
 * measured the wrong thing and looked right doing it:
 *
 *   - **A failing count is a RESULT, not a bench failure.** Past the knee the
 *     suite times out instead of finishing; that is the finding. A failing run is
 *     timed and recorded and named, and is excluded from "fastest green" —
 *     never quietly compared as if it were a good time. The exit code is about
 *     whether a measurement happened at all.
 *   - **Two clocks, both printed.** `wall` is what the terminal's stopwatch says
 *     and includes the one build `globalSetup` makes before any worker starts;
 *     `suite` is the report's own duration, which does not. The build is the
 *     same at every count, so it changes nothing about the comparison — and
 *     hiding it would make this table disagree with the clock on CI's job.
 *   - **The count goes in twice, on purpose.** `playwright.config.ts` sizes
 *     `workers` from the CLI while `globalSetup` sizes the cleared rooms from
 *     `E2E_WORKERS`; `e2e/workers.ts` exists because those two readers have to
 *     agree exactly. Passing only the flag would time runs whose sixth worker
 *     seeded into the first five rooms' leftovers, and the number would be a
 *     measurement of a bug.
 *   - **The key is removed from every run.** A live model call spends money and
 *     its latency belongs to a network in another country. The cold-chat spec
 *     answers from the transcript here, so what is being timed is this machine.
 *
 * CI-shaped by default: `CI=1`, so retries are 2 and a test that passes on its
 * second attempt is reported green, which is exactly what the job it is
 * informing will see. `--local` unsets it and measures a developer's run
 * instead, which is a different thing and says so.
 *
 * And the limit of all of it, printed at the end of every run: this measures
 * THIS machine. A curve from a laptop justifies the local default and the shape
 * of the knee; the pin is only settled on the runner. A number here is evidence
 * about the pin, never a replacement for it — which is why the workflow runs
 * this same program in an `E2E worker curve` job on `main`, and why it asks
 * `RUNNER_ENVIRONMENT` rather than counting cores before it claims to have
 * measured anything a pin should be based on.
 *
 * When `GITHUB_STEP_SUMMARY` is set, the table and every claim below are
 * appended to it as markdown — printed from the same values as the log, never
 * recomputed, because a summary that disagrees with the output beside it is a
 * curve nobody can trust.
 *
 * Usage:
 *   node scripts/e2e-workers-bench.mjs --workers=1,2,3,4,6 [--repeat=2]
 *   node scripts/e2e-workers-bench.mjs --workers=2,4 --only=e2e/galaxy
 *   node scripts/e2e-workers-bench.mjs --workers=3 --json=bench.json
 *
 *   --workers=   the counts to time, ascending. Required: this costs one full
 *                suite run each, and a default nobody asked for is a default
 *                nobody times.
 *   --repeat=    runs per count; the MEDIAN is reported, because one run on a
 *                shared laptop is a sample, not a number. Default 1.
 *   --only=      Playwright's file filter, for a fast shape check of this
 *                script. A filtered run is not a suite measurement and its rows
 *                say so.
 *   --json=      write the raw measurements here, for comparing two commits or
 *                two machines.
 *   --local      run without CI=1 (retries 0, no CI reporter).
 *   --force      measure on a machine that is too busy to measure on.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, loadavg, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'ci.yml');

/** A count within this much of the fastest is not worth another process. */
const WITHIN = 0.1;

/** Above this multiple of the core count, a machine is too busy to measure on. */
const BUSY = 2;

/** The env a run must not inherit, and the sentence that says why for each. */
const REMOVED = [
  ['ANTHROPIC_API_KEY', 'a live call spends money and its latency is a network\'s, not this machine\'s'],
  ['ANTHROPIC_BASE_URL', 'a base URL left over from a proxy run would send the suite somewhere else entirely'],
  ['ANTHROPIC_UPSTREAM_URL', 'the recorder\'s upstream, which is only ever read when recording is on'],
  ['RECORD_TRANSCRIPT', 'a recording run writes a fixture; this is not the place to make one'],
  ['E2E_WORKERS', 'the count under test is set per run, and an inherited one would disagree with it'],
];

/** The Playwright CLI, in the order this repo installs it. Never `npx`: it fetches. */
const CLI = ['node_modules/playwright/cli.js', 'node_modules/@playwright/test/cli.js'];

/** Thrown for anything the caller can fix by typing a different command. */
class Usage extends Error {}

function cli() {
  for (const candidate of CLI) {
    const path = join(ROOT, candidate);
    if (existsSync(path)) return path;
  }
  throw new Usage(
    'there is no Playwright CLI in this checkout — `npm install` first, because this will not fetch one over the network',
  );
}

/**
 * `m:ss.s`, because a suite is minutes and a millisecond is noise on it.
 *
 * Signed, and computed from the magnitude, because the one number here that can
 * legitimately be negative is a difference between two runs — and the first
 * version of this printed one as `-1:43.7`, which is `Math.floor` of a negative
 * total and reads as a duration nobody ran. A difference that cannot be shown
 * honestly is a difference to re-check, not one to publish.
 */
function clock(ms) {
  if (!Number.isFinite(ms)) return '   —  ';
  const sign = ms < 0 ? '-' : '';
  const total = Math.round(Math.abs(ms) / 100) / 10;
  const minutes = Math.floor(total / 60);
  const seconds = (total - minutes * 60).toFixed(1).padStart(4, '0');
  return `${sign}${minutes}:${seconds}`;
}

/** A count is a whole number of workers, ascending, and nothing else. */
function counts(raw) {
  const asked = (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (asked.length === 0) throw new Usage('--workers= needs at least one count, as in --workers=1,2,3,4');
  const numbers = asked.map((part) => {
    const value = Number(part);
    if (!Number.isInteger(value) || value < 1) {
      throw new Usage(`${JSON.stringify(part)} is not a worker count — workers are whole numbers of at least 1`);
    }
    return value;
  });
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function whole(raw, name) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Usage(`${name} needs a whole number of at least 1, not ${JSON.stringify(raw)}`);
  return value;
}

function parseArgs(argv) {
  const options = { counts: null, repeat: 1, only: null, json: null, local: false, force: false, help: false };
  for (const arg of argv) {
    const at = arg.indexOf('=');
    const name = at === -1 ? arg : arg.slice(0, at);
    const value = at === -1 ? null : arg.slice(at + 1);
    const flag = () => {
      if (value !== null) throw new Usage(`${name} is a switch and takes no value`);
    };
    switch (name) {
      case '--workers':
        options.counts = counts(value);
        break;
      case '--repeat':
        options.repeat = whole(value, '--repeat');
        break;
      case '--only':
        if (value === null || value === '') throw new Usage('--only= needs the file or title filter to pass to Playwright');
        options.only = value;
        break;
      case '--json':
        if (value === null || value === '') throw new Usage('--json= needs a path to write');
        options.json = resolve(ROOT, value);
        break;
      case '--local':
        flag();
        options.local = true;
        break;
      case '--force':
        flag();
        options.force = true;
        break;
      case '--help':
      case '-h':
        flag();
        options.help = true;
        break;
      default:
        throw new Usage(`there is no ${name} here — this reads --workers, --repeat, --only, --json, --local and --force`);
    }
  }
  return options;
}

const USAGE = `Usage: node scripts/e2e-workers-bench.mjs --workers=1,2,3,4 [--repeat=2] [--only=<filter>] [--json=<path>] [--local] [--force]

Times the whole E2E suite once per worker count and prints the curve, so the
E2E_WORKERS pin in .github/workflows/ci.yml rests on a measurement. One full
suite run per count, each rebuilding the app once in globalSetup.`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
  if (options.counts === null) {
    console.log(USAGE);
    console.log('\nNo --workers= was given, so nothing was measured. This costs one full suite run per count, which is not a default to pick for somebody.');
    process.exit(2);
  }
  cli();
} catch (error) {
  if (error instanceof Usage) {
    console.error(`e2e-workers-bench: ${error.message}`);
    console.error(USAGE);
    process.exit(2);
  }
  throw error;
}

/** What this machine is, in the terms the numbers depend on. */
const cores = cpus().length;
const machine = {
  platform: `${platform()} ${release()} ${arch()}`,
  cores,
  memoryGb: Math.round((totalmem() / 1e9) * 10) / 10,
  node: process.version,
  load: Math.round(loadavg()[0] * 10) / 10,
};

/**
 * The count CI runs with, read back out of the workflow.
 *
 * A transcription of the pin is a copy that rots, and a bench that reports
 * against a remembered number is a bench arguing with a stale one. If the
 * workflow cannot be read, the bench still measures — and says the pin is
 * unknown rather than guessing it.
 */
function pinnedWorkers() {
  if (!existsSync(WORKFLOW)) return null;
  const match = readFileSync(WORKFLOW, 'utf8').match(/E2E_WORKERS:\s*'(\d+)'/);
  return match === null ? null : Number(match[1]);
}

/** The environment one run gets: CI-shaped, spend-free, and unambiguous about the count. */
function envFor(count) {
  const env = { ...process.env };
  for (const [name] of REMOVED) delete env[name];
  if (options.local) {
    delete env.CI;
  } else {
    env.CI = '1';
  }
  // Set in BOTH places on purpose; see the header.
  env.E2E_WORKERS = String(count);
  return env;
}

/**
 * One suite run, timed, with its report left where it can be read.
 *
 * The JSON reporter writes to stdout and is pointed at a file rather than a
 * pipe: a report for a full suite run is megabytes of per-step timing, and the
 * only thing that reads it is this process, immediately afterwards. stderr is
 * inherited, so a build that fails says so in the terminal rather than in a
 * file nobody opens.
 */
function runOnce(count, index, dir) {
  const report = join(dir, `workers-${count}-run-${index}.json`);
  return new Promise((done) => {
    const started = Date.now();
    const out = openSync(report, 'w');
    const child = spawn(
      process.execPath,
      [cli(), 'test', '--reporter=json', '--workers', String(count), ...(options.only === null ? [] : [options.only])],
      { cwd: ROOT, env: envFor(count), stdio: ['ignore', out, 'inherit'] },
    );
    let broken = null;
    child.on('error', (error) => {
      broken = error.code ?? error.message;
    });
    child.on('close', (code) => {
      closeSync(out);
      done({ count, index, wall: Date.now() - started, exit: code, report, ...readReport(report, broken) });
    });
  });
}

/** The report, or a reason there is not one. Silence is never read as a fast run. */
function readReport(path, broken) {
  const empty = { suite: null, expected: null, unexpected: null, flaky: null, flakyTests: [], skipped: null, timeouts: [], files: [], tests: [], readable: false, why: null };
  if (broken !== null) return { ...empty, why: `the run could not be started (${broken})` };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { ...empty, why: `its report was never written (${error.code ?? error.message})` };
  }
  let report = null;
  try {
    report = JSON.parse(text);
  } catch {
    // The reporter owns stdout, but a stray line from something it does not own
    // would otherwise cost the whole run its numbers. The JSON is the object
    // from the first brace to the last, which is what it is in either case.
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        report = JSON.parse(text.slice(first, last + 1));
      } catch {
        report = null;
      }
    }
  }
  if (report === null || typeof report !== 'object' || report.stats === undefined) {
    return { ...empty, why: `its report at ${path} is not a report this can read` };
  }

  const specs = [];
  const walk = (suites) => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) specs.push(spec);
      walk(suite.suites);
    }
  };
  walk(report.suites);

  const perFile = new Map();
  const perTest = [];
  const timeouts = [];
  const flakyTests = [];
  for (const spec of specs) {
    const file = String(spec.file ?? '(unknown file)');
    let spent = 0;
    for (const test of spec.tests ?? []) {
      // Per TEST, not per file. The suite parallelises by FILE, so the slowest
      // file is the floor — but a file's time is only a lever if you know which
      // of its tests is carrying it. `galaxy-toast.spec.ts` read as the long
      // pole at every worker count for weeks of measurements, and the reason
      // turned out to be that 91% of it was ONE 445-line test: the file could
      // have been split five ways and the floor would not have moved at all.
      // A per-file number cannot say that. This one can.
      let testMs = 0;
      for (const result of test.results ?? []) {
        const duration = Number(result.duration ?? 0);
        spent += duration;
        testMs += duration;
        if (result.status === 'timedOut' || result.status === 'timeout') {
          timeouts.push(`${file} › ${spec.title}`);
        }
      }
      // Asked of the TEST, not of a result: a test that failed and then passed
      // is `flaky` here while its results read `failed` and `passed`, so a walk
      // that only looked at results would never see one. Which is the whole
      // point — under `retries: 2` this is the only place the flakiness is
      // still written down, and the reporter writes it as a COUNT.
      //
      // The reason comes with it, because the question behind "two tests needed
      // a retry" is never "which two" alone: a timeout says the count was too
      // high for this machine, and an assertion that never became true says
      // something is racing. Those are different bugs and the count cannot tell
      // them apart.
      perTest.push({ test: `${file} › ${spec.title}`, ms: testMs });
      if (test.status === 'flaky') {
        const first = (test.results ?? [])[0];
        const message = first?.error?.message ?? (first?.errors ?? [])[0]?.message;
        flakyTests.push({
          test: `${file} › ${spec.title}`,
          why: typeof message === 'string' ? message.split('\n')[0].slice(0, 200) : null,
        });
      }
    }
    perFile.set(file, (perFile.get(file) ?? 0) + spent);
  }

  return {
    suite: Number(report.stats.duration),
    expected: report.stats.expected ?? null,
    unexpected: report.stats.unexpected ?? null,
    flaky: report.stats.flaky ?? null,
    skipped: report.stats.skipped ?? null,
    timeouts,
    flakyTests,
    files: [...perFile.entries()].map(([file, ms]) => ({ file, ms })).sort((a, b) => b.ms - a.ms),
    tests: perTest.sort((a, b) => b.ms - a.ms),
    readable: true,
    why: null,
  };
}

/** The median of a sample, which is what one noisy run should not be allowed to be. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** One count's runs, summarised. A count is green only if every run of it was. */
function summarise(count, runs) {
  const timed = runs.filter((run) => run.readable && Number.isFinite(run.suite));
  const green = runs.every((run) => run.exit === 0 && run.unexpected === 0 && run.timeouts.length === 0);
  return {
    count,
    runs,
    green,
    timed: timed.length,
    suite: timed.length === runs.length ? median(timed.map((run) => run.suite)) : null,
    wall: timed.length === runs.length ? median(timed.map((run) => run.wall)) : null,
    slowest: runs[0]?.files?.[0] ?? null,
    // The same run's slowest single test. See the note in readReport: without
    // this the bench says WHICH FILE is the floor and not whether the file is
    // the problem or one test inside it is.
    slowestTest: runs[0]?.tests?.[0] ?? null,
    // Retries are 2 under CI, so a test that failed and passed on its second
    // attempt exits 0 and reads green — the same hole `scripts/flaky-report.mjs`
    // exists to report. Counted here so a green row can say what it cost, and
    // NAMED, because a count of two without the two is the shape of thing this
    // repo keeps refusing: a number that says something happened without saying
    // what, which is a fact nobody can act on.
    flaky: runs.reduce((total, run) => total + (run.flaky ?? 0), 0),
    // Deduped by name, keeping the first reason seen: the same test flaking in
    // two of three runs is one flaky test, not two, and reporting it twice
    // would make a count of two out of one cause.
    flakyTests: [
      ...new Map(runs.flatMap((run) => run.flakyTests ?? []).map((entry) => [entry.test, entry])).values(),
    ],
    timeouts: [...new Set(runs.flatMap((run) => run.timeouts))],
    why: runs.find((run) => run.why !== null)?.why ?? null,
  };
}

function pad(text, width) {
  return String(text).padEnd(width);
}

function lead(label) {
  return `  ${pad(label, 14)}`;
}

// The refusal, before any money of the reader's time is spent. A load average
// at or over the core count warns: a developer's machine is rarely quiet, and a
// bench that refuses to run on a real desktop is a bench nobody runs. Twice the
// core count refuses, because at that point the numbers are not slower, they are
// about whatever else is running.
if (machine.load >= cores * BUSY && !options.force) {
  console.error(
    `e2e-workers-bench: this machine's 1-minute load average is ${machine.load} against ${cores} cores, which is not a machine you can time a suite on.`,
  );
  console.error('  Wait for it to settle, or pass --force and read the numbers as a floor rather than a measurement.');
  process.exit(2);
}

/**
 * Whether this IS the machine CI runs the pin on, asked of the environment and
 * not of the core count.
 *
 * A four-core laptop is not a runner, and a curve that claimed to be one
 * because it counted four cores would be exactly the kind of inference this
 * tool exists to replace. GitHub says which machine it is running on
 * (`RUNNER_ENVIRONMENT`), so the question is asked of the thing that knows.
 */
const hosted = process.env.RUNNER_ENVIRONMENT === 'github-hosted' || process.env.GITHUB_ACTIONS === 'true';

const dir = join(tmpdir(), `e2e-workers-bench-${process.pid}`);
mkdirSync(dir, { recursive: true });
const pin = pinnedWorkers();
const runs = options.counts.length * options.repeat;

console.log('E2E workers bench');
console.log(`${lead('machine')}${machine.platform} · ${cores} logical cores · ${machine.memoryGb} GB · node ${machine.node}`);
console.log(
  `${lead('load')}${machine.load} (1 min)${
    machine.load >= cores
      ? ` — at or above the core count, so treat every number below as a floor, not a clean read${
          options.force ? ' (--force)' : ''
        }`
      : ''
  }`,
);
console.log(`${lead('counts')}${options.counts.join(', ')} × ${options.repeat} run${options.repeat === 1 ? '' : 's'} = ${runs} full suite run${runs === 1 ? '' : 's'}`);

console.log(
  `${lead('runner')}${
    hosted
      ? `GitHub reported a hosted runner here (${process.env.RUNNER_ENVIRONMENT}) — read the core count above before believing that`
      : 'not a GitHub runner, so these numbers describe this machine and nothing else'
  }`,
);
console.log(
  `${lead('summary')}${
    (process.env.GITHUB_STEP_SUMMARY ?? '') === ''
      ? 'GITHUB_STEP_SUMMARY is not set, so these facts go to the log and nowhere else'
      : process.env.GITHUB_STEP_SUMMARY
  }`,
);
console.log(`${lead('pin')}${pin === null ? 'not found in .github/workflows/ci.yml — the comparison below cannot be made' : `CI pins E2E_WORKERS=${pin}`}`);
if (options.only !== null) {
  console.log(`${lead('filter')}${options.only} — a filtered run is not a suite measurement, and the rows below say so`);
}
for (const [name, why] of REMOVED) {
  if (name === 'E2E_WORKERS') continue;
  console.log(`${lead('cleared')}${name} — ${why}`);
}
console.log(`${lead('cost')}each run rebuilds the app once in globalSetup, before any worker starts`);
console.log(`${lead('reports')}${dir}\n`);

const results = [];
for (const count of options.counts) {
  for (let index = 1; index <= options.repeat; index += 1) {
    process.stdout.write(`  ${count} worker${count === 1 ? '' : 's'}, run ${index}/${options.repeat} … `);
    const run = await runOnce(count, index, dir);
    results.push(run);
    const verdict = run.exit === 0 && run.unexpected === 0 ? 'green' : 'FAILED';
    console.log(
      run.readable
        ? `suite ${clock(run.suite)}, ${verdict}${run.timeouts.length > 0 ? `, ${run.timeouts.length} timeout(s)` : ''}`
        : `unmeasurable — ${run.why}`,
    );
  }
}

const rows = options.counts.map((count) => summarise(count, results.filter((run) => run.count === count)));

/**
 * The table as data, so the log and the job summary are printed from the same
 * numbers rather than from two descriptions of them that agree until they don't.
 */
const cells = rows.map((row, at) => {
  const previous = rows[at - 1];
  const delta =
    previous?.suite != null && row.suite != null && previous.suite > 0
      ? `${previous.suite - row.suite >= 0 ? 'saved ' : 'LOST '}${clock(Math.abs(previous.suite - row.suite))}`
      : '—';
  return {
    count: row.count,
    suite: clock(row.suite),
    wall: clock(row.wall),
    delta,
    slowest: row.slowest === null ? '—' : `${row.slowest.file} ${clock(row.slowest.ms)}`,
    verdict:
      row.why !== null
        ? 'unmeasurable'
        : row.green
          ? row.flaky > 0
            ? `green, but ${row.flaky} needed a retry${row.flakyTests.length === 1 ? `: ${row.flakyTests[0].test}` : ''}`
            : 'green'
          : `failed: ${row.timeouts.length} timeout(s), ${row.runs[0]?.unexpected ?? '?'} unexpected`,
  };
});

/**
 * Every claim this run makes, collected once.
 *
 * So that the terminal and the job summary carry the same words. A summary
 * written from a second pass over the numbers is a summary that can disagree
 * with the log, and a curve that disagrees with itself is worse than no curve:
 * a reader who sees one in the summary and the other in the output has no way to
 * tell which one the bench meant.
 */
const findings = [];
const say = (label, text) => findings.push({ label, text });

const greenRows = rows.filter((row) => row.green && row.suite !== null);
const failedRows = rows.filter((row) => !row.green && row.why === null);
const unreadable = rows.filter((row) => row.why !== null);
const fastestOf = (list) => list.reduce((a, b) => (b.suite < a.suite ? b : a));

if (greenRows.length === 0) {
  say('', 'No count finished green, so there is no fastest green count to report. The rows above are what happened.');
} else {
  const fastest = fastestOf(greenRows);
  const knee = greenRows
    .filter((row) => row.suite <= fastest.suite * (1 + WITHIN))
    .reduce((a, b) => (b.count < a.count ? b : a));
  const workers = (count) => `${count} worker${count === 1 ? '' : 's'}`;
  say('fastest green', `${workers(fastest.count)} — suite ${clock(fastest.suite)}`);
  say('the knee', `${workers(knee.count)} — within ${Math.round(WITHIN * 100)}% of that (${clock(knee.suite)}), and one fewer process`);
  if (knee.count !== fastest.count) {
    say('', `${workers(fastest.count)} buys ${clock(fastest.suite - knee.suite)} more than ${workers(knee.count)} does. Whether that is worth the machine is not a question a stopwatch answers.`);
  }
}

if (pin !== null) {
  const measured = rows.find((row) => row.count === pin);
  const fastest = greenRows.length === 0 ? null : fastestOf(greenRows);
  if (measured === undefined) {
    say('the pin', `${pin} was not measured here (--workers did not include it), so this says nothing about the number CI uses.`);
  } else if (measured.why !== null) {
    say('the pin', `${pin} could not be measured — ${measured.why}`);
  } else if (!measured.green) {
    say('the pin', `${pin} is not green here (${measured.timeouts.length} timeout(s)). ${hosted ? 'GitHub reports this as a hosted runner, so the pin is wrong here rather than merely unmeasured.' : "That is a fact about this machine, and CI's runner is not this machine."}`);
  } else if (fastest === null) {
    say('the pin', `${pin} finished green in ${clock(measured.suite)}, and nothing else did, so there is no comparison to make.`);
  } else if (fastest.count === pin) {
    say('the pin', `${pin} is both the fastest green count and the number CI pins. The pin is behind a measurement.${measured.flaky > 0 ? ` It is also the run that hid ${measured.flaky} retry-flown test(s) behind exit 0.` : ''}`);
  } else if (fastest.count > pin) {
    // Signed, and the word follows the sign. `clock()` already prints its own
    // sign, so an unsigned difference plus a fixed adjective printed the run
    // 4:11.2 as "-0:20.3 faster" — a bench that cannot read its own comparison
    // is worse than one that prints no comparison at all, because the reader
    // trusts the number over the adjective.
    const gain = fastest.suite - measured.suite;
    say('the pin', `${pin} measured ${clock(measured.suite)}; ${fastest.count} measured ${clock(fastest.suite)}, ${clock(Math.abs(gain))} ${gain >= 0 ? 'faster' : 'slower'}.${hosted ? ' Both ran where the pin runs, so this is the number to change the pin to.' : ' Whether CI can have that many is a question about four vCPUs, not about this machine.'}`);
  } else {
    say('the pin', `${pin} measured ${clock(measured.suite)}, ${clock(measured.suite - fastest.suite)} slower than ${fastest.count} — so the pin is conservative here, which is the right direction to be wrong in.`);
  }
}

/**
 * What the floor is actually made of.
 *
 * The suite parallelises by file, so the slowest file sets the floor. That fact
 * alone sends you to split the file — which is the wrong move when the file is
 * just a long test wearing a filename, because splitting it puts the same test
 * in a file of its own and the floor does not move. So this asks which of the
 * two it is, and prints the share either way.
 */
for (const row of rows.filter((row) => row.slowest !== null && row.slowestTest !== null)) {
  const { slowest, slowestTest } = row;
  const inThisFile = slowestTest.test.startsWith(`${slowest.file} › `);
  const share = Math.round((slowestTest.ms / slowest.ms) * 100);
  if (inThisFile && share >= 60) {
    say(
      `${row.count} worker${row.count === 1 ? '' : 's'}`,
      `the floor is ${slowest.file} (${clock(slowest.ms)}), and ${share}% of it is ONE test — ${slowestTest.test.split(' › ').slice(1).join(' › ')} (${clock(slowestTest.ms)}). Splitting this file would not move the floor; splitting that test would.`
    );
  } else if (inThisFile) {
    const longest = `${slowestTest.test.split(' › ').slice(1).join(' › ')} (${clock(slowestTest.ms)}, ${share}% of the file)`;
    say(`${row.count} worker${row.count === 1 ? '' : 's'}`, `the floor is ${slowest.file} (${clock(slowest.ms)}), spread over its tests — its longest is ${longest}, so the file itself is the thing to split.`);
  } else {
    say(`${row.count} worker${row.count === 1 ? '' : 's'}`, `the floor is ${slowest.file} (${clock(slowest.ms)}), whose longest test is ${clock(slowestTest.ms)} (${share}%) — the rest of the suite's slowest single test is ${slowestTest.test} (${clock(slowestTest.ms)}).`);
  }
}

for (const row of rows.filter((row) => row.flaky > 0)) {
  // Named in full, in the order the report lists them, because the question a
  // reader brings to "two tests needed a retry" is "which two", and answering
  // it is the difference between a number and a finding.
  for (const entry of row.flakyTests) {
    say(`${row.count} workers`, `needed a retry — ${entry.test}${entry.why === null ? '' : ` — ${entry.why}`}`);
  }
}
for (const row of failedRows) {
  const named = row.timeouts.slice(0, 4).join('; ');
  say(`${row.count} workers`, `did not finish green — ${row.timeouts.length} timeout(s)${named ? `: ${named}${row.timeouts.length > 4 ? `; and ${row.timeouts.length - 4} more` : ''}` : ''}`);
}
if (failedRows.length > 0) {
  say('', 'A count that times out is not a slow count, it is a broken one, and its time is not comparable to a green run\'s.');
}
for (const row of unreadable) {
  say(`${row.count} workers`, `unmeasurable — ${row.why}`);
}
if (options.repeat === 1) {
  say('one run', 'a single run is a sample, not a number — re-run with --repeat=3 before changing the pin on the strength of it.');
}

/**
 * What this measurement is not evidence about, said the same way wherever it is
 * printed. The point of the sentence changes when the machine changes, which is
 * why it is computed rather than written once: run here, it is a caveat about a
 * laptop; run on the runner, it would have been a lie about the runner.
 */
const caveat = hosted
  ? `GitHub reported this as a hosted runner, so this is the machine the pin runs on: ${machine.cores} logical cores, ${machine.platform}. If that is not the runner class the pin was chosen for, the hardware moved under the number and it wants measuring again. The local default in e2e/workers.ts is sized for a developer's machine and still says so. The suite parallelises by FILE (fullyParallel: false), so the floor is the slowest file and no worker count reaches below it.`
  : `This measured ${machine.cores} logical cores on this machine. GitHub's runner has four vCPUs, so this justifies the local default and the shape of the curve; the pin is settled on the runner, by the \`E2E worker curve\` job. The suite parallelises by FILE (fullyParallel: false), so the floor is the slowest file and no worker count reaches below it.`;

console.log('\n  workers   suite     wall      vs fewer   slowest file              verdict');
for (const cell of cells) {
  console.log(
    `  ${pad(cell.count, 8)} ${pad(cell.suite, 9)} ${pad(cell.wall, 9)} ${pad(cell.delta, 10)} ${pad(cell.slowest, 24)} ${cell.verdict}`,
  );
}
console.log('');
for (const { label, text } of findings) console.log(`${lead(label)}${text}`);

/**
 * The same table and the same findings, as markdown, for the job summary.
 *
 * Written from `cells` and `findings` rather than recomputed, so there is no
 * second reading of the numbers to fall out of step with the first.
 */
function summaryMarkdown() {
  const lines = ['### The worker curve, measured here', ''];
  lines.push('| workers | suite | wall | vs fewer | slowest file | verdict |');
  lines.push('|---|---|---|---|---|---|');
  for (const cell of cells) {
    lines.push(`| ${cell.count} | ${cell.suite.trim()} | ${cell.wall.trim()} | ${cell.delta} | ${cell.slowest} | ${cell.verdict} |`);
  }
  lines.push('');
  lines.push(
    `\`suite\` is the report's own duration; \`wall\` is the stopwatch and includes the one build \`globalSetup\` makes before any worker starts. Every run was ${options.local ? 'local-shaped (retries 0)' : 'CI-shaped (retries 2)'} with \`ANTHROPIC_API_KEY\` removed, so what is timed is the machine rather than a network.`,
  );
  lines.push('');
  lines.push(
    `Machine: ${machine.platform} · ${machine.cores} logical cores · node ${machine.node}${hosted ? ' · **GitHub reports this as a hosted runner**' : ''}${pin === null ? '' : ` · the workflow pins E2E_WORKERS=${pin}`}.`,
  );
  lines.push('');
  for (const { label, text } of findings) lines.push(label === '' ? `  ${text}` : `- **${label}** — ${text}`);
  lines.push('', caveat);
  return `${lines.join('\n')}\n`;
}

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath !== undefined && summaryPath !== '') {
  appendFileSync(summaryPath, summaryMarkdown());
  console.log(`\n  ${lead('summary')}${summaryPath} — the curve and every claim above, in this job's summary`);
}
console.log(`\n  What this does not tell you: ${caveat}`);
console.log(`  Raw reports: ${dir}`);

if (options.json !== null) {
  writeFileSync(
    options.json,
    `${JSON.stringify({ recordedAt: new Date().toISOString(), machine, hosted, pin, options, runs: results }, null, 2)}\n`,
  );
  console.log(`  Measurements written to ${options.json}`);
}

process.exit(unreadable.length === rows.length ? 1 : 0);