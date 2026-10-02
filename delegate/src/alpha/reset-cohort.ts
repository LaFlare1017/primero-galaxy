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
 * Both run through the store seam (`../store/`), so a deployment is reset by
 * the same command: with `DELEGATE_STORE=postgres` the rows come from and go
 * back to the database instead of a directory, and the archive is the same four
 * JSON files either way. That last part is the load-bearing decision — the
 * archive is already an interchange format (`alpha:readout <cohortId> <dir>`
 * reads one by pointing the file store at it), so a database's rows become a
 * directory the existing tools can read with no code that knows where they came
 * from, and no code that has to be taught a second reader. What the rows lose
 * in the trip is the order Postgres happened to return them in, which
 * `test-store-backends.ts` pins as identical anyway.
 *
 * The archive is a LOCAL directory, whichever store the rows came from: the
 * snapshot belongs on the machine that will read it, and a reset run from a
 * laptop is how a deployed workshop room is reset between participants. The
 * one thing that is not automatic is knowing WHICH database — so a dry run
 * names it (host and database, never the password) before anything is deleted,
 * and the wipe is one call (`clearAll`) so a room is either intact or empty
 * rather than half of each.
 *
 * An archive that is only ever added to is how a disk fills, and this tool is
 * run between participants precisely because it is easy to run. So retention
 * is part of the reset rather than a chore beside it: every archive keeps a
 * cap on its snapshots (ten by default, `--keep N` to say otherwise), the
 * oldest go first, and a dry run says which and how many bytes BEFORE anything
 * is removed. Two things it will not do: prune a snapshot the reset just
 * wrote, whatever the clock says, and remove one it cannot remove — a
 * snapshot that will not delete is untidy, where an exception there would
 * report a reset that worked as one that failed. The rows a reset protects
 * are the ones nobody has archived yet, so they are the last to go.
 *
 * Order of operations is the whole safety argument, so it is stated as an
 * invariant rather than left to the shape of the code: read, count, write the
 * archive, RE-READ what was written and refuse if it is short, and only then
 * clear. An archive that cannot be written is a refusal, not a partial reset.
 *
 * Usage (inside delegate/, after `npm run build`):
 *   npm run alpha:reset                          # dry run of the workshop store
 *   npm run alpha:reset -- --dry-run             # the same, spelled out
 *   npm run alpha:reset -- --yes                 # workshop: archive + wipe
 *   npm run alpha:reset -- --target e2e --yes    # the suite's scratch store
 *   npm run alpha:reset -- --target all --yes    # both
 *   npm run alpha:reset -- --keep 3 --yes        # keep only the 3 newest snapshots
 *
 * With DELEGATE_STORE=postgres, `--target workshop` is the database and
 * `--target e2e` is the same database (a database is not two rooms), so `--yes`
 * on either wipes the rows both names reach and the plan says so before it
 * does. DELEGATE_ARCHIVE_DIR moves the archive; DELEGATE_DATA_DIR moves the
 * FILE targets.
 *
 * From the repo root: `npm run reset:delegate -- --target all --dry-run`.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  statSync,
  type Dirent,
} from "fs";
import { join, resolve } from "path";
import { dataDir, e2eDataDir, resolveDelegateRoot } from "../paths";
import { openStore, openStoreAt, TABLES, type Row, type Store, type TableName } from "../store/store";

/** The two stores this project keeps; `all` is shorthand for both. */
export type ResetTarget = "workshop" | "e2e" | "all";

interface ResetOptions {
  yes: boolean;
  dryRun: boolean;
  target: ResetTarget;
  archiveRoot?: string;
  /** Snapshots to keep per archive. Absent takes DEFAULT_ARCHIVE_KEEP. */
  keep?: number;
}

/** What one target resolved to, and how to describe it to whoever is reading. */
interface Resolved {
  target: "workshop" | "e2e";
  store: Store;
  /** Printed in the plan: a path for files, a redacted URL for a database. */
  where: string;
  /** Two targets naming the same store are reset once, not twice. Exported so the gate can read the key. */
  identity: string;
}

/** A resolved target, as `resolveTarget` returns it. Exported for the gate. */
export type ResolvedTarget = Resolved;

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

/**
 * The `--keep <n>` value, or undefined to take the default. Only the SHAPE is
 * read here; whether n is a cap anybody should run with is `retentionCap`'s
 * call, so the refusal happens where the reset is and not in a parser that a
 * test cannot reach.
 */
function parseKeep(argv: string[]): number | undefined {
  let keep: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value =
      arg?.startsWith("--keep=") === true
        ? arg.slice("--keep=".length)
        : arg === "--keep"
          ? argv[i + 1]
          : undefined;
    if (value === undefined) continue;
    keep = Number(value);
  }
  return keep;
}

function parseArgs(argv: string[]): ResetOptions {
  return {
    yes: argv.includes("--yes"),
    dryRun: argv.includes("--dry-run"),
    target: parseTarget(argv),
    archiveRoot: process.env.DELEGATE_ARCHIVE_DIR,
    keep: parseKeep(argv),
  };
}

/**
 * Which database a URL points at, without the password — a plan that names the
 * wrong database is worse than one that names nothing, and a plan that prints
 * the connection string puts a credential in a terminal scrollback and in
 * whatever CI log captured it.
 */
export function describeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, "");
    return `${parsed.hostname}${database ? `/${database}` : ""}`;
  } catch {
    return "a DATABASE_URL this build cannot parse";
  }
}

/** Which store a target means, following `DELEGATE_STORE` for the workshop room. */
export async function resolveTarget(target: "workshop" | "e2e"): Promise<Resolved | null> {
  const asked = (process.env.DELEGATE_STORE ?? "").trim().toLowerCase();
  if (target === "workshop" && asked === "postgres") {
    // openStore() carries the refusal for a missing DATABASE_URL, so this is
    // where "DELEGATE_STORE=postgres and no DATABASE_URL" is said, in the same
    // words the app would say, and before any output claims a store exists.
    const store = await openStore();
    const where = `postgres ${describeUrl(process.env.DATABASE_URL ?? "")}`;
    return { target, store, where, identity: `postgres:${where}` };
  }
  if (asked !== "" && asked !== "file" && target === "e2e") {
    // The suite's scratch store is a directory, and a Postgres deployment does
    // not have one. Saying so beats wiping the workshop's database because
    // somebody asked for the suite's store.
    console.log(
      `[reset] --target e2e is a directory (${e2eDataDir()}) and DELEGATE_STORE=${asked} keeps the rows elsewhere; ` +
        "the e2e target is a no-op. A database is not a scratch directory — if the suite is pointed at one, " +
        "--target workshop is the reset that reaches it.",
    );
    return null;
  }
  const dir = resolve(target === "workshop" ? dataDir() : e2eDataDir());
  return { target, store: await openStoreAt(dir), where: dir, identity: `file:${dir}` };
}

/** Every row, in the order both backends promise, keyed by table. */
async function readAll(store: Store): Promise<Record<TableName, Row[]>> {
  const rows = {} as Record<TableName, Row[]>;
  for (const table of TABLES) rows[table] = await store.read(table);
  return rows;
}

const totalRows = (rows: Record<TableName, Row[]>): number =>
  TABLES.reduce((sum, table) => sum + rows[table].length, 0);

// ── Archive retention ───────────────────────────────────────────────────────
/**
 * How many snapshots one archive keeps when nobody says otherwise. Ten is a
 * workshop's worth of resets — a day of cohort work and room to redo one — and
 * the number is a default rather than a policy because the alternative is a
 * cap nobody set: the archive grows by a room per reset, and the disk says so
 * at the worst possible moment.
 */
export const DEFAULT_ARCHIVE_KEEP = 10;

/** One snapshot directory, as retention sees it. */
export interface Snapshot {
  /** The directory name, which is the stamp the reset that wrote it chose. */
  name: string;
  dir: string;
  /** Bytes under it — retention exists to bound a disk, so the plan says how big. */
  bytes: number;
  mtimeMs: number;
}

/** Bytes under a directory, best effort: a size is a courtesy in a plan. */
function dirBytes(dir: string): number {
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      total += dirBytes(join(dir, entry.name));
    } else if (entry.isFile()) {
      // A symlink is not followed. Retention counts what the archive holds;
      // a link into somewhere else is somebody's arrangement, and deleting the
      // archive's copy of it should never reach through to the target.
      try {
        total += statSync(join(dir, entry.name)).size;
      } catch {
        /* unreadable or already gone — it weighs nothing this can see */
      }
    }
  }
  return total;
}

/**
 * Every snapshot in an archive root, oldest first.
 *
 * Directories only: a stray FILE in the archive root is somebody's note, not a
 * snapshot, and retention is not where the tool should discover it was there.
 * A root that is missing, or is a file rather than a directory (the planted
 * case), is an archive with nothing in it — which the reset itself will
 * refuse later, and a plan has no business refusing first.
 *
 * Ordered by mtime and then by name: a snapshot's name is a stamp, and two
 * resets can land in the same millisecond, so the name breaks that tie and
 * "oldest first" is a total order rather than a hope. A directory that cannot
 * be stat'ed sorts LAST — we could not prove it was old, and retention does
 * not delete what it cannot read.
 */
export function listSnapshots(archiveRoot: string): Snapshot[] {
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(archiveRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const snapshots: Snapshot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(archiveRoot, entry.name);
    let mtimeMs = Number.POSITIVE_INFINITY;
    try {
      mtimeMs = statSync(dir).mtimeMs;
    } catch {
      /* keeps the sort-last default */
    }
    snapshots.push({ name: entry.name, dir, bytes: dirBytes(dir), mtimeMs });
  }
  return snapshots.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
}

/**
 * The cap a reset will hold an archive to, or a refusal.
 *
 * Zero is refused rather than honoured, and the reason is the tool's own
 * promise: this reset archives so that nothing is destroyed, so "keep no
 * snapshot" is a wipe wearing the archive's name. `--target e2e` is the wipe.
 */
export function retentionCap(keep?: number): number {
  if (keep === undefined) return DEFAULT_ARCHIVE_KEEP;
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(
      `--keep takes a whole number of snapshots to keep, at least 1; got ${String(keep)}. ` +
        "A reset that keeps no snapshot is a wipe, and the workshop's rows are never destroyed by this tool " +
        "— --target e2e is the wipe.",
    );
  }
  return keep;
}

/** What one retention pass would do, so a dry run and a reset say the same thing. */
export interface RetentionPlan {
  /** Snapshots the archive holds right now, the fresh one included. */
  held: number;
  /** What they weigh together. */
  bytes: number;
  /** The cap in force. */
  keep: number;
  /** Oldest first: exactly what the pass removes. */
  prune: Snapshot[];
  bytesFreed: number;
}

/**
 * Plan the pass without doing it, which is what makes a dry run able to NAME
 * the snapshots it would remove rather than merely say it would remove some.
 *
 * The cap counts everything the archive will hold once the reset lands, so
 * `--keep 3` leaves three — not three plus the one being written, and not two.
 * That is what `pending` (a snapshot about to be written) and `protect` (one
 * just written) are for, and `protect` also states the one rule the mtimes
 * cannot: the snapshot this reset just saved is never a candidate, however the
 * clock, a restored backup, or a copied archive has dated the others.
 */
export function planRetention(
  archiveRoot: string,
  keep: number,
  opts: { protect?: string; pending?: number } = {},
): RetentionPlan {
  const pending = opts.pending ?? 0;
  const all = listSnapshots(archiveRoot);
  const candidates = all.filter((snapshot) => snapshot.name !== opts.protect);
  const room = Math.max(0, keep - pending - (opts.protect === undefined ? 0 : 1));
  const survivors = new Set<string>();
  if (opts.protect !== undefined) survivors.add(opts.protect);
  for (const snapshot of candidates.slice(Math.max(0, candidates.length - room))) {
    survivors.add(snapshot.name);
  }
  const prune = candidates.filter((snapshot) => !survivors.has(snapshot.name));
  return {
    held: all.length,
    bytes: all.reduce((sum, snapshot) => sum + snapshot.bytes, 0),
    keep,
    prune,
    bytesFreed: prune.reduce((sum, snapshot) => sum + snapshot.bytes, 0),
  };
}

/**
 * Remove what the plan says to, and report what it could not.
 *
 * Failures are collected rather than thrown, because by the time this runs the
 * rows are archived and the store is empty: a snapshot that will not delete is
 * untidy, while an exception here would report a reset that worked as a reset
 * that failed — and the natural response to that message is to run it again.
 */
export function removeSnapshots(plan: RetentionPlan): {
  removed: string[];
  failed: Array<{ name: string; reason: string }>;
} {
  const removed: string[] = [];
  const failed: Array<{ name: string; reason: string }> = [];
  for (const snapshot of plan.prune) {
    try {
      rmSync(snapshot.dir, { recursive: true, force: true });
      removed.push(snapshot.name);
    } catch (error) {
      failed.push({ name: snapshot.name, reason: (error as Error).message });
    }
  }
  return { removed, failed };
}

/** What one retention pass did, for the caller that has to trust it. */
export interface RetentionReport {
  keep: number;
  held: number;
  removed: string[];
  bytesFreed: number;
  failed: Array<{ name: string; reason: string }>;
}

const humanBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : bytes >= 1024
      ? `${Math.round(bytes / 1024)} kB`
      : `${bytes} B`;

/**
 * One line, spoken the same way whether it is a plan or a fact — so the dry
 * run a facilitator reads is the reset they are being asked to confirm.
 */
function retentionLine(plan: RetentionPlan, mood: "would" | "did"): string {
  const after = plan.held + (mood === "would" ? 1 : 0);
  if (plan.prune.length === 0) {
    return (
      `retention: ${after} snapshot(s) once this lands, at or under the cap of ${plan.keep} — ` +
      `nothing to remove (${humanBytes(plan.bytes)} on disk)`
    );
  }
  const names = plan.prune.map((snapshot) => snapshot.name).join(", ");
  return mood === "would"
    ? `retention: keeping the ${plan.keep} most recent, ${plan.prune.length} would go ` +
        `(frees ${humanBytes(plan.bytesFreed)} of ${humanBytes(plan.bytes)}) — ${names}`
    : `retention: removed ${plan.prune.length} snapshot(s), freed ${humanBytes(plan.bytesFreed)} of ` +
        `${humanBytes(plan.bytes)} — ${names}`;
}

/**
 * Write the archive, then prove it. A file written and not re-read is a file
 * whose contents are a hope, and the next statement deletes the only other
 * copy — so every archive is parsed back and counted, and a short one aborts
 * the reset with the rows still in place.
 */
function writeArchive(archiveDir: string, rows: Record<TableName, Row[]>, reason: string): number {
  const counts: Record<string, number> = {};
  mkdirSync(archiveDir, { recursive: true });
  for (const table of TABLES) {
    const file = join(archiveDir, `${table}.json`);
    writeFileSync(file, JSON.stringify(rows[table], null, 2));
    // Re-read from disk, not from the array just serialised: the thing that has
    // to survive is the file, and a full disk or a bad path fails here rather
    // than at the next participant's debrief.
    const back = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(back) || back.length !== rows[table].length) {
      throw new Error(
        `archive is short: ${table}.json holds ${Array.isArray(back) ? back.length : "no"} rows, expected ` +
          `${rows[table].length}. Nothing was deleted — the store still holds every row.`,
      );
    }
    counts[`${table}.json`] = rows[table].length;
  }
  const manifest = {
    archivedAt: new Date().toISOString(),
    reason,
    files: counts,
    totals: Object.fromEntries(TABLES.map((table) => [table, rows[table].length])),
  };
  writeFileSync(join(archiveDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return totalRows(rows);
}

/**
 * The one reset. `dryRun` prints the plan and returns having changed nothing;
 * otherwise the workshop target archives first and the e2e target does not,
 * and the difference is the only thing between them.
 *
 * `store` is a parameter for the same reason the directory used to be: the
 * tests point it at scratch directories and at an in-process Postgres, so a
 * claim about a destructive tool is proved against a throwaway store rather
 * than asserted.
 */
export async function resetStore(
  store: Store,
  opts: {
    dryRun: boolean;
    target: "workshop" | "e2e";
    archiveRoot?: string;
    where?: string;
    stamp?: string;
    keep?: number;
  },
): Promise<{ archiveDir?: string; rowCounts: Record<TableName, number>; retention?: RetentionReport }> {
  // Before anything is read, let alone written: a reset that cannot say how
  // many snapshots its archive keeps is a reset that must not start, and the
  // refusal costs a keystroke rather than a room.
  const cap = retentionCap(opts.keep);
  const rows = await readAll(store);
  const rowCounts = Object.fromEntries(TABLES.map((table) => [table, rows[table].length])) as Record<
    TableName,
    number
  >;
  const total = totalRows(rows);
  const where = opts.where ?? store.kind;
  const archives = opts.target === "workshop";

  if (total === 0) {
    console.log(`[reset] ${where} holds 0 rows — nothing to ${archives ? "archive" : "wipe"}; already pristine.`);
    return { rowCounts };
  }

  if (opts.dryRun) {
    console.log(`[reset] DRY RUN — no changes made. Store: ${where} (${store.kind})`);
    for (const table of TABLES) console.log(`  ${table}: ${rowCounts[table]} rows`);
    if (archives) {
      const archiveBase = opts.archiveRoot ?? join(resolveDelegateRoot(), "snapshots", "alpha");
      console.log(`  would archive to ${join(archiveBase, "<timestamp>")} and then wipe (archived rows are never destroyed)`);
      // Planned against the snapshot that is ABOUT to be written, so this line
      // is what --yes will do rather than a near miss of it: a cap of three
      // with four snapshots already there prunes two, not one.
      console.log(`  ${retentionLine(planRetention(archiveBase, cap, { pending: 1 }), "would")}`);
    } else {
      console.log(`  would wipe ${total} rows (disposable — no archive, and so nothing to retain)`);
    }
    return { rowCounts };
  }

  if (archives) {
    const archiveBase = opts.archiveRoot ?? join(resolveDelegateRoot(), "snapshots", "alpha");
    // The timestamp names the directory, so it is a parameter rather than an
    // inline `new Date()`: a test has to be able to address the archive a reset
    // made in order to plant a failure inside it, and nobody can predict the
    // clock. The CLI never passes it.
    const stamp = opts.stamp ?? new Date().toISOString().replace(/[:.]/g, "-");
    const archiveDir = join(archiveBase, stamp);
    // Throws — loudly, with the rows still in the store — if the archive cannot
    // be written whole. A reset that destroys rows it failed to save is the one
    // outcome this tool exists to prevent, so the archive is the FIRST thing
    // that touches the disk and the clear is the last.
    let archived = 0;
    try {
      archived = writeArchive(archiveDir, rows, `delegate store reset (${opts.target} room, ${store.kind})`);
    } catch (error) {
      // Remove the partial directory. What is left behind would be named like
      // an archive and hold two real files and a missing one, and the next
      // person to point `alpha:readout` at it gets a readout of whatever
      // survived. A refusal that leaves nothing to misread is worth more than
      // the evidence of having tried.
      //
      // Best effort, and the reason is not tidiness: a directory that could not
      // be created is often a directory that cannot be removed either (the
      // planted case is a FILE where the archive root should be, and both
      // mkdir and rm answer ENOTDIR). Letting that second failure escape would
      // replace "the store is intact" with a bare fs error about a path, which
      // is the one message a caller cannot act on.
      try {
        rmSync(archiveDir, { recursive: true, force: true });
      } catch {
        /* nothing was written under archiveDir, or nothing can remove it */
      }
      throw new Error(
        `could not archive to ${archiveDir}: ${(error as Error).message} ` +
          "Nothing was deleted — the store still holds every row, and no archive was left behind.",
      );
    }
    console.log(`[reset] Archived ${archived} rows → ${archiveDir}`);
    await store.clearAll();
    console.log(
      `[reset] Workshop store is pristine (${total} rows, from ${where}). ` +
        "In-memory runtimes for old runIds are invalid — start fresh sessions.",
    );
    // Retention LAST, and never able to fail the reset: the rows are archived
    // and the store is empty by now, so the only thing left to protect is the
    // disk the next reset will need. A failure here is a warning about
    // housekeeping, not about the room, and saying so is the difference
    // between a tidy archive and somebody re-running a reset that worked.
    let retention: RetentionReport | undefined;
    try {
      const plan = planRetention(archiveBase, cap, { protect: stamp });
      const { removed, failed } = removeSnapshots(plan);
      for (const f of failed) {
        console.warn(
          `[reset] WARNING could not remove snapshot ${f.name}: ${f.reason} — the reset itself is done; ` +
            "remove it by hand.",
        );
      }
      console.log(`[reset] ${retentionLine(plan, "did")}`);
      retention = { keep: cap, held: plan.held, removed, bytesFreed: plan.bytesFreed, failed };
    } catch (error) {
      console.warn(
        `[reset] WARNING archive retention did not run: ${(error as Error).message} — the reset is done ` +
          "and the archive is untouched.",
      );
    }
    return { archiveDir, rowCounts, retention };
  }

  await store.clearAll();
  console.log(`[reset] Wiped the scratch store (${total} rows) → ${where}`);
  return { rowCounts };
}

/** The file-store shape the tests and any other caller used before the seam. */
export async function resetWorkshopStore(
  dir: string,
  opts: { dryRun: boolean; archiveRoot?: string; keep?: number },
): Promise<{ archiveDir?: string; fileCounts: Record<string, number>; retention?: RetentionReport }> {
  const { archiveDir, rowCounts, retention } = await resetStore(await openStoreAt(dir), {
    dryRun: opts.dryRun,
    target: "workshop",
    archiveRoot: opts.archiveRoot,
    where: dir,
    keep: opts.keep,
  });
  return {
    archiveDir,
    fileCounts: Object.fromEntries(TABLES.map((t) => [`${t}.json`, rowCounts[t]])),
    retention,
  };
}

export async function resetE2eStore(
  dir: string,
  opts: { dryRun: boolean },
): Promise<{ fileCounts: Record<string, number> }> {
  const { rowCounts } = await resetStore(await openStoreAt(dir), { dryRun: opts.dryRun, target: "e2e", where: dir });
  return { fileCounts: Object.fromEntries(TABLES.map((t) => [`${t}.json`, rowCounts[t]])) };
}

/**
 * Resolve the target(s), then reset them. A dry run is what an unconfirmed
 * invocation gets: nothing is touched until `--yes`, and the plan is printed
 * either way so the command is safe to run blind.
 */
export async function resetStores(opts: ResetOptions): Promise<void> {
  const targets: Array<"workshop" | "e2e"> = opts.target === "all" ? ["workshop", "e2e"] : [opts.target];
  const dryRun = opts.dryRun || !opts.yes;

  // A store addressed twice is reset once: DELEGATE_DATA_DIR can point both
  // file targets at one directory, and a database is by definition the same
  // store under either name — wiping it twice would print two plans and, worse,
  // let a second reset archive an empty room over the first reset's archive.
  const seen = new Set<string>();
  const plan: string[] = [];
  for (const target of targets) {
    const resolved = await resolveTarget(target);
    if (resolved === null) continue;
    if (seen.has(resolved.identity)) {
      plan.push(`  ${target}: the same store as the target above (${resolved.where}) — reset once`);
      continue;
    }
    seen.add(resolved.identity);
    await resetStore(resolved.store, {
      dryRun,
      target,
      archiveRoot: opts.archiveRoot,
      where: resolved.where,
      keep: opts.keep,
    });
  }

  if (!opts.yes && !opts.dryRun) {
    console.error("[reset] Refusing to wipe without --yes. Re-run with --yes to apply, or --dry-run to just inspect.");
    process.exit(2);
  }
  if (plan.length > 0) for (const line of plan) console.log(line);
}

if (require.main === module) {
  resetStores(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error(`[reset] ${(error as Error).message}`);
    process.exit(1);
  });
}
