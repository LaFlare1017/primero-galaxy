/**
 * Delegate store reset — the workshop room, and the scratch store the E2E
 * suite owns.
 *
 * Two stores, one tool, because the only difference between them is what
 * happens to the rows. The workshop's are raw material, so they are archived
 * before the wipe and never destroyed (handoff §9 Week 6 — "expect to rewrite
 * the rubric, budget the whole week for it"; every run, event and score feeds
 * that rewrite). The suite's are whatever the last run seeded — the store is
 * regenerated with the build, and the rows are test fixtures — so they are
 * wiped outright; a reset that grew an archive per e2e run would be a reset
 * nobody runs.
 *
 *   workshop   delegate/data/{sessions,runs,events,scores}.json
 *              → archive to snapshots/alpha/<ts>/ (files + row-count
 *                manifest), then wipe
 *   e2e        <repoRoot>/.next-e2e/delegate-data/  (DELEGATE_DATA_DIR)
 *              → wipe, no archive
 *
 * The stores are plain JSON files (v1 deviation — see delegate/README.md):
 * the facilitator view, the readout generator and every scorer read them
 * fresh per request, so a file-level wipe is a complete reset — no server
 * state holds cohort data. An in-memory ScenarioRuntime for an in-flight run
 * is per-process and keyed by runId, so a reset invalidates old runIds, which
 * is why the run-of-show requires a reset between participants, never during.
 * A running e2e server picks the empty store up on its next request.
 *
 * Usage (inside delegate/, after `npm run build`):
 *   npm run alpha:reset                          # dry run of the workshop store
 *   npm run alpha:reset -- --dry-run             # the same, spelled out
 *   npm run alpha:reset -- --yes                 # workshop: archive + wipe
 *   npm run alpha:reset -- --target e2e --yes    # the suite's scratch store
 *   npm run alpha:reset -- --target all --yes    # both
 *
 * From the repo root: `npm run reset:delegate -- --target all --dry-run`.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from "fs";
import { join, resolve } from "path";
import { dataDir, e2eDataDir, resolveDelegateRoot } from "../paths";

const STORE_FILES = ["sessions.json", "runs.json", "events.json", "scores.json"] as const;

/** The two stores this project keeps; `all` is shorthand for both. */
export type ResetTarget = "workshop" | "e2e" | "all";

interface ResetOptions {
  yes: boolean;
  dryRun: boolean;
  target: ResetTarget;
  archiveRoot?: string;
}

/** The last positional or `--target=<name>` value named, or an exit on nonsense. */
function parseTarget(argv: string[]): ResetTarget {
  let target: ResetTarget = "workshop";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value =
      arg === undefined
        ? undefined
        : arg.startsWith("--target=")
          ? arg.slice("--target=".length)
          : arg === "--target"
            ? argv[i + 1]
            : undefined;
    if (value === undefined) continue;
    if (value !== "workshop" && value !== "e2e" && value !== "all") {
      console.error(`[reset] Unknown --target "${value}" — expected workshop, e2e or all.`);
      process.exit(2);
    }
    target = value;
  }
  return target;
}

function parseArgs(argv: string[]): ResetOptions {
  return {
    yes: argv.includes("--yes"),
    dryRun: argv.includes("--dry-run"),
    target: parseTarget(argv),
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

/** Rows per store file in `dir` — what a dry run prints and a wipe reports. */
function storeRowCounts(dir: string): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!existsSync(dir)) return counts;
  for (const f of STORE_FILES) {
    const p = join(dir, f);
    if (existsSync(p)) counts[f] = countJsonArray(p);
  }
  return counts;
}

const totalRows = (counts: Record<string, number>): number =>
  Object.values(counts).reduce((sum, n) => sum + n, 0);

/** Remove every store file — EventLog recreates the directory on demand. */
function wipeJsonStore(dir: string): void {
  const known = new Set(STORE_FILES.map((f) => join(dir, f)));
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (known.has(p) || (statSync(p).isFile() && entry.endsWith(".json"))) rmSync(p);
  }
  if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
}

/**
 * The workshop room: archive, then wipe. `dir` is passed in rather than read
 * from paths.ts here, so a test can point it at a scratch directory and the
 * CLI stays the only caller that decides which store it means.
 */
export function resetWorkshopStore(
  dir: string,
  opts: { dryRun: boolean; archiveRoot?: string },
): { archiveDir?: string; fileCounts: Record<string, number> } {
  if (!existsSync(dir)) {
    console.log(`[reset] ${dir} does not exist — nothing to archive; the workshop store is already pristine.`);
    return { fileCounts: {} };
  }

  const fileCounts = storeRowCounts(dir);
  const rows = totalRows(fileCounts);
  if (rows === 0) {
    console.log("[reset] Workshop store is empty — nothing to archive.");
    return { fileCounts };
  }

  if (opts.dryRun) {
    console.log("[reset] DRY RUN — no changes made.");
    for (const [f, n] of Object.entries(fileCounts)) console.log(`  would archive ${f}: ${n} rows`);
    console.log("  then wipe the store (archived rows are never destroyed)");
    return { fileCounts };
  }

  // Archive: snapshots/alpha/<ISO timestamp>/ with a manifest.
  const archiveBase = opts.archiveRoot ?? join(resolveDelegateRoot(), "snapshots", "alpha");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = join(archiveBase, stamp);
  mkdirSync(archiveDir, { recursive: true });

  for (const f of STORE_FILES) {
    const src = join(dir, f);
    if (existsSync(src)) writeFileSync(join(archiveDir, f), readFileSync(src, "utf8"));
  }
  const manifest = {
    archivedAt: new Date().toISOString(),
    reason: "delegate store reset (workshop room)",
    files: fileCounts,
    totals: {
      sessions: fileCounts["sessions.json"] ?? 0,
      runs: fileCounts["runs.json"] ?? 0,
      events: fileCounts["events.json"] ?? 0,
      scores: fileCounts["scores.json"] ?? 0,
    },
  };
  writeFileSync(join(archiveDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[reset] Archived ${rows} rows → ${archiveDir}`);

  wipeJsonStore(dir);
  console.log("[reset] Workshop store is pristine. In-memory runtimes for old runIds are invalid — start fresh sessions.");

  return { archiveDir, fileCounts };
}

/**
 * The suite's scratch store: wipe, no archive. It is disposable by
 * construction — the store is regenerated with the build the suite runs
 * against, and it belongs to no participant — so there is nothing here worth
 * keeping and nothing a reset can lose.
 */
export function resetE2eStore(dir: string, opts: { dryRun: boolean }): { fileCounts: Record<string, number> } {
  if (!existsSync(dir)) {
    console.log(`[reset] ${dir} does not exist — nothing to wipe; the suite's store is already pristine.`);
    return { fileCounts: {} };
  }

  const fileCounts = storeRowCounts(dir);
  const rows = totalRows(fileCounts);

  if (opts.dryRun) {
    console.log("[reset] DRY RUN — no changes made.");
    console.log(`  would wipe ${dir} (${rows} rows; disposable — no archive)`);
    return { fileCounts };
  }

  wipeJsonStore(dir);
  console.log(`[reset] Wiped the suite's scratch store (${rows} rows) → ${dir}`);
  return { fileCounts };
}

/**
 * Resolve the target(s), then reset them. A dry run is what an unconfirmed
 * invocation gets: nothing is touched until `--yes`, and the plan is printed
 * either way so the command is safe to run blind.
 */
export function resetStores(opts: ResetOptions): void {
  const targets: Array<"workshop" | "e2e"> = opts.target === "all" ? ["workshop", "e2e"] : [opts.target];
  const dryRun = opts.dryRun || !opts.yes;

  // DELEGATE_DATA_DIR can point both targets at the same directory; wipe it
  // once rather than reporting it twice, and prefer the workshop's
  // archive-then-wipe when that happens.
  const seen = new Set<string>();
  for (const target of targets) {
    const dir = resolve(target === "workshop" ? dataDir() : e2eDataDir());
    if (seen.has(dir)) continue;
    seen.add(dir);
    if (target === "workshop") resetWorkshopStore(dir, { dryRun, archiveRoot: opts.archiveRoot });
    else resetE2eStore(dir, { dryRun });
  }

  if (!opts.yes && !opts.dryRun) {
    console.error("[reset] Refusing to wipe without --yes. Re-run with --yes to apply, or --dry-run to just inspect.");
    process.exit(2);
  }
}

if (require.main === module) {
  resetStores(parseArgs(process.argv.slice(2)));
}
