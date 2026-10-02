/**
 * Alpha readout CLI: generate the one-page cohort readout from the live
 * store (or an archived snapshot dir) without touching TypeScript imports.
 *
 * Usage:
 *   npm run alpha:readout -- <cohortId> [archiveDir]
 *
 *   <cohortId>   e.g. alpha-w6 (sessions.cohortId)
 *   [archiveDir] optional path to an archived snapshot (snapshots/alpha/<ts>/)
 *                — restores nothing, just reads; the live store is untouched
 *
 * Output: prints to stdout; writes docs/readout-<cohortId>.md unless --stdout.
 * Cohort-level only — the generator's inputs carry no participant labels
 * (handoff §8, enforced in the export path and tested by test-readout).
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { dataDir, resolveDelegateRoot } from "../paths";
import { generateReadout, loadReadoutInput } from "../report/readout";

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== "--stdout");
  const stdoutOnly = process.argv.includes("--stdout");
  const cohortId = args[0];
  if (!cohortId) {
    console.error("Usage: npm run alpha:readout -- <cohortId> [archiveDir] [--stdout]");
    process.exit(2);
  }
  const archiveDir = args[1] ? resolve(args[1]) : undefined;

  // Temporarily point dataDir's env override at the archive if given, by
  // reading files from there instead. loadReadoutInput reads the live
  // dataDir(); for archives we set the env var before calling it.
  if (archiveDir) {
    if (!existsSync(join(archiveDir, "manifest.json"))) {
      console.error(`Not an alpha archive (missing manifest.json): ${archiveDir}`);
      process.exit(2);
    }
    process.env.DELEGATE_DATA_DIR = archiveDir;
  }

  // Rubric version: read from the scores (they're stamped per row); fall
  // back to the checklists; final fallback "v0.2-alpha".
  const scoresPath = join(archiveDir ?? dataDir(), "scores.json");
  let rubricVersion = "";
  if (existsSync(scoresPath)) {
    try {
      const rows = JSON.parse(readFileSync(scoresPath, "utf8")) as Array<{ rubricVersion?: string }>;
      rubricVersion = rows.find((r) => r.rubricVersion)?.rubricVersion ?? "";
    } catch {
      /* fall through to checklist */
    }
  }
  if (!rubricVersion) {
    try {
      const checklist = JSON.parse(
        readFileSync(join(resolveDelegateRoot(), "scenarios", "01-bank-reconciliation", "checklist.json"), "utf8"),
      ) as { rubricVersion?: string };
      rubricVersion = checklist.rubricVersion ?? "v0.2-alpha";
    } catch {
      rubricVersion = "v0.2-alpha";
    }
  }

  const input = loadReadoutInput(cohortId, rubricVersion);
  if (input.runs.length === 0) {
    console.error(`No runs found for cohort "${cohortId}" in ${archiveDir ?? dataDir()}.`);
    console.error("Check the cohortId (sessions.cohortId) and that you have NOT reset since the last participant.");
    process.exit(1);
  }

  const md = generateReadout(input);
  if (stdoutOnly) {
    process.stdout.write(md + "\n");
    return;
  }
  const out = join(resolveDelegateRoot(), "docs", `readout-${cohortId}.md`);
  writeFileSync(out, md + "\n");
  console.log(`Readout written: ${out}`);
  console.log(`Cohort: ${cohortId} · ${input.runs.length} runs · rubric ${rubricVersion}`);
  console.log("(Cohort-level only — no individual attribution. The control-implication paragraph is yours to write.)");
}

main();
