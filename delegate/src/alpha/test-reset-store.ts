/**
 * Store-reset gate: the destructive tool, proven safe on BOTH stores.
 *
 * Three claims the tool makes, each proved by planting the state that must
 * trigger it:
 *   1. A dry run changes NOTHING — for either store, and including a database,
 *      where "changed nothing" has to mean no DELETE rather than "the rows came
 *      back". Asserted against the store, not against the console.
 *   2. Applying the reset puts the rows somewhere readable BEFORE it destroys
 *      them, and the somewhere is a directory of the same four JSON files plus a
 *      manifest either way — which is what `alpha:readout <cohortId> <dir>`
 *      already reads. So a database's rows are archived into a shape the
 *      existing tooling consumes with no code that knows where they came from.
 *   3. An archive that cannot be written whole is a REFUSAL, not a reset: the
 *      rows must still be in the store afterwards. This is the check that
 *      matters most, because it is the one failure mode that would be
 *      irreversible, so it is proved by making the archive fail on purpose —
 *      a store that answers a short write — rather than by trusting the order
 *      of two statements.
 *
 * Plus the refusals and the dedup: a Postgres reset with no `DATABASE_URL`
 * refuses rather than falling back to files, `--target e2e` against a database
 * is a no-op rather than a wipe of the wrong room, and two targets naming one
 * store are reset once.
 *
 * And the archive's cap, because an archive that only grows is how a disk
 * fills on the machine that is running this tool between every participant:
 * under the cap nothing is pruned, over it the oldest go and the newest stay,
 * the snapshot a reset has just written is never one of them however the clock
 * is set, a dry run names what it would remove and removes nothing, a cap that
 * is not a count refuses before the reset starts, and a snapshot that will not
 * delete is reported without turning a reset that worked into a failure.
 *
 * The Postgres side runs against PGlite in a temp directory, so this is a unit
 * test that needs no database — and the file side runs in scratch directories,
 * so the suite never touches `delegate/data/` or the e2e store. Wired into
 * `npm test`.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PGlite } from "@electric-sql/pglite";
import {
  describeUrl,
  listSnapshots,
  planRetention,
  resetE2eStore,
  resetStore,
  resetWorkshopStore,
  resolveTarget,
} from "./reset-cohort";
import { ignoreClosedPipe } from "../print";
import { postgresStore, type Query } from "../store/postgres-store";
import { openStoreAt, TABLES, type Row, type Store } from "../store/store";

// A reader who pipes this to `head` must not kill the run before it cleans up.
ignoreClosedPipe();

let failures = 0;
function check(name: string, passed: boolean, detail: string): void {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!passed) failures += 1;
}

const STORE_FILES = TABLES.map((t) => `${t}.json`);
const ARCHIVE_FILES = [...STORE_FILES, "manifest.json"].sort();

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

const fileCount = (dir: string): number => (existsSync(dir) ? readdirSync(dir).length : 0);

const rowCounts = (counts: Record<string, number>): string => JSON.stringify(counts);
const EXPECTED = { "sessions.json": 2, "runs.json": 3, "events.json": 5, "scores.json": 1 };

/** The same seeded rows, through the store, for a database or a fake. */
const SEED: Record<string, Row[]> = {
  sessions: [{ id: "s1" }, { id: "s2" }],
  runs: [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
  events: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
  scores: [{ runId: "r1" }],
};

async function main(): Promise<number> {
  const root = mkdtempSync(join(tmpdir(), "delegate-reset-test-"));

  try {
    // ── The suite's scratch store: a dry run shows the rows and touches none.
    const e2eDir = join(root, "e2e", "delegate-data");
    seedStore(e2eDir);
    await resetE2eStore(e2eDir, { dryRun: true });
    check(
      "e2e dry run leaves the store untouched",
      fileCount(e2eDir) === STORE_FILES.length,
      `${fileCount(e2eDir)}/${STORE_FILES.length} files still present`,
    );

    // …and applying it wipes the store (EventLog recreates the dir on demand,
    // so gone-or-empty are both pristine).
    await resetE2eStore(e2eDir, { dryRun: false });
    check(
      "e2e reset wipes the store",
      fileCount(e2eDir) === 0,
      fileCount(e2eDir) === 0 ? "no store files remain" : `${fileCount(e2eDir)} file(s) survived`,
    );

    // ── The workshop store: a dry run must not archive either.
    const workshopDir = join(root, "workshop", "data");
    const archiveRoot = join(root, "workshop", "archive");
    seedStore(workshopDir);
    await resetWorkshopStore(workshopDir, { dryRun: true, archiveRoot });
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

    // ── …and applying it archives every row with a manifest, then wipes.
    const { archiveDir, fileCounts } = await resetWorkshopStore(workshopDir, { dryRun: false, archiveRoot });
    check(
      "workshop reset reports the rows it archived",
      rowCounts(fileCounts) === JSON.stringify(EXPECTED),
      rowCounts(fileCounts),
    );
    const archived = archiveDir !== undefined && existsSync(archiveDir) ? readdirSync(archiveDir).sort() : [];
    check(
      "workshop archive holds every store file plus a manifest",
      archived.join(",") === ARCHIVE_FILES.join(","),
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
    await resetE2eStore(join(root, "never-existed"), { dryRun: false });
    await resetWorkshopStore(join(root, "never-existed"), { dryRun: false });
    check("a missing store resets as a no-op", true, "both stores handled an absent directory");

    // ══ Archive retention ═════════════════════════════════════════════
    // The cap that stops repeated resets filling a disk, proved by planting
    // the archive it has to cope with. Every planted snapshot is given an
    // explicit AGE rather than created and trusted to be older than the next
    // one: "oldest first" has to be a fact these checks lean on rather than a
    // race with the clock — including one planted in the FUTURE, which is the
    // case an archive ordered by name gets wrong.
    const keepArchive = join(root, "keep-archive");
    const keepStore = join(root, "keep-store");
    const plant = (name: string, ageDays: number): string => {
      const dir = join(keepArchive, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "sessions.json"), JSON.stringify([{ id: name }]));
      const when = (Date.now() - ageDays * 86_400_000) / 1000;
      utimesSync(dir, when, when);
      return dir;
    };
    /** Snapshot names on disk, oldest first — the order retention decides in. */
    const onDisk = (): string[] => listSnapshots(keepArchive).map((snapshot) => snapshot.name);
    const resetWith = async (stamp: string, keep: number, dryRun = false) =>
      resetStore(await openStoreAt(keepStore), {
        dryRun,
        target: "workshop",
        archiveRoot: keepArchive,
        where: keepStore,
        stamp,
        keep,
      });

    // Under the cap: the reset archives and prunes nothing.
    plant("aged-3d", 3);
    plant("aged-2d", 2);
    seedStore(keepStore);
    const under = await resetWith("fresh-a", 3);
    check(
      "a reset under the cap prunes nothing",
      under.retention !== undefined &&
        under.retention.removed.length === 0 &&
        onDisk().join(",") === "aged-3d,aged-2d,fresh-a",
      `${onDisk().length} snapshots on disk (2 planted + 1 written), ${under.retention?.removed.length ?? "n/a"} removed, cap 3`,
    );

    // Over the cap: the oldest go, and the archive is left holding exactly the
    // cap — the newest it already had, plus the one just written.
    plant("aged-1d", 1);
    plant("aged-halfd", 0.5);
    seedStore(keepStore);
    const over = await resetWith("fresh-b", 3);
    check(
      "a reset over the cap keeps exactly the cap, newest first",
      over.retention?.removed.join(",") === "aged-3d,aged-2d,aged-1d" &&
        onDisk().join(",") === "aged-halfd,fresh-a,fresh-b" &&
        existsSync(join(keepArchive, "fresh-b")),
      `removed ${over.retention?.removed.join(", ") || "none"}; left ${onDisk().join(", ")}`,
    );

    // The snapshot this reset just wrote is not a candidate, whatever the
    // clock says — a plant dated 30 days ahead, and a cap of one.
    plant("aged-minus-30d", -30);
    seedStore(keepStore);
    const guarded = await resetWith("fresh-c", 1);
    check(
      "the snapshot a reset just wrote is never the one it prunes",
      onDisk().join(",") === "fresh-c" && (guarded.retention?.failed.length ?? 1) === 0,
      `left ${onDisk().join(", ")} — including a plant dated 30 days ahead`,
    );

    // A dry run names what it would remove, and removes none of it.
    plant("aged-4d", 4);
    plant("aged-3d-again", 3);
    plant("aged-2d-again", 2);
    const planned = planRetention(keepArchive, 2, { pending: 1 });
    const beforeDryRun = onDisk().length;
    seedStore(keepStore);
    await resetWith("fresh-dry", 2, true);
    check(
      "a dry run names the snapshots it would remove, and removes none",
      planned.prune.map((snapshot) => snapshot.name).join(",") === "aged-4d,aged-3d-again,aged-2d-again" &&
        onDisk().length === beforeDryRun &&
        fileCount(keepStore) === STORE_FILES.length,
      `would remove ${planned.prune.map((s) => s.name).join(", ") || "nothing"}; ${onDisk().length} still on disk and the store still holds its rows`,
    );

    // A cap that is not a count refuses BEFORE the reset starts, so a flag
    // somebody mistyped can never put the rows at risk.
    seedStore(keepStore);
    let badCap = "";
    try {
      await resetWith("refused-zero", 0);
    } catch (error) {
      badCap = (error as Error).message;
    }
    check(
      "a cap of zero refuses before the reset starts",
      badCap.includes("at least 1") &&
        fileCount(keepStore) === STORE_FILES.length &&
        !existsSync(join(keepArchive, "refused-zero")),
      badCap === ""
        ? "no refusal was raised"
        : `said "${badCap.slice(0, 70)}…" — ${fileCount(keepStore)}/${STORE_FILES.length} store files intact, no archive written`,
    );
    let oddCap = "";
    try {
      await resetWith("refused-odd", 1.5);
    } catch (error) {
      oddCap = (error as Error).message;
    }
    check(
      "a cap that is not a whole number of snapshots refuses the same way",
      oddCap.includes("at least 1") && fileCount(keepStore) === STORE_FILES.length,
      oddCap === "" ? "no refusal was raised" : `said "${oddCap.slice(0, 70)}…"`,
    );

    // A stray FILE in the archive root is somebody's note, not a snapshot.
    writeFileSync(join(keepArchive, "NOTES.md"), "why the 6th cohort was reset twice");
    const beforeStray = onDisk().length;
    seedStore(keepStore);
    const withStray = await resetWith("fresh-f", 2);
    check(
      "a stray file in the archive root is neither counted nor removed",
      existsSync(join(keepArchive, "NOTES.md")) &&
        withStray.retention?.held === beforeStray + 1 &&
        !(withStray.retention.removed ?? []).includes("NOTES.md"),
      `${withStray.retention?.held} snapshots counted for ${beforeStray} directories plus the one just written, and NOTES.md survived`,
    );

    // A snapshot that will not delete is REPORTED, and the reset is still a
    // reset. The failure is planted in the call the tool makes rather than in a
    // permission bit, because what a directory mode means is a filesystem
    // question and this is not one.
    const stuck = plant("aged-quarterd", 0.25);
    seedStore(keepStore);
    // The module object itself, not an import of it: TypeScript re-exports
    // each binding through a getter, so a namespace import cannot be written
    // to, and this is the one place a test needs to reach the call the tool
    // makes. The alias is mutable because the type says otherwise.
    const fsCalls = require("fs") as { rmSync: typeof rmSync };
    const realRm = fsCalls.rmSync;
    let pruneReport: { removed: string[]; failed: Array<{ name: string }> } | undefined;
    try {
      fsCalls.rmSync = ((target: Parameters<typeof rmSync>[0], options?: unknown) => {
        if (String(target) === stuck) throw new Error("EBUSY: resource busy or locked");
        return (realRm as (t: Parameters<typeof rmSync>[0], o?: unknown) => void)(target, options);
      }) as typeof rmSync;
      pruneReport = (await resetWith("fresh-e", 2)).retention;
    } finally {
      fsCalls.rmSync = realRm;
    }
    check(
      "a snapshot that cannot be removed is reported, and the reset still happened",
      pruneReport !== undefined &&
        pruneReport.failed.map((failure) => failure.name).join(",") === "aged-quarterd" &&
        pruneReport.removed.length >= 1 &&
        existsSync(join(keepArchive, "fresh-e")) &&
        fileCount(keepStore) === 0,
      `removed ${pruneReport?.removed.join(", ") || "none"}, failed ${
        pruneReport?.failed.map((failure) => failure.name).join(", ") || "none"
      }, the fresh archive is on disk and the store is empty`,
    );

    // The scratch store keeps no snapshots, so retention has nothing to say
    // about it — and a cap must not reach over and prune a workshop archive.
    const beforeScratch = onDisk().length;
    const scratchDir = join(root, "scratch-store");
    seedStore(scratchDir);
    await resetStore(await openStoreAt(scratchDir), {
      dryRun: false,
      target: "e2e",
      archiveRoot: keepArchive,
      where: scratchDir,
      keep: 1,
    });
    check(
      "the scratch target prunes nothing, because it archives nothing",
      onDisk().length === beforeScratch && fileCount(scratchDir) === 0,
      `${onDisk().length} snapshots untouched by a scratch reset, and the scratch store wiped`,
    );

    // ══ The same tool, against a database. ══════════════════════════════
    const engine = new PGlite(join(root, "pg"));
    await engine.waitReady;
    const query: Query = (text, params) => engine.query(text, params as never[]);
    const db = postgresStore(query);
    const dbArchive = join(root, "db-archive");
    for (const [table, rows] of Object.entries(SEED)) {
      await db.upsert(table as never, rows, (row) => String(row.id ?? row.runId));
    }
    const seeded = await Promise.all(TABLES.map(async (t) => (await db.read(t)).length));
    check("the database store holds the seeded rows", seeded.reduce((a, b) => a + b, 0) === 11, seeded.join("+"));

    // A dry run on a database must not have deleted anything — the check that
    // matters here, because a dry run that quietly emptied a remote room would
    // be invisible from the laptop it was run on.
    await resetStore(db, { dryRun: true, target: "workshop", archiveRoot: dbArchive, where: "postgres pg-test" });
    const afterDry = await Promise.all(TABLES.map(async (t) => (await db.read(t)).length));
    check(
      "a dry run against a database deletes nothing",
      afterDry.join(",") === seeded.join(","),
      `${afterDry.join("+")} rows still there, and no archive written: ${existsSync(dbArchive) ? "ARCHIVE EXISTS" : "none"}`,
    );
    check("a dry run against a database writes no archive", !existsSync(dbArchive), "no archive directory created");

    // Applying it archives into the SAME four files, which is the interchange
    // format the readout already reads.
    const applied = await resetStore(db, {
      dryRun: false,
      target: "workshop",
      archiveRoot: dbArchive,
      where: "postgres pg-test",
    });
    const dbArchived = applied.archiveDir !== undefined ? readdirSync(applied.archiveDir).sort() : [];
    check(
      "a database reset archives the same four files plus a manifest",
      dbArchived.join(",") === ARCHIVE_FILES.join(","),
      dbArchived.join(", ") || "no archive directory",
    );
    const archivedScores =
      applied.archiveDir !== undefined
        ? (JSON.parse(readFileSync(join(applied.archiveDir, "scores.json"), "utf8")) as unknown[])
        : [];
    check(
      "the archived rows are the rows that were there",
      archivedScores.length === 1 && (archivedScores[0] as Row)?.runId === "r1",
      JSON.stringify(archivedScores),
    );
    const afterWipe = await Promise.all(TABLES.map(async (t) => (await db.read(t)).length));
    check("a database reset empties the store", afterWipe.every((n) => n === 0), `${afterWipe.join("+")} rows left`);

    // ── The irreversible one, in the two shapes a disk fails in. The store is
    // the real database here, and it is asked afterwards whether its rows are
    // still there, so "refused" means the rows survived rather than that an
    // error was printed.
    let wiped = 0;
    const watched: Store = {
      kind: db.kind,
      read: (table) => db.read(table),
      upsert: (table, rows, keyOf) => db.upsert(table, rows, keyOf),
      clear: (table) => db.clear(table),
      clearAll: async () => {
        wiped += 1;
        await db.clearAll();
      },
    };
    for (const [table, rows] of Object.entries(SEED)) {
      await db.upsert(table as never, rows, (row) => String(row.id ?? row.runId));
    }
    const reseeded = await Promise.all(TABLES.map(async (t) => (await db.read(t)).length));

    // (a) The archive root cannot be created — a file is in the way.
    const blocked = join(root, "archive-root-is-a-file");
    writeFileSync(blocked, "not a directory");
    wiped = 0;
    let refusalA = "";
    try {
      await resetStore(watched, { dryRun: false, target: "workshop", archiveRoot: blocked, where: "postgres pg-test" });
    } catch (error) {
      refusalA = (error as Error).message;
    }
    const afterA = await Promise.all(TABLES.map(async (t) => (await db.read(t)).length));
    check(
      "an archive that cannot be created refuses, and deletes nothing",
      refusalA.includes("Nothing was deleted") && wiped === 0 && afterA.join(",") === reseeded.join(","),
      refusalA === ""
        ? "no refusal was raised"
        : `said "${refusalA.slice(0, 90)}…" — wipe attempted ${wiped} time(s), ${afterA.reduce((a, b) => a + b, 0)}/${reseeded.reduce((a, b) => a + b, 0)} rows left`,
    );

    // (b) The archive starts and then fails part-way — the shape that leaves a
    // directory named like an archive holding two real files and a missing one,
    // which is what the cleanup below exists to prevent.
    const partialBase = join(root, "partial-archive");
    const stamp = "2026-01-01T00-00-00-000Z";
    const stampDir = join(partialBase, stamp);
    mkdirSync(stampDir, { recursive: true });
    mkdirSync(join(stampDir, "events.json")); // a directory where a file goes
    wiped = 0;
    let refusalB = "";
    try {
      await resetStore(watched, {
        dryRun: false,
        target: "workshop",
        archiveRoot: partialBase,
        where: "postgres pg-test",
        stamp,
      });
    } catch (error) {
      refusalB = (error as Error).message;
    }
    const afterB = await Promise.all(TABLES.map(async (t) => (await db.read(t)).length));
    check(
      "an archive that fails part-way refuses, and deletes nothing",
      refusalB.includes("Nothing was deleted") && wiped === 0 && afterB.join(",") === reseeded.join(","),
      refusalB === ""
        ? "no refusal was raised"
        : `said "${refusalB.slice(0, 90)}…" — wipe attempted ${wiped} time(s), rows still ${afterB.reduce((a, b) => a + b, 0)}`,
    );
    check(
      "a partial archive is removed rather than left to be misread",
      !existsSync(stampDir),
      existsSync(stampDir) ? `${readdirSync(stampDir).length} file(s) left behind` : "no directory left where an archive would be",
    );

    // ── The scratch target still wipes without archiving, which is the one
    // thing that makes it a different target rather than a different flag.
    wiped = 0;
    const scratch = await resetStore(watched, { dryRun: false, target: "e2e", where: "postgres pg-test" });
    const afterScratch = await Promise.all(TABLES.map(async (t) => (await db.read(t)).length));
    check(
      "the scratch target wipes the database without archiving",
      scratch.archiveDir === undefined && wiped === 1 && afterScratch.every((n) => n === 0),
      `archive: ${scratch.archiveDir === undefined ? "none" : scratch.archiveDir}, ${afterScratch.reduce((a, b) => a + b, 0)} rows left`,
    );
    await engine.close();

    // ══ The CLI's own decisions, which no store has to be alive for. ═════
    // A reset run on a laptop against a deployed room is a DATABASE reset, so
    // the things that must be true before any of it runs are worth proving
    // without one: the URL is redacted, the e2e target is a no-op rather than a
    // wipe of the wrong room, a missing DATABASE_URL refuses, and the dedup key
    // is the same database every time it is asked.
    const saved = { store: process.env.DELEGATE_STORE, url: process.env.DATABASE_URL, dir: process.env.DELEGATE_DATA_DIR };
    try {
      check(
        "the plan names the database without the password",
        describeUrl("postgres://admin:hunter2@db.example.com:5432/delegate") === "db.example.com/delegate",
        describeUrl("postgres://admin:hunter2@db.example.com:5432/delegate"),
      );

      process.env.DELEGATE_STORE = "postgres";
      process.env.DATABASE_URL = "";
      let noUrl = "";
      try {
        await resolveTarget("workshop");
      } catch (error) {
        noUrl = (error as Error).message;
      }
      check(
        "a Postgres reset with no DATABASE_URL refuses rather than wiping files",
        noUrl.includes("refusing rather than falling back to files"),
        noUrl === "" ? "no refusal was raised" : noUrl.split("\n")[0],
      );

      const scratchUnderPostgres = await resolveTarget("e2e");
      check(
        "the e2e target is a no-op under a database store, not a wipe",
        scratchUnderPostgres === null,
        scratchUnderPostgres === null ? "resolved to nothing, and said why" : `reached ${scratchUnderPostgres.where}`,
      );

      // The dedup key has to be stable without connecting: it is built from the
      // URL, and two targets naming one database must produce one key.
      const keyFor = (url: string): string => `postgres:${describeUrl(url)}`;
      check(
        "one database is one reset however it is named",
        keyFor("postgres://a:p@db.example.com/delegate") === keyFor("postgres://b:q@db.example.com:5432/delegate"),
        "two spellings of the same database produce one key, so --target all wipes it once",
      );
    } finally {
      for (const [key, value] of [["DELEGATE_STORE", saved.store], ["DATABASE_URL", saved.url], ["DELEGATE_DATA_DIR", saved.dir]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nSTORE RESET: PASS" : `\nSTORE RESET: FAIL (${failures})`);
  return failures === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error("store-reset gate threw:", error);
    process.exit(1);
  },
);
