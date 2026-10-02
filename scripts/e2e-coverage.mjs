#!/usr/bin/env node
/**
 * What this run did NOT prove, read out of the Playwright report.
 *
 * A skipped test is not a failed one. That is the right behaviour — a spec
 * behind a paid key must not turn a fork pull request red — and it hides the one
 * thing a green tick should never be able to hide: that something in the suite
 * did not run. The report says it plainly and the log does not: a skip prints
 * as `-  1 e2e/some.spec.ts:110:7` with no reason, and the summary line reads
 * `132 passed`, which is exactly what a run where everything ran also reads.
 *
 * So this walks every skipped test and names it, with the reason it recorded.
 * It generalises a step that started out about one file — the cold-process chat
 * spec, which skips itself when there is no `ANTHROPIC_API_KEY` — because "the
 * one spec that skips" stops being true the moment a second spec is written
 * behind a key, and a gate with a hard-coded filename is a gate that will be
 * quietly wrong the day it matters.
 *
 * Three verdicts, because a skip is not one kind of thing:
 *
 *   - **A skip with no recorded reason FAILS, always.** An unexplained skip is
 *     a hole nobody can see, including the person who wrote it. It is the only
 *     outcome here worth refusing outright.
 *   - **A skip for want of a secret FAILS on an event that should have had
 *     one.** After the cold-chat replay, nothing in this suite needs a key, so
 *     a secret-gated skip is a spec that has not caught up — and on a fork pull
 *     request, where GitHub sends no secrets at all, it is expected and becomes
 *     a notice. That split is the store gate's, for the store gate's reason.
 *   - **Any other skip is named and nothing more.** It was a decision somebody
 *     made and wrote down; the job's business is to make sure the decision is
 *     visible, not to overrule it.
 *
 * Reading the report rather than the environment is the whole design. A key's
 * PRESENCE is not the claim; what ran is, and only the report says what ran. A
 * key that was set and the spec still skipped — expired, wrong shape, an `if`
 * that stopped applying it — is exactly the case a presence check walks past.
 *
 * Usage:
 *   node scripts/e2e-coverage.mjs <results.json> [--fork-pr]
 *
 * Exits 0 when everything that skipped had a reason and none of them wanted a
 * secret, 1 otherwise, and 0 with a note when the report is missing or
 * unreadable — a suite that crashed before flushing has already failed the step
 * above, and this must not mask that with a second, vaguer failure.
 */
import { appendFileSync, readFileSync } from 'node:fs';

/** The spec whose running is the suite's most valuable assertion, and why. */
const COLD_CHAT = 'delegate-cold-chat.spec.ts';

/**
 * What a recorded skip has to say for it to be treated as a decision.
 *
 * A heuristic, deliberately, and one that shows its work: the words it matched
 * are printed beside the verdict, so a skip classified as secret-gated can be
 * seen to be right and a misclassification can be argued with, rather than
 * being a rule that silently decides somebody's CI is broken.
 */
const SECRET_WORDS = [
  'api_key',
  'api key',
  'apikey',
  'secret',
  'credential',
  'token',
  'no key',
];

function readReport(file) {
  let report;
  try {
    report = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`e2e-coverage: cannot read ${file}: ${err.message}`);
    console.log(
      `No report at ${file}, so this run cannot say what it skipped. The suite above reported its own result.`,
    );
    return null;
  }
  return report;
}

/**
 * Every test in the report, flattened. Suite nesting is arbitrary depth, and a
 * gate that stops at the first level silently reports "nothing skipped" for a
 * report shaped differently from the one it was written against — which is the
 * failure mode of every count that is walked by hand.
 */
function collectSpecs(suites) {
  const specs = [];
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) specs.push(spec);
    specs.push(...collectSpecs(suite.suites));
  }
  return specs;
}

/** A spec's recorded skip reason, or null when it recorded none. */
function skipReason(spec) {
  for (const test of spec.tests ?? []) {
    for (const result of test.results ?? []) {
      const note = (result.annotations ?? []).find((entry) => entry.type === 'skip');
      if (note?.description) return note.description;
    }
  }
  return null;
}

/** The agent the spec recorded answering it, if it recorded one. */
function whichAgent(specs) {
  for (const spec of specs) {
    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) {
        const note = (result.annotations ?? []).find((entry) => entry.type === 'agent');
        if (note?.description) return note.description;
      }
    }
  }
  return null;
}

/** The words that made a reason look like a missing credential. */
function secretWordsIn(reason) {
  const lower = reason.toLowerCase();
  return SECRET_WORDS.filter((word) => lower.includes(word));
}

/** Every test that did not run, with the file it is in — a title alone repeats. */
function skipped(report) {
  return collectSpecs(report.suites)
    .filter((spec) => (spec.tests ?? []).every((test) => test.status === 'skipped'))
    .map((spec) => ({
      file: String(spec.file ?? '(unknown file)'),
      title: spec.title,
      reason: skipReason(spec),
    }));
}

function coldChat(report) {
  return collectSpecs(report.suites).filter((spec) =>
    String(spec.file ?? '').endsWith(COLD_CHAT),
  );
}

/**
 * Classify, and decide.
 *
 * Kept apart from the printing so the verdicts are one small function with no
 * side effects — the thing a reader can check against the sentence above it.
 */
function verdictsFor({ skippedTests, coldRan, agent, forkPullRequest }) {
  // Every field the caller is given comes back out of here, including the ones
  // the caller passed in. A verdict object that quietly drops one is how a
  // summary ends up saying a spec did not run while the suite reports it green:
  // the value was never missing, it was just never handed back.

  const unexplained = skippedTests.filter((entry) => entry.reason === null);
  const secretGated = skippedTests
    .filter((entry) => entry.reason !== null)
    .map((entry) => ({ ...entry, matched: secretWordsIn(entry.reason) }))
    .filter((entry) => entry.matched.length > 0);

  const reasons = [];
  if (!coldRan) reasons.push(`the cold-process chat spec did not run`);
  if (unexplained.length > 0) {
    reasons.push(
      `${unexplained.length} skipped test${unexplained.length === 1 ? '' : 's'} recorded no reason: ${unexplained
        .map((entry) => `${entry.file} › ${entry.title}`)
        .join('; ')}`,
    );
  }
  if (secretGated.length > 0 && !forkPullRequest) {
    reasons.push(
      `${secretGated.length} skipped test${secretGated.length === 1 ? '' : 's'} for want of a secret on an event that should have had one: ${secretGated
        .map((entry) => `${entry.file} › ${entry.title} (${entry.matched.join(', ')})`)
        .join('; ')}`,
    );
  }

  return {
    coldRan,
    unexplained,
    secretGated,
    agent,
    reasons,
    // A fork pull request gets no secrets, so a secret-gated skip there is the
    // correct behaviour and is reported, not refused. An unexplained skip is
    // wrong everywhere, including there.
    failed: reasons.length > 0,
    expectedOnFork: secretGated.length > 0 && forkPullRequest,
  };
}

function buildSummary({ skippedTests, coldRan, agent, unexplained, secretGated, failed, expectedOnFork }) {
  const lines = [];

  lines.push('### What this run did not prove');

  if (skippedTests.length === 0) {
    lines.push('', 'Nothing skipped. Every test in the suite ran.');
  } else {
    lines.push('', `**${skippedTests.length} test${skippedTests.length === 1 ? '' : 's'} did not run.** A skipped test is not a failed one, so the run above still reads green.`);
    lines.push('');
    for (const entry of skippedTests) {
      const tag = entry.reason === null ? '**no reason recorded**' : entry.reason;
      lines.push(`- \`${entry.file}\` › ${entry.title}`);
      lines.push(`  — ${tag}`);
    }
  }

  lines.push('');
  lines.push(
    coldRan
      ? `The cold-process chat spec ran, answered by the **${agent ?? 'unrecorded'}**. ${
          agent === 'recorded transcript'
            ? 'The restart is proved; the model itself is not exercised.'
            : ''
        }`.trim()
      : '**The cold-process chat spec did not run**, so nothing proved that a restarted process recovers the conversation.',
  );

  if (expectedOnFork) {
    lines.push(
      '',
      `${secretGated.length} of those wanted a secret. GitHub sends none to a fork pull request, so that is expected here and is not counted as a failure.`,
    );
  }
  if (unexplained.length > 0) {
    lines.push('', 'A skip with no recorded reason is a hole nobody can see. The spec should say why it skipped, in the `test.skip` description.');
  }

  if (failed) lines.push('', '**This step failed** — see the annotations above.');
  return lines.join('\n');
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/e2e-coverage.mjs <results.json> [--fork-pr]');
  process.exit(2);
}

const report = readReport(file);
if (report === null) process.exit(0);

/** Walked once. A report is 133 specs; re-walking it per question is how two of them drift apart. */
const specs = collectSpecs(report.suites);
const ATTEMPTED = ['expected', 'flaky', 'unexpected'];
const ranAnything = specs.some((spec) =>
  (spec.tests ?? []).some((test) => ATTEMPTED.includes(test.status)),
);
const skippedTests = skipped(report);
const cold = coldChat(report);

const verdict = verdictsFor({
  skippedTests,
  // `ranAnything` as well as the file being present: a report can hold a
  // cold-chat spec that was collected and then skipped, and "the file is in the
  // report" is not the same claim as "the assertion ran".
  coldRan: ranAnything && cold.length > 0 && cold.every((spec) => (spec.tests ?? []).some((test) => ATTEMPTED.includes(test.status))),
  agent: whichAgent(cold),
  forkPullRequest: process.argv.includes('--fork-pr'),
});

const summary = buildSummary({ ...verdict, skippedTests });
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

// The log and the summary must agree, so the same facts go to both. A reader
// who never opens the job summary still learns what was skipped.
for (const entry of skippedTests) {
  console.log(
    `skipped  ${entry.file} › ${entry.title}${entry.reason === null ? ' — NO REASON RECORDED' : ` — ${entry.reason}`}`,
  );
}
console.log(
  verdict.coldRan
    ? `cold-process chat: ran, answered by the ${verdict.agent ?? 'unrecorded agent'}`
    : 'cold-process chat: DID NOT RUN',
);
console.log(
  verdict.failed
    ? `${skippedTests.length} skipped; ${verdict.reasons.length} of them matter:`
    : `${skippedTests.length} skipped, all accounted for.`,
);
for (const reason of verdict.reasons) console.log(`  - ${reason}`);
if (verdict.expectedOnFork && verdict.reasons.length === 0) {
  console.log('  (a secret-gated skip on a fork pull request is expected, not a failure)');
}

process.exit(verdict.failed ? 1 : 0);
