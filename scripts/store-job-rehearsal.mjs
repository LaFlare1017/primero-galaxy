#!/usr/bin/env node
/**
 * The store CI job, run on a laptop, against a console on localhost.
 *
 * The job is seven steps and none of them had ever all run. This repository has
 * no `NEON_API_KEY`, so every push skips steps one to three and six to seven,
 * and the store gate's own coverage is checked only against an in-process
 * engine. The parts are covered — `neon-secrets.mjs` and `neon-branch.mjs` each
 * self-test against a fake console — but they are covered APART, and a job is
 * not the sum of its parts: it is the order they run in, the variables each one
 * hands the next, and the exact command lines CI writes in YAML.
 *
 * So this walks the whole thing, in order, as processes, with the same
 * environment plumbing the workflow has:
 *
 *   1 resolve   neon-secrets.mjs --resolve     → the two ids, on stdout
 *   2 create    neon-branch.mjs create         → BRANCH_ID, and a wait for ready
 *   3 uri       neon-branch.mjs uri            → DELEGATE_STORE_TEST_URL, masked
 *   4 gate      test-store-backends.js         → the in-process leg
 *   5 gate      test-store-backends.js         → the remote leg       ← NOT RUN
 *   6 drop      neon-branch.mjs drop           → and the branch is gone
 *   7 report    neon-branch.mjs report         → the verdict step
 *
 * Step 5 cannot run here and this program will not pretend otherwise. The fake
 * console answers the Neon MANAGEMENT api; the remote gate leg needs a Postgres
 * to talk to, at whatever URI the console hands back, and there is no database
 * behind `ep-fake.neon.tech`. That leg is the one thing a rehearsal like this
 * cannot reach, it is named in the output and in the exit report every single
 * run, and it is the reason the store job still exists and still fails on a push
 * until somebody mints a key. Everything else is exercised here, and the point
 * of exercising it is that the steps are wired together, not just individually
 * correct.
 *
 * Two details are load-bearing and easy to get wrong, which is most of why this
 * is a program rather than a person re-running the YAML by hand:
 *
 *   - Step 1's ids reach the job through `$GITHUB_ENV`, which the program now
 *     appends to itself. The workflow line used to be a shell redirection —
 *     `neon-secrets.mjs --resolve >> "$GITHUB_ENV"` — which made a shell the
 *     thing that decided what became an environment variable. A rehearsal that
 *     reproduced that redirection was testing the shell rather than the program.
 *   - Each step's `$GITHUB_ENV` additions are handed to the NEXT step as
 *     environment variables, which is what GitHub does between steps. Skip that
 *     and step 3 correctly refuses — it has no BRANCH_ID — and the rehearsal
 *     would report a bug in a program that is behaving properly.
 *
 * The last thing it checks is that it still matches the workflow. The steps
 * above are transcribed; a transcription rots, and a rehearsal of a job that has
 * drifted is worse than none because it reads as coverage. So every Neon
 * invocation in `.github/workflows/ci.yml` is read back and compared with what
 * this program actually ran, and any command line CI depends on that is not
 * rehearsed here is reported.
 *
 * Usage:
 *   node scripts/store-job-rehearsal.mjs
 *   node scripts/store-job-rehearsal.mjs --verbose   # every step's own output
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeNeon } from './neon-fake-console.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'ci.yml');
const GATE = join(ROOT, 'delegate', 'dist', 'store', 'test-store-backends.js');

const VERBOSE = process.argv.includes('--verbose');

/**
 * The steps, in the order the job runs them.
 *
 * `argv` is the command line, `env` what the step adds or clears, and
 * `intoEnv` whether the step's STDOUT is appended to `$GITHUB_ENV` the way the
 * workflow's redirection does — which is how step 1 hands over two ids that
 * never appear in a variable anywhere else.
 */
const STEPS = [
  {
    label: 'resolve the Neon project and parent branch',
    argv: ['scripts/neon-secrets.mjs', '--resolve'],
    intoEnv: true,
    // The program appends to `$GITHUB_ENV` itself; the workflow line is just
    // `node scripts/neon-secrets.mjs --resolve`. So the ids have to be in the
    // FILE, not merely on stdout, and the check below reads the file.
    handWritesEnv: true,
    handover: ['NEON_PROJECT_ID', 'NEON_PARENT_BRANCH_ID'],
  },
  {
    label: 'create this run’s branch',
    argv: ['scripts/neon-branch.mjs', 'create'],
    handover: ['BRANCH_ID'],
  },
  {
    label: 'resolve this branch’s connection URI',
    argv: ['scripts/neon-branch.mjs', 'uri'],
    handover: ['DELEGATE_STORE_TEST_URL'],
  },
  {
    label: 'store gate, in-process leg',
    argv: [GATE],
    // Cleared at the step, exactly as the workflow clears it, so this leg is
    // in-process whatever the environment around it says.
    env: { DELEGATE_STORE_TEST_URL: '' },
    handover: [],
  },
  {
    label: 'store gate, remote leg',
    argv: [GATE],
    // Cannot run. See the header: the console serves the management API, and
    // this leg needs a database at whatever URI that console hands back.
    unreachable: 'the fake console answers the Neon management API and no Postgres is behind its URI',
    handover: [],
  },
  {
    label: 'drop this run’s branch',
    argv: ['scripts/neon-branch.mjs', 'drop'],
    handover: [],
  },
  {
    label: 'report whether the remote leg ran',
    argv: ['scripts/neon-branch.mjs', 'report'],
    handover: [],
  },
];

/**
 * Run one step and return what it did.
 *
 * ASYNC, and not a convenience: the fake console is served by THIS process, so
 * a synchronous spawn would block the only thing that can answer the child's
 * HTTP, and the child would wait for a response nobody was listening for.
 */
function runStep(step, env) {
  return new Promise((resolveStep) => {
    const child = spawn(process.execPath, step.argv, {
      cwd: ROOT,
      env: { ...process.env, ...env, ...(step.env ?? {}) },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (status) => resolveStep({ status, stdout, stderr }));
  });
}

/** Everything a run of `$GITHUB_ENV` collected, as an environment to pass on. */
function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const env = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) env[line.slice(0, at)] = line.slice(at + 1);
  }
  return env;
}

// Two counters, because they answer two different questions and a run that
// conflates them reads as either more broken or less than it is. A step exiting
// non-zero is the JOB being wrong; a check failing is this rehearsal's claim
// about the job not holding. The first is the finding, the second is the
// evidence, and "6 of 7 steps exercised" must never be printed by a run in
// which four of them exited 1.
let brokenSteps = 0;
let failedChecks = 0;
const check = (name, passed, detail) => {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!passed) failedChecks += 1;
};

/**
 * Every Neon command line the workflow depends on, read back out of the YAML.
 *
 * A transcription of the job is a copy that rots, and a rehearsal of a job that
 * has drifted is worse than no rehearsal because it reads as coverage. Read
 * back from the source, this way, the check fails the day someone renames a mode
 * rather than the week the store job does.
 */
function workflowNeonInvocations() {
  if (!existsSync(WORKFLOW)) return null;
  const found = new Set();
  for (const line of readFileSync(WORKFLOW, 'utf8').split('\n')) {
    const match = line.match(/node (scripts\/neon-(?:branch|secrets)\.mjs) ([^\s'"\\]+)/);
    if (match) found.add(`${match[1]} ${match[2]}`);
  }
  return found;
}

const fake = await startFakeNeon({ apiKey: 'test-key', readyAfter: 2 });
const envFile = join(tmpdir(), `store-job-rehearsal-${process.pid}.env`);
const carried = {
  NEON_API_KEY: 'test-key',
  NEON_PROJECT_ID: '',
  NEON_PARENT_BRANCH_ID: '',
  BRANCH_NAME: `ci-rehearsal-${process.pid}`,
  // The seam that makes this a rehearsal rather than a second attempt at
  // production: every management call goes to the console on localhost.
  NEON_API_URL: fake.url,
  GITHUB_ENV: envFile,
};

rmSync(envFile, { force: true });
const ran = [];
const unreached = [];

try {
  for (const step of STEPS) {
    if (step.unreachable) {
      unreached.push({ step, why: step.unreachable });
      console.log(`SKIP  ${step.label}\n        ${step.unreachable}`);
      continue;
    }

    const result = await runStep(step, carried);
    // Nothing to redirect. Step 1 used to be `neon-secrets.mjs --resolve >>
    // "$GITHUB_ENV"`, and this line reproduced that shell redirection by
    // appending the step's stdout — which meant the rehearsal was testing the
    // same shell feature the workflow used rather than the program's own
    // contract, and would have kept passing if the workflow had gone back to
    // depending on it.
    //
    // The program now writes `$GITHUB_ENV` itself, so the claim is simply that
    // it did: `handWritesEnv` steps are expected to have put their answer in the
    // file, and the check below reads the file rather than this process's copy
    // of stdout. A step that prints its ids and writes nothing would now fail,
    // which is the whole point of the change.
    if (step.intoEnv && !step.handWritesEnv) appendFileSync(envFile, result.stdout, 'utf8');
    // And then GitHub's own hand-off: whatever `$GITHUB_ENV` now holds becomes
    // the environment the NEXT step runs in. Without this the rehearsal fails on
    // step 2 for want of an id step 1 just wrote — which is the correct refusal
    // from the program and a bug here, and the two are indistinguishable until
    // one of them is fixed. Which is exactly what happened the first time.
    Object.assign(carried, readEnvFile(envFile));

    const after = readEnvFile(envFile);
    // What the console held at THIS point in the job, not at the end of it.
    // The job deletes its branch in step 6, so a claim about the branch having
    // existed is only checkable against a snapshot taken while it did.
    ran.push({ step, result, after, console: fake.branches('proj-1') });
    // Counted here, outside the reporting branches below: `--verbose` used to
    // skip this entirely, so a run with a failing step still exited 0 and
    // CI would have read the verbose log as the loud version of a pass.
    if (result.status !== 0) brokenSteps += 1;
    if (VERBOSE) {
      console.log(`      $ ${step.argv.join(' ')}  (exit ${result.status})`);
      for (const line of `${result.stdout}${result.stderr}`.split('\n').filter(Boolean)) {
        console.log(`        ${line}`);
      }
    } else {
      const detail = `${result.status === 0 ? 'exit 0' : `EXIT ${result.status}`}: ${(result.stderr.trim() || result.stdout.trim()).split('\n')[0] ?? '(silent)'}`;
      console.log(`  ${result.status === 0 ? 'ok  ' : 'FAIL'} ${step.label} — ${detail.slice(0, 120)}`);
    }
  }

  const finalEnv = readEnvFile(envFile);

  // Named before it is used, and NOT `resolve`: that is `path.resolve` at the top
  // of this file, and shadowing it inside the try block is a temporal dead zone
  // on the first reference — which reads as a crash rather than as a naming
  // mistake, and cost a debugging round to see.
const resolved = ran.find((entry) => entry.step.argv[0] === 'scripts/neon-secrets.mjs');
  // The FILE, not the step's stdout. This check used to be phrased as "hands
  // the next one the two ids, on stdout" and read a copy the rehearsal made by
  // appending stdout itself — reproducing the shell redirection the workflow no
  // longer has. It would have passed whether or not the program wrote anything,
  // as long as it printed. `handWritesEnv` above says the program owns the
  // write, so the claim has to be that it did.
  check(
    'the resolve step writes the two ids into $GITHUB_ENV itself, with no redirection in the job',
    finalEnv.NEON_PROJECT_ID === 'proj-1' &&
      finalEnv.NEON_PARENT_BRANCH_ID === 'br-1' &&
      resolved?.result.stdout.includes('NEON_PROJECT_ID=proj-1'),
    `NEON_PROJECT_ID=${finalEnv.NEON_PROJECT_ID ?? '(unset)'}, NEON_PARENT_BRANCH_ID=${
      finalEnv.NEON_PARENT_BRANCH_ID ?? '(unset)'
    }, written by the program${resolved?.result.stdout.includes('NEON_PROJECT_ID=proj-1') ? '' : ' (printed only)'}`,
  );

  const create = ran.find((entry) => entry.step.argv[1] === 'create');
  check(
    'the branch is created writable, from the parent, and waited for',
    // The VALUE, not the `KEY=value` line: `$GITHUB_ENV` is read into
    // environment variables here, and asserting a value against the line it was
    // written as is a check that can never pass however correct the job is.
    /^br-\d+$/.test(finalEnv.BRANCH_ID ?? '') &&
      /ready after \d+ attempt/.test(create?.result.stderr ?? '') &&
      (create?.console ?? []).some((branch) => branch.name === carried.BRANCH_NAME),
    `${finalEnv.BRANCH_ID ?? '(no branch id)'}, ${create?.result.stderr.trim().split('\n').pop() ?? 'never waited'}`,
  );

  const uriStep = ran.find((entry) => entry.step.argv[1] === 'uri');
  check(
    'the URI step exports a connection URL and masks its password',
    (finalEnv.DELEGATE_STORE_TEST_URL ?? '').startsWith('postgres://') &&
      uriStep?.result.stderr.includes('::add-mask::hunter2') &&
      !uriStep?.result.stdout.includes('hunter2'),
    `exported ${(finalEnv.DELEGATE_STORE_TEST_URL ?? '(unset)').replace(/:[^:@]*@/, ':(masked)@')}`,
  );

  check(
    'no step but the URI step ever prints the password, and the URI step prints only a mask',
    ran.every((entry) => {
      const said = `${entry.result.stdout}${entry.result.stderr}`;
      if (!said.includes('hunter2')) return true;
      return said.includes('::add-mask::hunter2') && !entry.result.stdout.includes('hunter2');
    }),
    `${ran.filter((entry) => `${entry.result.stdout}${entry.result.stderr}`.includes('hunter2')).length} step(s) mentioned it, all as a mask`,
  );

  const gate = ran.find((entry) => entry.step.argv[0] === GATE);
  check(
    'the in-process gate runs and says which engine it used',
    gate?.result.status === 0 && /in-process/.test(`${gate.result.stdout}${gate.result.stderr}`),
    gate ? `exit ${gate.result.status}` : 'never ran',
  );

  const drop = ran.find((entry) => entry.step.argv[1] === 'drop');
  check(
    'the branch is dropped, and the console agrees it is gone',
    drop?.result.status === 0 &&
      !fake.branches('proj-1').some((branch) => branch.name === carried.BRANCH_NAME),
    `console holds ${fake.branches('proj-1').map((branch) => branch.name).join(', ') || 'nothing'}`,
  );

  // ── and the job's FAILURE channel, which no passing run can show ────
  //
  // Deliberately not an eighth step in the list above. It is not part of the
  // job, and putting it there would mean the step count and the
  // "every command line CI runs is one we run" comparison were both describing
  // something CI does not do. This asks a different question: when a step DOES
  // fail, does the reason reach a person?
  //
  // It matters because stdout here is `$GITHUB_ENV`. A refusal printed to the
  // wrong stream is not merely invisible as a red annotation — it is written
  // into the file the next step reads, where it becomes an environment variable
  // that looks like an answer. The create step is run with a zero-hour expiry,
  // which is a real input rather than a fault injected into the program: the
  // console refuses it because an expiry in the past is one the console will
  // not take, and `EXPIRY_HOURS=0` is the way to ask for one.
  {
    const refusalEnvFile = join(tmpdir(), `store-job-refused-${process.pid}.env`);
    rmSync(refusalEnvFile, { force: true });
    const refusal = await runStep(
      {
        label: 'create, with an expiry the console refuses',
        argv: ['scripts/neon-branch.mjs', 'create'],
        env: { EXPIRY_HOURS: '0', BRANCH_NAME: `${carried.BRANCH_NAME}-refused`, GITHUB_ENV: refusalEnvFile },
      },
      carried,
    );
    const branchIdBefore = finalEnv.BRANCH_ID ?? '';
    check(
      'a refused create reaches the job log as a ::error naming the status and the reason',
      // The status AND the reason, because "invalid expires_at" on its own
      // sends a reader hunting for a clock problem they may not have.
      refusal.status === 1 &&
        refusal.stderr.startsWith('::error title=Store gate::') &&
        /HTTP 400/.test(refusal.stderr) &&
        /invalid expires_at/.test(refusal.stderr) &&
        /not in the future/.test(refusal.stderr),
      `exit ${refusal.status}, ${refusal.stderr.split('\n')[0]?.replace('::error title=Store gate::', '').slice(0, 96) ?? '(it said nothing)'}`,
    );
    check(
      'and it writes nothing to stdout, so the refusal cannot become a $GITHUB_ENV line',
      refusal.stdout === '' && !existsSync(refusalEnvFile),
      `stdout ${refusal.stdout === '' ? 'empty' : `WROTE ${refusal.stdout.split('\n')[0]}`}; ${
        existsSync(refusalEnvFile) ? `${refusalEnvFile} was created` : 'no env file written'
      }`,
    );
    // The job's own state is untouched: a probe that leaked a branch id into
    // the real $GITHUB_ENV would make the checks above pass for the wrong
    // reason on the next run.
    check(
      'and the job’s real $GITHUB_ENV and branch are untouched by the probe',
      (finalEnv.BRANCH_ID ?? '') === branchIdBefore &&
        !(create?.console ?? []).some((branch) => branch.name.endsWith('-refused')),
      `BRANCH_ID still ${branchIdBefore || '(none)'}; console holds ${(create?.console ?? []).map((b) => b.name).join(', ')}`,
    );
    rmSync(refusalEnvFile, { force: true });
  }

  const report = ran.find((entry) => entry.step.argv[1] === 'report');
  check(
    'the verdict step passes once a URI exists, without needing the fork exception',
    // Quiet on stderr is NOT the claim: this step says what it found, and it
    // says it there. The claim is that it did not raise an annotation, which is
    // the difference between a job that passed and a job that explained itself.
    report?.result.status === 0 && !report.result.stderr.includes('::error'),
    `exit ${report?.result.status ?? 'never ran'}: ${report?.result.stderr.trim() || '(said nothing)'}`,
  );

  // And the last claim: that this is still the job.
  const workflow = workflowNeonInvocations();
  const rehearsedCommands = new Set(
    STEPS.filter((step) => !step.unreachable).map((step) => `${step.argv[0].replace(`${ROOT}/`, '')} ${step.argv[1] ?? ''}`.trim()),
  );
  if (workflow === null) {
    check('the workflow could be read back to compare against', false, `${WORKFLOW} is not readable`);
  } else {
    const unrehearsed = [...workflow].filter(
      (command) => ![...rehearsedCommands].some((candidate) => candidate === command || candidate.startsWith(command)),
    );
    check(
      'every Neon command line CI runs is one this rehearsal actually runs',
      unrehearsed.length === 0,
      unrehearsed.length === 0
        ? `${workflow.size} in the workflow, all rehearsed`
        : `not rehearsed: ${unrehearsed.join(', ')}`,
    );
  }
} finally {
  await fake.close();
  rmSync(envFile, { force: true });
}

const ranOk = ran.filter((entry) => entry.result.status === 0).length;
console.log(
  `\n${ranOk} of ${STEPS.length} steps ran clean against the fake console` +
    (brokenSteps > 0 ? `, ${brokenSteps} exited non-zero` : '') +
    `; ${unreached.length} not reachable here.`,
);
for (const entry of unreached) {
  console.log(`  not covered: ${entry.step.label} — ${entry.why}`);
  console.log('    That leg is the reason the store job still runs against a real Neon, and why it still fails');
  console.log('    on a push until somebody mints NEON_API_KEY. Nothing here stands in for a database.');
}
const verdict = [
  brokenSteps > 0 ? `${brokenSteps} step(s) exited non-zero` : null,
  failedChecks > 0 ? `${failedChecks} check(s) FAILED` : null,
].filter(Boolean);
console.log(
  verdict.length === 0
    ? '\nthe store job rehearsed cleanly'
    : `\nthe store job did NOT rehearse cleanly: ${verdict.join('; ')}`,
);
process.exitCode = verdict.length === 0 ? 0 : 1;
