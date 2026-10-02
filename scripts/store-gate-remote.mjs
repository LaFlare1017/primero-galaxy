#!/usr/bin/env node
/**
 * The store gate over the Neon serverless driver, and the proof it ran there.
 *
 * This was five lines of shell in `.github/workflows/ci.yml`, and every part of
 * it that mattered was a shell feature rather than a program:
 *
 *   node …/test-store-backends.js 2>&1 | tee /tmp/store-gate-remote.log
 *   status=${PIPESTATUS[0]}
 *   if [ "$status" -ne 0 ]; then … fi
 *   grep -q "postgres leg on remote postgres" /tmp/store-gate-remote.log || { … }
 *
 * `PIPESTATUS` is the reason this is a program. It is a **bash** array holding
 * each stage of a pipeline's status, and a `run:` block on a Linux runner is
 * `bash -e {0}` by default — so it works, right up until somebody sets
 * `shell: sh` on the step, or this block is copied somewhere POSIX is in
 * charge. Then `PIPESTATUS` is empty, `[ "" -ne 0 ]` compares an empty string
 * against a number, and the step fails with a shell error that says nothing
 * about the gate. Worse in the other direction: a block that guards the
 * pipeline with a construct that does not survive the move would report the
 * gate's status as `tee`'s, which is zero, and this job would go green having
 * proved nothing at all. `set -e` does not save it either — it cannot, since
 * the status of a pipeline is the status of its LAST stage unless a shell
 * feature says otherwise, and that feature is the one in question.
 *
 * So the claim the job exists to make is made here, in node, where it does not
 * depend on which shell GitHub picked:
 *
 *   - the gate's OWN exit status, read from the child process rather than from
 *     a pipeline, is what this program exits with;
 *   - the gate said it ran on a REMOTE engine, asserted against what it
 *     printed. A gate that fell back to PGlite passes every check it makes
 *     while testing the wrong substrate, which is the one outcome this job
 *     exists to prevent;
 *   - a failure becomes a `::error` annotation, so it renders as a red
 *     annotation on the run rather than as a red line in a log nobody reads.
 *
 * The gate's own output is passed through to stderr as it happens, because a
 * store-gate failure is a wall of per-check detail and a CI log that hides it
 * behind "exit 1" is the same as no log.
 *
 * Why not just `if [ $? -ne 0 ]`? Because a check that the gate ran on the
 * remote engine is a DIFFERENT claim from "the gate passed", and a shell
 * pipeline is a poor place to keep the second one. This keeps both, and the
 * second one is the one this job is for.
 *
 * Usage (what the workflow calls):
 *   DELEGATE_STORE_TEST_URL=… node scripts/store-gate-remote.mjs
 *   node scripts/store-gate-remote.mjs --self-test
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './is-main.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const GATE = join(ROOT, 'delegate', 'dist', 'store', 'test-store-backends.js');

/**
 * What the gate prints when it is on the substrate this leg exists to prove.
 *
 * A substring rather than a whole line, because the gate names the database it
 * connected to and that name is whatever the CI parent branch was created with
 * — not ours to choose, and not something to hard-code. Anchored on the
 * "postgres leg on" phrase the gate prints, so a rename of the surrounding
 * prose does not silently turn this into a check that passes on anything.
 */
const REMOTE_ENGINE_LINE = /postgres leg on remote postgres/;

/** GitHub's failure channel: a red annotation on the run, not just a red line. */
function annotate(message) {
  process.stderr.write(`::error title=Store gate::${message}\n`);
}

/**
 * Run the gate and judge it.
 *
 * The child is spawned, not imported, and waited for on `close` rather than
 * read synchronously: the gate is a program with its own store, its own
 * database and its own stdout, and the answers have to leave through the
 * process boundary to be worth anything.
 *
 * Exported with its dependencies passed in so the self-test can hand it a stub
 * that behaves like a gate without needing one built.
 */
export async function runRemoteGate({
  argv = [GATE],
  cwd = ROOT,
  env = process.env,
  spawnImpl = spawn,
  onOutput = (text) => process.stderr.write(text),
} = {}) {
  return new Promise((settle) => {
    const child = spawnImpl(process.execPath, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    // The gate prints its per-check detail to stdout and its own failures to
    // stderr; both are the log, so both are collected. `close` rather than
    // `exit`: `close` fires after the streams are done, and a verdict read
    // before the last line arrives is a verdict read on half an answer.
    child.stdout.on('data', (chunk) => {
      output += chunk;
      onOutput(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
      onOutput(chunk);
    });
    child.on('error', (error) =>
      settle({ status: 1, output, error: `the gate could not be run at all — ${error.message}` }),
    );
    child.on('close', (status) => settle({ status, output }));
  });
}

/**
 * The verdict on a finished gate run.
 *
 * Both halves return a `level`, so the caller cannot accidentally honour one
 * without the other: `pass` only when the gate exited clean AND said it was on
 * a remote engine.
 */
export function judgeGate({ status, output, error }) {
  if (error !== undefined) {
    return { level: 'error', message: error, code: 1 };
  }
  // The gate's own status, straight from the process. Not a pipeline's, not
  // `tee`'s, not a shell's opinion of one.
  if (status !== 0) {
    return {
      level: 'error',
      message: `the gate failed over the Neon driver (exit ${status})`,
      code: status,
    };
  }
  if (!REMOTE_ENGINE_LINE.test(output)) {
    return {
      level: 'error',
      message:
        'the remote leg did not report a remote engine — it ran on something else, so the driver is untested',
      code: 1,
    };
  }
  return { level: 'pass', message: 'the gate passed on a remote postgres', code: 0 };
}

async function main(argv) {
  if (argv.includes('--self-test')) return selfTest();

  const url = (process.env.DELEGATE_STORE_TEST_URL ?? '').trim();
  if (url === '') {
    // The workflow keys this step on the URI, so this is a person running it
    // by hand against an environment that would have skipped the step. Saying
    // so beats opening an in-process engine and reporting a pass for a leg that
    // never touched the driver.
    annotate(
      'DELEGATE_STORE_TEST_URL is empty, so there is no database to run the remote leg against — the workflow skips this step in that case rather than running it',
    );
    return 1;
  }

  const run = await runRemoteGate();
  const judged = judgeGate(run);
  if (judged.level !== 'pass') {
    annotate(judged.message);
    return judged.code;
  }
  process.stderr.write(`${judged.message}\n`);
  return 0;
}

/**
 * The decisions, against a stub that behaves like a gate.
 *
 * Each case is a thing that has actually gone wrong in a shell version of this:
 * a status read from the wrong stage of a pipeline, an engine assertion that
 * passed because it grepped a file nothing wrote, and a failure that exited 0.
 */
function selfTest() {
  let failures = 0;
  const check = (name, passed, detail) => {
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
    if (!passed) failures += 1;
  };

  // A fake gate, as a real child process, because the point is that the status
  // comes from the process and not from anything this program believes.
  const dir = mkdtempSync(join(tmpdir(), 'store-gate-remote-'));
  const fakeGate = (body) => {
    const path = join(dir, `gate-${Math.random().toString(36).slice(2)}.mjs`);
    writeFileSync(path, body, 'utf8');
    return path;
  };
  const runStub = (script, env = {}) =>
    runRemoteGate({
      argv: [script],
      // A built gate is not needed to test a verdict about a gate, and the
      // doctor runs this at commit time where delegate/dist may not exist.
      onOutput: () => {},
      env: { ...process.env, ...env },
    });

  return (async () => {
    // The happy path, and the engine claim asserted against what was printed.
    {
      const gate = fakeGate(
        'console.log("store gate: postgres leg on remote postgres (delegate-ci)\\n");\nconsole.log("all store-backend checks passed");\n',
      );
      const run = await runStub(gate);
      const judged = judgeGate(run);
      check(
        'a gate that passed on a remote postgres is a pass',
        judged.level === 'pass' && judged.code === 0,
        `exit ${run.status}, verdict ${judged.level}`,
      );
    }

    // THE claim. A gate that fell back to the in-process engine passes every
    // check it makes while testing the wrong substrate, and its exit status is
    // zero — so the status alone cannot catch it and the printed line must.
    {
      const gate = fakeGate(
        'console.log("store gate: postgres leg on in-process postgres (/tmp/pg)\\n");\nconsole.log("all store-backend checks passed");\n',
      );
      const run = await runStub(gate);
      const judged = judgeGate(run);
      check(
        'a gate that passed on the WRONG engine is refused, even though it exited 0',
        judged.level === 'error' && judged.code !== 0 && judged.message.includes('did not report a remote engine'),
        `the gate exited ${run.status} and said "in-process"; verdict ${judged.level}`,
      );
    }

    // And the shell's own failure mode, reproduced: piped into something that
    // succeeds, the status a shell reports is the LAST stage's. Here the gate
    // fails and nothing hides it.
    {
      const gate = fakeGate(
        'console.log("store gate: postgres leg on remote postgres (delegate-ci)");\nconsole.error("FAIL  a store check — the rows did not survive");\nprocess.exit(3);\n',
      );
      const run = await runStub(gate);
      const judged = judgeGate(run);
      check(
        "the gate's own failing status is the one that is reported, not a wrapper's",
        run.status === 3 && judged.code === 3 && judged.message.includes('exit 3'),
        `gate exited ${run.status}, this program would exit ${judged.code}`,
      );
    }

    // A gate that says nothing at all has not been run, whatever it exited.
    {
      const gate = fakeGate('process.exit(0);\n');
      const judged = judgeGate(await runStub(gate));
      check(
        'a gate that printed nothing is refused rather than passed on its exit code',
        judged.level === 'error' && judged.message.includes('did not report a remote engine'),
        judged.message,
      );
    }

    // And a gate that cannot be started at all, which is what a missing build
    // looks like — a null status and no output, not a failing exit.
    {
      const judged = judgeGate({ status: null, output: '', error: 'the gate could not be run at all — no such file' });
      check(
        'a gate that could not be run is named, not judged on a null exit status',
        judged.level === 'error' && judged.message.includes('could not be run at all'),
        judged.message,
      );
    }

    // The empty-URI case, which the workflow's own `if:` normally prevents.
    {
      const judged = judgeGate({ status: 0, output: '' });
      const spelled = REMOTE_ENGINE_LINE.test('store gate: postgres leg on remote postgres (x)');
      check(
        'the engine line is anchored on the phrase the gate prints, not a bare word',
        spelled && !REMOTE_ENGINE_LINE.test('the remote postgres driver is fine') && judged.level === 'error',
        'a bare "remote postgres" must not satisfy it, or any mention would pass',
      );
    }

    rmSync(dir, { recursive: true, force: true });
    console.log(failures === 0 ? '\nall store-gate-remote checks passed' : `\n${failures} store-gate-remote check(s) FAILED`);
    return failures === 0 ? 0 : 1;
  })();
}

// Guarded: the doctor imports `judgeGate` to read the verdict function without
// running the gate.
if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
