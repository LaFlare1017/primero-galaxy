/**
 * Store-reset gate: the destructive tool, proven safe.
 *
 * Two claims the tool makes and this suite holds it to:
 *   1. A dry run changes NOTHING — for either store. The whole point of a
 *      dry run is that it is safe to run blind, so that is asserted against
 *      the filesystem rather than the console.
 *   2. Applying the workshop reset MOVES the rows rather than deleting them
 *      — every store file and a row-count manifest land in the archive before
 *      anything is wiped, which is the promise the alpha kit makes to the
 *      rubric rewrite.
 *
 * Both stores are exercised against scratch directories (the reset functions
 * take their directory as an argument for exactly this reason), so the suite
 * never touches delegate/data/ or the e2e store. Wired into `npm test`.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resetE2eStore, resetWorkshopStore } from "./reset-cohort";

let failures = 0;
function check(name: string, passed: boolean, detail: string): void {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!passed) failures += 1;
}

const STORE_FILES = ["sessions.json", "runs.json", "events.json", "scores.json"];

/** A store with a known shape: 2 sessions, 3 runs, 5 events, 1 score. */
function seedStore(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const rows: Record<string, unknown[]> = {
    "sessions.json": [{ id: "s1" }, { id: "s2" }],
    "runs.json": [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
    "events.json": [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }],
    "scores.json": [{ runId: "r1" }],
  };
  for (const [file, value] of Object.entries(rows)) {
    writeFileSync(join(dir, file), JSON.stringify(value));
  }
}

function fileCount(dir: string): number {
  return existsSync(dir) ? readdirSync(dir).length : 0;
}

function main(): number {
  const root = mkdtempSync(join(tmpdir(), "delegate-reset-test-"));

  try {
    // ── The suite's scratch store: a dry run shows the rows and touches none.
    const e2eDir = join(root, "e2e", "delegate-data");
    seedStore(e2eDir);
    resetE2eStore(e2eDir, { dryRun: true });
    check(
      "e2e dry run leaves the store untouched",
      fileCount(e2eDir) === STORE_FILES.length,
      `${fileCount(e2eDir)}/${STORE_FILES.length} files still present`,
    );

    // …and applying it wipes the store (EventLog recreates the dir on demand,
    // so gone-or-empty are both pristine).
    resetE2eStore(e2eDir, { dryRun: false });
    check(
      "e2e reset wipes the store",
      fileCount(e2eDir) === 0,
      fileCount(e2eDir) === 0 ? "no store files remain" : `${fileCount(e2eDir)} file(s) survived`,
    );

    // ── The workshop store: a dry run must not archive either.
    const workshopDir = join(root, "workshop", "data");
    const archiveRoot = join(root, "workshop", "archive");
    seedStore(workshopDir);
    resetWorkshopStore(workshopDir, { dryRun: true, archiveRoot });
    check(
      "workshop dry run leaves the store untouched",
      fileCount(workshopDir) === STORE_FILES.length,
      `${fileCount(workshopDir)}/${STORE_FILES.length} files still present`,
    );
    check(
      "workshop dry run writes no archive",
      !existsSync(archiveRoot),
      existsSync(archiveRoot) ? "an archive directory appeared" : "no archive directory created",
    );

    // …and applying it archives every row with a manifest, then wipes.
    const { archiveDir, fileCounts } = resetWorkshopStore(workshopDir, { dryRun: false, archiveRoot });
    check(
      "workshop reset reports the rows it archived",
      fileCounts["sessions.json"] === 2 &&
        fileCounts["runs.json"] === 3 &&
        fileCounts["events.json"] === 5 &&
        fileCounts["scores.json"] === 1,
      JSON.stringify(fileCounts),
    );
    const archived = archiveDir !== undefined && existsSync(archiveDir) ? readdirSync(archiveDir).sort() : [];
    check(
      "workshop archive holds every store file plus a manifest",
      archived.join(",") === [...STORE_FILES, "manifest.json"].sort().join(","),
      archived.join(", ") || "no archive directory",
    );
    check(
      "workshop reset wipes the store",
      fileCount(workshopDir) === 0,
      fileCount(workshopDir) === 0 ? "no store files remain" : `${fileCount(workshopDir)} file(s) survived`,
    );

    const manifest =
      archiveDir !== undefined && existsSync(join(archiveDir, "manifest.json"))
        ? (JSON.parse(readFileSync(join(archiveDir, "manifest.json"), "utf8")) as {
            totals: Record<string, number>;
          })
        : undefined;
    check(
      "the manifest records the archived totals",
      manifest !== undefined &&
        manifest.totals["sessions"] === 2 &&
        manifest.totals["runs"] === 3 &&
        manifest.totals["events"] === 5 &&
        manifest.totals["scores"] === 1,
      manifest === undefined ? "no manifest.json" : JSON.stringify(manifest.totals),
    );

    // ── A missing directory is a no-op, not an error: the tool is safe to
    // run before anything has ever been written (a fresh clone, or the second
    // reset in a row).
    resetE2eStore(join(root, "never-existed"), { dryRun: false });
    resetWorkshopStore(join(root, "never-existed"), { dryRun: false });
    check("a missing store resets as a no-op", true, "both stores handled an absent directory");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nSTORE RESET: PASS" : `\nSTORE RESET: FAIL (${failures})`);
  return failures === 0 ? 0 : 1;
}

process.exit(main());
