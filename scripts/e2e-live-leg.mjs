#!/usr/bin/env node
/**
 * Did the one E2E spec that needs a live model actually run?
 *
 * `e2e/delegate-cold-chat.spec.ts` is the only place a live agent call proves
 * something a mock cannot: it takes a chat turn, kills that server, starts a
 * second one, and asks the new process what it was asked a moment ago. Only a
 * process that recovered the transcript can answer, and that answer is the
 * assertion.
 *
 * So the file skips itself when `ANTHROPIC_API_KEY` is absent — skipped, not
 * failed, because a spec that costs money and needs a key must not turn a fork
 * pull request red. That is the right behaviour and it hides a real one: a
 * skipped spec is not a failure, so the run is green, and green with
 * `stats: {expected: 0, skipped: 1}` is the same tick as green with the test
 * actually having run. Nothing in the log distinguishes them either — the list
 * reporter prints `-  1 e2e/delegate-cold-chat.spec.ts:110:7` and stops.
 *
 * This reads the evidence instead of the environment. It does not check
 * whether the key was present, because a key's presence is not what is being
 * claimed — what is being claimed is that the assertion ran, and only the
 * report can say that. A key that was set and the spec still skipped is the
 * case a key-presence check would pass straight over.
 *
 * Usage:
 *   node scripts/e2e-live-leg.mjs <results.json>
 *
 * Exits 0 when the live leg ran, 1 when it did not, and 0 with a note when the
 * report is missing or unreadable — a suite that crashed before flushing the
 * report has already failed the step above, and this must not mask that with a
 * second, vaguer failure.
 *
 * Output contract with the workflow:
 *   $GITHUB_STEP_SUMMARY   whether the live leg ran, and why not if it did not
 */
import { appendFileSync, readFileSync } from 'node:fs';

/** The spec whose running is the claim. Named by path so a rename cannot pass. */
const LIVE_SPEC = 'delegate-cold-chat.spec.ts';

/**
 * Statuses that mean the assertion was actually attempted. These are the values
 * of `test.status` — Playwright's per-test VERDICT — and not of
 * `result.status`, which is the per-attempt outcome and spells the same
 * outcome differently (`passed` where a verdict says `expected`). Reading the
 * wrong one reports a green spec as never having run, which is a gate that
 * cries wolf on the first day it is trusted.
 */
const ATTEMPTED = new Set(['expected', 'flaky', 'unexpected']);

const file = process.argv[2];

if (!file) {
  console.error('Usage: node scripts/e2e-live-leg.mjs <results.json>');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`e2e-live-leg: cannot read ${file}: ${err.message}`);
  console.log(`No report at ${file}, so this run cannot say whether the live leg ran. The suite above reported its own result.`);
  process.exit(0);
}

/** Flatten the suite tree; a spec is only reported under the suites it nests in. */
function* walkSpecs(list) {
  for (const suite of list ?? []) {
    yield* suite.specs ?? [];
    yield* walkSpecs(suite.suites);
  }
}

const specs = [...walkSpecs(report.suites)].filter((spec) =>
  String(spec.file ?? '').endsWith(LIVE_SPEC),
);

/**
 * What stopped it, in the spec's own words. Playwright records a conditional
 * skip as an annotation on the result, so the reason that is missing from the
 * log line is in the report — and quoting it beats this script explaining a
 * skip the spec already explained.
 */
function whySkipped(specs) {
  for (const spec of specs) {
    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) {
        const skip = (result.annotations ?? []).find((note) => note.type === 'skip');
        if (skip?.description) return skip.description;
      }
    }
  }
  return 'no skip reason was recorded';
}

const attempted = specs.flatMap((spec) => spec.tests ?? []).filter((test) =>
  ATTEMPTED.has(test.status),
);

/**
 * What to say about it, in the two cases a green run cannot tell apart. A spec
 * that was collected and skipped is the gate doing its job; a spec that was
 * never collected is the suite aborting before it got there, which reads the
 * same in a report and means something else entirely.
 */
const reason =
  attempted.length > 0
    ? null
    : specs.length === 0
      ? 'the spec was never collected, so the run did not reach it'
      : whySkipped(specs);
const verdict = reason === null;

const summary = verdict
  ? `### Live leg\n\nThe cold-process chat spec ran against a real model — ${attempted.length} test(s) attempted. A restarted process was asked what it was asked a moment ago, and had to answer from the recovered transcript.`
  : `### Live leg did not run\n\nThe cold-process chat spec never executed, so **nothing this run proved that a restarted process recovers the conversation**. The suite still passed: a skipped spec is not a failure.\n\n- Reason recorded by the spec: _${reason}_\n- \`ANTHROPIC_API_KEY\` is the gate — add it as a repository secret and re-run.`;

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);

if (verdict) {
  console.log(`${LIVE_SPEC}: ran — ${attempted.length} test(s) attempted against the real agent.`);
  process.exit(0);
}

console.log(`${LIVE_SPEC}: did not run — ${reason}`);
process.exit(1);
