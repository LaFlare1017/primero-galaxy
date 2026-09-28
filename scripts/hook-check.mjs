#!/usr/bin/env node
/**
 * Does the tracked commit-time hook actually gate a commit?
 *
 * `git commit` runs the *hook*, a one-line shell script in this repository that
 * nothing else executed: unlike the checks it calls, it is not imported by
 * anything and no test touched it, so it could rot on its own and nobody would
 * find out until it landed in somebody's working copy. A typo in its path, a
 * lost executable bit (git prints a hint and commits anyway), a body emptied in
 * a refactor that exits 0 — none of that is visible to a gate script that
 * passes, and a gate script that passes is all anybody ever sees.
 *
 * So this asks two questions, both the way a commit asks them:
 *
 *   1. does it run?   Through git itself — `-c core.hooksPath=.githooks hook run
 *      pre-commit` — rather than `sh .githooks/pre-commit`, so the directory
 *      resolution and the executable bit are part of the test instead of being
 *      bypassed by it.
 *   2. does it refuse?   A rule that covers tracked files is appended to the
 *      working `.gitignore`, the hook is run again, and it has to fail. This is
 *      the half that tells "the hook ran" apart from "the hook checks
 *      something": a hook that was emptied, or that ends in `|| true`, passes
 *      question 1 by doing nothing at all and only ever fails here.
 *
 * "Does it run" is answered from git's own records as well as the filesystem:
 * the executable bit on a machine is not what a clone inherits, so a hook can be
 * executable here, recorded as `100644`, and dead everywhere else.
 *
 * The plant is removed in a `finally` and then read back to prove it, because a
 * check that leaves a rule behind in a local working copy would be worse than
 * no check — and it is removed with the original bytes, not with a checkout.
 *
 * The doctor runs this on a CI checkout, where "is the hook installed in this
 * clone" is not a question CI can answer or needs to; the CLI below is for
 * asking it by hand anywhere else.
 *
 * Usage:
 *   node scripts/hook-check.mjs
 *
 * Exit codes: 0 the hook runs and refuses · 1 it does not · 2 the check could
 * not run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOOKS_PATH, hookProblems, shadowed } from './hooks-install.mjs';
import { isMain } from './is-main.mjs';

const HOOK = 'pre-commit';

/**
 * What gets planted to give the hook something to refuse. A glob over a file
 * type this repo tracks in numbers, rather than one path, so that no `!`
 * negation already in the file can quietly defuse the plant — `!.env.local.example`
 * defusing `.env*` is exactly that shape, and a plant nobody can see fail would
 * make this check pass for the wrong reason.
 */
const PLANT = '*.md';

function git(args, { cwd, allowMissing = false } = {}) {
  const result = spawnSync('git', args, { cwd });
  if (result.error) throw new Error(`could not run \`git ${args.join(' ')}\`: ${result.error.message}`);
  if (result.status !== 0 && !allowMissing) {
    const detail = (result.stderr ?? '').toString().trim();
    throw new Error(`\`git ${args.join(' ')}\` exited ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.toString('utf8');
}

/** Runs the tracked hook the way a commit does: through git, from the root. */
function runHook(root) {
  const result = spawnSync('git', ['-c', `core.hooksPath=${HOOKS_PATH}`, 'hook', 'run', HOOK], { cwd: root, encoding: 'utf8' });
  if (result.error) throw new Error(`could not run the hook: ${result.error.message}`);
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

/**
 * The line of a hook's output that says what happened. Git and node both bury
 * the useful line: a failed `exec node` leads with the module loader's own
 * position and only then says what it could not find, so a line that reports a
 * fault is preferred over merely the first one.
 */
function notableLine(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => /error|cannot|✗|not found|no such/i.test(line)) ?? lines[0] ?? '';
}

/** Returns `{ ok, detail }`. Reads the repository, and restores what it writes. */
export function checkHook(root) {
  const hooks = shadowed(join(root, HOOKS_PATH));
  if (!hooks.some((path) => path.endsWith(`/${HOOK}`))) {
    return { ok: false, detail: `${HOOKS_PATH}/ holds no ${HOOK} that git would run` };
  }

  // Where the bit is missing comes first, because it changes what every later
  // answer means — and half of that question is about git's record rather than
  // this machine's filesystem, which is the half a clone inherits.
  const problems = hookProblems(root, `${HOOKS_PATH}/${HOOK}`);
  if (problems.length > 0) {
    return {
      ok: false,
      detail: problems.map((problem) => problem.detail).join('; '),
      fixes: problems.map((problem) => problem.fix),
    };
  }

  const clean = runHook(root);
  if (clean.status !== 0) {
    return { ok: false, detail: `it fails on a clean checkout (exit ${clean.status}): ${notableLine(clean.output)}` };
  }

  const ignore = join(root, '.gitignore');
  if (!existsSync(ignore)) {
    return { ok: false, detail: `.gitignore is missing, so there is no rule to plant and no way to tell a hook that checks from one that does not` };
  }

  const before = readFileSync(ignore);
  const text = before.toString('utf8');
  try {
    writeFileSync(ignore, `${text}${text.endsWith('\n') ? '' : '\n'}${PLANT}\n`);
    const planted = runHook(root);
    if (planted.status === 0) {
      return { ok: false, detail: `it passed with "${PLANT}" added to .gitignore — whatever it is running is not refusing anything` };
    }
    return { ok: true, detail: `runs on a clean checkout, and refuses "${PLANT}" planted in .gitignore — ${notableLine(planted.output)}` };
  } finally {
    writeFileSync(ignore, before);
    if (!readFileSync(ignore).equals(before)) {
      throw new Error('.gitignore was not restored to the bytes it started with — check it before committing');
    }
  }
}

function check() {
  const root = git(['rev-parse', '--show-toplevel'], { cwd: process.cwd() }).trim();
  const { ok, detail, fixes } = checkHook(root);
  if (!ok) {
    console.error(`✗ ${HOOKS_PATH}/${HOOK}: ${detail}`);
    for (const fix of fixes ?? []) console.error(`    ${fix}`);
    console.error('\nThe hook is the half that runs this gate at commit time — a hook that cannot run, or that agrees with everything, gates nothing.');
    process.exit(1);
  }
  console.log(`✓ ${HOOKS_PATH}/${HOOK}: ${detail}`);
  console.log('Commit-time hook check passed.');
}

// Only when run as the script: importing this module to exercise `checkHook`
// should not go writing into whatever repository the caller is in.
if (isMain(import.meta.url)) {
  try {
    check();
  } catch (error) {
    console.error(`✗ ${error.message}`);
    console.error('\nCommit-time hook check could not run — that is a failure, not a pass.');
    process.exit(2);
  }
}
