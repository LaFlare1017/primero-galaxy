/**
 * Readout tests: correct aggregation AND the §8 hard rule — no individual
 * attribution can appear in the export, even when the event log contains
 * participant names.
 */

import { generateReadout, loadReadoutInput } from "./readout";

let failures = 0;
function check(name: string, passed: boolean, detail: string): void {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!passed) failures += 1;
}

function main(): number {
  // Use the smoke cohort produced by test-smoke-scenarios.js.
  const input = loadReadoutInput("smoke-cohort", "v0.2-alpha");
  const out = generateReadout(input);

  check("Readout generates non-empty", out.length > 500, `${out.length} chars`);
  check(
    "§8: no participant names in output (attribution structurally excluded)",
    !/(alpha-verifier|alpha-truster|alpha-escalator|alpha-accepter|alpha-refuser|alpha-poster|e2e-|probe)/i.test(out),
    "scanned output for known participant labels",
  );
  check(
    "§8: flagged behaviors appear as counts",
    /accepted_agent_conclusion_uncaveated|posted_without_review/.test(out),
    "flag names present",
  );
  check(
    "Cross-cohort caveat present (n<5)",
    /fewer than five cohorts/i.test(out),
    "explicit no-comparison note",
  );
  check(
    "Facilitator-written control implication placeholder",
    /To be written by the facilitator/i.test(out),
    "§8.5 not generated",
  );

  console.log("\n--- Sample readout ---\n");
  console.log(out.split("\n").slice(0, 30).join("\n"));

  console.log(failures === 0 ? "READOUT TESTS: PASS" : `READOUT TESTS: FAIL (${failures})`);
  return failures === 0 ? 0 : 1;
}

main();
