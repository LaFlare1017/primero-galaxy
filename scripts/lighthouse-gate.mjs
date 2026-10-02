#!/usr/bin/env node
/**
 * CI gate for the Lighthouse accessibility + SEO scores.
 *
 * The app currently holds 100/100 on both categories for every route. This
 * reads one or more `lighthouse --output=json` reports and exits non-zero if any
 * accessibility or SEO category score falls below the floor, so a regression
 * fails the build instead of silently drifting.
 *
 * The scoring was top-level code in a script, and that made it unusable by
 * anything else: importing this module to reach the verdict ran the whole
 * program, read `process.argv` — which belongs to the IMPORTER — and called
 * `process.exit`. So a caller that wanted the judgement had to either reimplement
 * it or shell out, and the version CI actually runs was not the version
 * anything could test. The function is exported and the run is behind
 * `isMain`, the same guard every other program in this repository uses.
 *
 * Usage:
 *   node scripts/lighthouse-gate.mjs <report.json> [report.json ...]
 */
import { readFileSync } from 'node:fs';
import { isMain } from './is-main.mjs';

// 100%: the score the app holds today. Lower this floor deliberately only
// if a future design decision trades a small a11y/SEO cost for something
// bigger; the point of the gate is that the change is conscious.
const MIN_SCORE = 1.0;

/**
 * The verdict on a set of reports.
 *
 * Returns rather than exits, so a caller can decide what a failure means: CI
 * turns it into an annotation, and a test can assert on it. A report that
 * cannot be READ is counted as a failure rather than skipped — a report nobody
 * could open is not a report with no regressions in it.
 *
 * `out` is injectable so this can be exercised without a terminal.
 */
export function auditReports(files, { out = (line) => console.log(line) } = {}) {
  let failed = false;

  for (const file of files) {
    let report;
    try {
      report = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      out(`✗ could not read Lighthouse report ${file}: ${err.message}`);
      failed = true;
      continue;
    }

    for (const [name, category] of Object.entries(report.categories ?? {})) {
      const score = category.score ?? 0;
      const pct = Math.round(score * 100);
      const ok = score >= MIN_SCORE;
      if (!ok) failed = true;
      out(`${ok ? '✓' : '✗'} ${file} · ${name}: ${pct}/100`);
    }
  }

  return failed;
}

async function main(argv) {
  if (argv.length === 0) {
    console.error('usage: node scripts/lighthouse-gate.mjs <lighthouse-report.json> [...]');
    return 2;
  }
  const failed = auditReports(argv);
  if (failed) {
    console.error('\nLighthouse gate failed: accessibility/SEO score fell below the required floor.');
    return 1;
  }
  console.log('\nLighthouse gate passed.');
  return 0;
}

// Guarded, so importing this for `auditReports` reads the reports rather than
// scoring whatever the importing process was called with.
if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
