/**
 * Cohort reset (Week-6 alpha): archive delegate/data/ and restore the store
 * to a pristine state so each alpha participant's data is separate.
 *
 * Why an archive, not a delete: alpha data is the raw material for the
 * rubric rewrite (handoff §9 Week 6 — "expect to rewrite the rubric,
 * budget the whole week for it"). Every run, event, and score feeds that
 * rewrite; nothing alpha-related is ever destroyed.
 *
 * The stores are plain JSON files (v1 deviation — see delegate/README.md):
 *   delegate/data/{sessions,runs,events,scores}.json
 * The facilitator view, readout generator, and all scorers read them fresh
 * per request, so wiping the files is a complete reset — no server state
 * holds cohort data. An in-memory ScenarioRuntime for an in-flight run is
 * per-process and keyed by runId; a reset invalidates old runIds, which is
 * why the run-of-show requires a reset between participants, never during.
 *
 * Usage:
 *   npm run alpha:reset            # interactive (asks for confirmation)
 *   npm run alpha:reset -- --yes   # non-interactive (scripts, dry-run checks)
 *   npm run alpha:reset -- --dry-run
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from "fs";
import { join } from "path";
import { dataDir, resolveDelegateRoot } from "../paths";

const STORE_FILES = ["sessions.json", "runs.json", "events.json", "scores.json"] as const;

interface ResetOptions {
  yes: boolean;
  dryRun: boolean;
  archiveRoot?: string;
}

function parseArgs(argv: string[]): ResetOptions {
  return {
    yes: argv.includes("--yes"),
    dryRun: argv.includes("--dry-run"),
    archiveRoot: process.env.DELEGATE_ARCHIVE_DIR,
  };
}

function countJsonArray(p: string): number {
  try {
    const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export function resetCohort(opts: ResetOptions): { archiveDir?: string; fileCounts: Record<string, number> } {
  const data = dataDir();
  const fileCounts: Record<string, number> = {};

  if (!existsSync(data)) {
    console.log(`[reset] ${data} does not exist — nothing to archive; store is already pristine.`);
    return { fileCounts };
  }

  for (const f of STORE_FILES) {
    const p = join(data, f);
    if (existsSync(p)) fileCounts[f] = countJsonArray(p);
  }

  const totalRows = Object.values(fileCounts).reduce((s, n) => s + n, 0);
  if (totalRows === 0) {
    console.log("[reset] Store is empty — nothing to archive.");
    return { fileCounts };
  }

  if (opts.dryRun) {
    console.log("[reset] DRY RUN — no changes made.");
    for (const [f, n] of Object.entries(fileCounts)) console.log(`  would archive ${f}: ${n} rows`);
    return { fileCounts };
  }

  if (!opts.yes) {
    console.error("[reset] Refusing to run interactively without --yes (npm run alpha:reset -- --yes).");
    process.exit(2);
  }

  // Archive: snapshots/alpha/<ISO timestamp>/ with a manifest.
  const archiveBase = opts.archiveRoot ?? join(resolveDelegateRoot(), "snapshots", "alpha");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = join(archiveBase, stamp);
  mkdirSync(archiveDir, { recursive: true });

  for (const f of STORE_FILES) {
    const src = join(data, f);
    if (existsSync(src)) writeFileSync(join(archiveDir, f), readFileSync(src, "utf8"));
  }
  const manifest = {
    archivedAt: new Date().toISOString(),
    reason: "week-6 alpha cohort reset",
    files: fileCounts,
    totals: {
      sessions: fileCounts["sessions.json"] ?? 0,
      runs: fileCounts["runs.json"] ?? 0,
      events: fileCounts["events.json"] ?? 0,
      scores: fileCounts["scores.json"] ?? 0,
    },
  };
  writeFileSync(join(archiveDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[reset] Archived ${totalRows} rows → ${archiveDir}`);

  // Wipe the store (remove the whole dir — EventLog recreates it on demand).
  const known = new Set(STORE_FILES.map((f) => join(data, f)));
  for (const entry of readdirSync(data)) {
    const p = join(data, entry);
    if (known.has(p) || (statSync(p).isFile() && entry.endsWith(".json"))) rmSync(p);
  }
  if (readdirSync(data).length === 0) rmSync(data, { recursive: true });
  console.log("[reset] Store is pristine. In-memory runtimes for old runIds are invalid — start fresh sessions.");

  return { archiveDir, fileCounts };
}

if (require.main === module) {
  resetCohort(parseArgs(process.argv.slice(2)));
}
