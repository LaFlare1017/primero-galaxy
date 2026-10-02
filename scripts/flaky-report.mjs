#!/usr/bin/env node
/**
 * Flaky-test report for the Playwright CI run.
 *
 * With retries enabled (`retries: process.env.CI ? 2 : 0`), a flaky test
 * PASSES the job — its failures are smoothed over and nothing surfaces
 * them. The JSON report (`test-results/results.json`, emitted by the json
 * reporter on CI) marks such tests `flaky`, and this script turns that
 * into a GitHub Actions job summary plus a `flaky_count` output, so the
 * flake rate is visible instead of silently absorbed.
 *
 * Usage:
 *   node scripts/flaky-report.mjs <results.json>
 *
 * Modes:
 *   default        write the summary; never fail the job (a flake is a
 *                  signal to investigate, not a red X)
 *   --fail-on-flaky
 *                  additionally exit 1 when flaky_count > 0 — opt-in
 *                  hardening for when the suite is trusted stable
 *
 * Output contract with the workflow:
 *   >> $GITHUB_OUTPUT   flaky_count=<n>
 *   >> $GITHUB_STEP_SUMMARY   markdown table of flaky tests
 */
import { appendFileSync, readFileSync } from 'node:fs';

const failOnFlaky = process.argv.includes('--fail-on-flaky');
const file = process.argv[2];

if (!file) {
  console.error('Usage: node scripts/flaky-report.mjs <results.json> [--fail-on-flaky]');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  // A missing/unreadable report must not mask the test result: the suite
  // may have failed before the reporter flushed. Note and exit neutral.
  console.error(`flaky-report: cannot read ${file}: ${err.message}`);
  process.exit(0);
}

const suites = report.suites ?? [];

/** Flatten the suite tree; suite-level `specs` carry per-test `tests`. */
function* walkSpecs(list, parentFile = '') {
  for (const suite of list) {
    const file = suite.file ?? parentFile;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        yield { spec, test, file };
      }
    }
    yield* walkSpecs(suite.suites ?? [], file);
  }
}

/** Outcome of one attempt: 'flaky' when it failed but a later one passed. */
function attemptsOf(test) {
  return (test.results ?? []).map((r) => r.status);
}

const flaky = [];
const failed = [];
for (const { spec, test, file: suiteFile } of walkSpecs(suites)) {
  const statuses = attemptsOf(test);
  const label = `${suiteFile} › ${spec.title}`;
  // Playwright marks the test `flaky` when an earlier attempt failed but a
  // later one passed; `expected`/`unexpected` cover the clean cases.
  if (test.status === 'flaky') {
    const firstFailure = statuses.findIndex((s) => s !== 'passed' && s !== 'skipped');
    flaky.push({ label, attempts: statuses, retriedAfter: firstFailure + 1 });
  } else if (test.status === 'unexpected') {
    failed.push({ label, attempts: statuses });
  }
}

const lines = [];
lines.push('## Flaky tests');
lines.push('');
if (flaky.length === 0) {
  lines.push('None — every test passed on its first attempt. 🎯');
} else {
  lines.push(`${flaky.length} test${flaky.length > 1 ? 's' : ''} passed only after a retry:`);
  lines.push('');
  lines.push('| Test | First failure after | Attempts (in order) |');
  lines.push('|---|---|---|');
  for (const f of flaky) {
    lines.push(`| \`${f.label}\` | attempt ${f.retriedAfter} | ${f.attempts.join(' → ')} |`);
  }
  lines.push('');
  lines.push('_Traces of the failed attempts are in the test-results artifact (trace: on-all-retries)._');
}
if (failed.length > 0) {
  lines.push('');
  lines.push(`**${failed.length} test${failed.length > 1 ? 's' : ''} failed outright:**`);
  for (const f of failed) lines.push(`- \`${f.label}\` (${f.attempts.join(' → ')})`);
}

const summary = lines.join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${summary}\n`);
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `flaky_count=${flaky.length}\n`);
}

if (failOnFlaky && flaky.length > 0) {
  console.error(`flaky-report: --fail-on-flaky is set and ${flaky.length} test(s) flaked`);
  process.exit(1);
}
