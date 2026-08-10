#!/usr/bin/env node
/**
 * CI gate for the Lighthouse accessibility + SEO scores.
 *
 * The app currently holds 100/100 on both categories for every route. This
 * script reads one or more `lighthouse --output=json` reports and exits
 * non-zero if any accessibility or SEO category score falls below the floor,
 * so a regression fails the build instead of silently drifting.
 *
 * Usage:
 *   node scripts/lighthouse-gate.mjs <report.json> [report.json ...]
 */
import { readFileSync } from 'node:fs';

// 100%: the score the app holds today. Lower this floor deliberately only
// if a future design decision trades a small a11y/SEO cost for something
// bigger; the point of the gate is that the change is conscious.
const MIN_SCORE = 1.0;

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/lighthouse-gate.mjs <lighthouse-report.json> [...]');
  process.exit(2);
}

let failed = false;

for (const file of files) {
  let report;
  try {
    report = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`✗ could not read Lighthouse report ${file}: ${err.message}`);
    failed = true;
    continue;
  }

  for (const [name, category] of Object.entries(report.categories ?? {})) {
    const score = category.score ?? 0;
    const pct = Math.round(score * 100);
    const ok = score >= MIN_SCORE;
    if (!ok) failed = true;
    console.log(`${ok ? '✓' : '✗'} ${file} · ${name}: ${pct}/100`);
  }
}

if (failed) {
  console.error('\nLighthouse gate failed: accessibility/SEO score fell below the required floor.');
  process.exit(1);
}

console.log('\nLighthouse gate passed.');
