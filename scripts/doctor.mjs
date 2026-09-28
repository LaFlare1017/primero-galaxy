#!/usr/bin/env node
/**
 * Doctor: every question this checkout can answer about itself, answered in one
 * pass, without changing anything.
 *
 * This file is the runner and nothing else — it discovers the checks, runs them
 * in the order they ask for, prints one line each and counts. Every invariant is
 * its own module under `doctor/checks/`, default-exporting
 * `{ name, order, commit, run }`, so a new check is a new file and the reason it
 * reads where it reads lives in the file that knows why. There is no list of
 * names here on purpose: a list is a second place a check can be forgotten, and
 * a check nobody runs is indistinguishable from a rule that holds.
 *
 * Three rules shape it:
 *
 *   - It reports, it does not repair. Every fix is named as a hint and left to
 *     the person, because a doctor that quietly edits your config, rebuilds a
 *     workspace or rewrites copy is a doctor you stop trusting. The one thing it
 *     writes — the line the hook check plants in `.gitignore` on CI — it puts
 *     back with its original bytes and reads them back before returning.
 *   - A check that cannot run is a FAILURE, not a pass. That is the rule the
 *     gitignore gate's own fixture enforces, the rule the loader applies to a
 *     check module that is not one, and the reason `scan`, the hook resolver and
 *     the hook check are imported from the scripts that own them instead of
 *     being re-derived here: a second opinion about an invariant is a second
 *     thing to keep in sync.
 *   - It does not ask to be believed. Every check carries `proof` — the levels
 *     it claims, and the fixture state that makes each one happen — and the run
 *     that reports on this checkout first builds those fixtures and insists each
 *     check report what it claims, so a check that can only report good news
 *     fails the run that was counting on it. That section is printed below the
 *     report, and a proof that did not hold fails the run even when every line
 *     above it passed: those lines are the evidence, and unproved evidence is
 *     not evidence.
 *
 * The one run that skips the proofs is `--fast`, which is what a commit waits
 * for: the fixtures are dozens of processes, and a commit is not the place to
 * spend them. The two checks that hook relies on are proved by every other run,
 * including the CI step that gates the same commit, and `--prove` asks for them
 * anyway.
 *
 * The levels are deliberately not two:
 *
 *   ✓ pass   the checkout is as it should be
 *   ! warn   a state this repo treats as a choice — an uninstalled hook, a
 *            `.env.local` you may not want, a workspace you may not have built
 *   ✗ fail   broken, or a contradiction nothing else would notice
 *   ·  —     not asked here: nothing to check, or a state that only exists off
 *            CI — a `.env.local`, an installed hook, a built workspace
 *
 * Usage:
 *   node scripts/doctor.mjs [--strict] [--fast] [--prove]
 *
 * `--strict` exits non-zero on warnings too. CI runs `doctor --strict`, and this
 * is the one entry point the repo's checks are wired to — the gitignore gate and
 * the hook check reach CI through here rather than through steps of their own —
 * so that a rule, an invariant or a checker has one definition rather than two.
 * On a fresh CI checkout the states the local run calls warnings are not choices
 * at all, so those checks say so and stand down.
 *
 * `--fast` is the commit-time subset, which is what `.githooks/pre-commit` runs:
 * the checks marked `commit: true`, whose subject is the commit in progress
 * rather than this machine, asked the way that commit sees them.
 *
 * Exit codes: 0 nothing failed · 1 a check failed · 2 the doctor itself could
 * not run (not a git checkout, a check module that is not a check, an unknown
 * argument).
 */
import { checks } from './doctor/checks.mjs';
import { git } from './doctor/lib.mjs';
import { findingFrom, MARKS } from './doctor/levels.mjs';
import { prove as proveChecks } from './doctor/prove.mjs';
import { isMain } from './is-main.mjs';

export async function doctor({ strict = false, fast = false, prove = false, root = null } = {}) {
  const top = root ?? git(['rev-parse', '--show-toplevel'], { cwd: process.cwd() });
  // Where this run is, as the checks that care read it: CI is a fresh checkout
  // by construction, and a commit in progress is judged by its index. Passed
  // down rather than guessed at inside each check.
  const context = { ci: Boolean(process.env.CI), atCommit: fast };
  const all = await checks();
  const running = fast ? all.filter((check) => check.commit === true) : all;
  // Nothing marked for commit time would leave the hook gating nothing and
  // exiting clean, which is the failure that reads exactly like success.
  if (running.length === 0) throw new Error('no check is marked `commit: true` — the hook would gate nothing');
  const width = Math.max(...running.map((check) => check.name.length));

  console.log(
    `Primero Galaxy — repo doctor (${fast ? 'the checks a commit runs' : 'every question this checkout can answer about itself'}; reports only, nothing is left changed)\n`,
  );

  const totals = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const check of running) {
    // A check that could not run reads as a failure here: "no problems found"
    // and "never looked" are the same output otherwise.
    const result = findingFrom(check, top, context);
    totals[result.level] += 1;

    console.log(`  ${MARKS[result.level]} ${check.name.padEnd(width)}  ${result.detail}`);
    for (const line of [result.hint ?? []].flat()) console.log(`${' '.repeat(width + 6)}${line}`);
  }

  const parts = [`${totals.pass} passed`];
  if (totals.warn > 0) parts.push(`${totals.warn} warning${totals.warn === 1 ? '' : 's'}`);
  if (totals.fail > 0) parts.push(`${totals.fail} failed`);
  if (totals.skip > 0) parts.push(`${totals.skip} not present`);
  console.log(`\n${parts.join(' · ')}`);

  // Then the checks prove themselves, in fixture checkouts, at every level they
  // claim. Printed after the report rather than before it because it is what
  // makes the report worth reading — and printed at all rather than kept quiet,
  // since a proof nobody can see is the same as no proof. Skipped only when a
  // commit is waiting on it (`--fast`), where dozens of processes is a cost
  // nobody agreed to pay; `--prove` asks for it anyway.
  let unproved = 0;
  if (prove || !fast) {
    const proof = proveChecks(running);
    unproved = proof.failures;
    console.log('\nThe checks, proved against fixture checkouts\n');
    for (const result of proof.results) {
      const held = result.failures.length === 0;
      const said = held
        ? `reports ${result.levels.join(', ')}`
        : `${result.failures.length} claim${result.failures.length === 1 ? '' : 's'} did not hold`;
      console.log(`  ${MARKS[held ? 'pass' : 'fail']} ${result.name.padEnd(width)}  ${said}`);
      for (const line of result.failures) console.log(`${' '.repeat(width + 6)}${line}`);
    }
    console.log(
      proof.failures === 0
        ? `\n${proof.scenarios} fixtures · every check able to report bad news`
        : `\n${proof.scenarios} fixtures · ${proof.failures} claim${proof.failures === 1 ? '' : 's'} did not hold`,
    );
  }

  const failed = unproved > 0 || totals.fail > 0 || (strict && totals.warn > 0);
  if (!failed) {
    // Scoped to what ran: a commit-time pass is a statement about the index, not
    // about everything a checkout could be asked.
    const cleared = fast
      ? 'What this commit carries is as it should be.'
      : totals.warn > 0
        ? 'Nothing broken. The warnings above are choices this repo leaves open.'
        : 'Everything this checkout can check about itself is as it should be.';
    console.log(cleared);
    return 0;
  }
  console.log(
    unproved > 0
      ? 'Doctor found problems — a proof above did not hold, so the report is not evidence yet.'
      : 'Doctor found problems — the lines above each name their own fix.',
  );
  return 1;
}

// Only when run as the script: `doctor` is importable without running it.
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const known = new Set(['--strict', '--fast', '--prove']);
  const unknown = args.filter((arg) => !known.has(arg));
  try {
    if (unknown.length > 0) {
      throw new Error(
        `unrecognised argument${unknown.length === 1 ? '' : 's'}: ${unknown.join(' ')} (usage: doctor.mjs [--strict] [--fast] [--prove])`,
      );
    }
    process.exit(
      await doctor({ strict: args.includes('--strict'), fast: args.includes('--fast'), prove: args.includes('--prove') }),
    );
  } catch (error) {
    console.error(`✗ ${error.message}`);
    console.error('\nThe doctor could not examine this checkout — that is a failure, not a pass.');
    process.exit(2);
  }
}
