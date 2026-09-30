/**
 * The JSON-file store: four files under `delegate/data/`, unchanged in
 * behaviour from the version this replaced.
 *
 * It is the default because it is what a laptop, the Playwright suite and the
 * CLI tools use, and because it is the only one of the two that can be read by
 * hand while a workshop is in progress (`alpha/reset-cohort.ts` moves these
 * files, `readout-cli.ts` reads them, `alpha/preflight.ts` inspects them).
 *
 * The merge-on-write here is what the event log has always done, and the
 * comment that justified it is the honest limit of this store: a lost update
 * can only come from another PROCESS, which the CLI tools serialise. That
 * argument stops holding the moment every request may be a different process,
 * which is the whole reason the Postgres store exists — so this file is kept
 * for the single-process cases and is not what a deployment should use.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { dataDir } from "../paths";
import { TABLES, type Row, type Store, type TableName } from "./store";

/** The directory exists on demand: a fresh checkout, or one just reset, has no `data/`. */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Events come back by their numeric id; every other table comes back in the
 * order the file holds, which is the order rows were first written. The two
 * rules are the ones the Postgres store implements in SQL (`ORDER` there), and
 * they are not the same rule because the two kinds of table do not have the
 * same natural order — a renumbered event belongs in its numeric place, while a
 * run row has a string id that cannot be sorted at all.
 *
 * The file's own order is NOT already the events' order, which is why this
 * exists: the log writes a renumbered event in the position it held in the
 * batch, so a file can hold id 9 ahead of id 2. Reading it back as written is
 * how the event log could hand a scorer a transcript out of order.
 */
function inReadOrder<T extends Row>(rows: T[]): T[] {
  if (rows.length === 0) return rows;
  if (!rows.every((row) => typeof row.id === "number" && Number.isFinite(row.id as number))) return rows;
  return [...rows].sort((a, b) => (a.id as number) - (b.id as number));
}

function readTable<T extends Row>(dir: string, table: TableName): T[] {
  const path = join(dir, `${table}.json`);
  if (!existsSync(path)) return [];
  return inReadOrder(JSON.parse(readFileSync(path, "utf8")) as T[]);
}

/**
 * The JSON-file store, over an explicit directory. `fileStore()` is this at
 * `dataDir()`; the reset tool asks for the directory itself, because one
 * invocation addresses the workshop room and the suite's scratch store, and
 * which one it means must not be decided by an environment variable.
 */
export function fileStoreAt(dir: string): Store {
  return {
    kind: "file",

    async read(table) {
      return readTable(dir, table);
    },

    async upsert(table, rows, keyOf) {
      if (rows.length === 0) return;
      // Re-read at write time and merge, rather than writing the caller's
      // snapshot: two requests each holding their own copy of the table would
      // otherwise silently drop each other's rows. Re-writing a key already
      // present overwrites the row and keeps its slot, which is the ordering
      // rule the Postgres store matches with its untouched `seq`.
      const byKey = new Map<string, Row>();
      for (const row of readTable(dir, table)) byKey.set(keyOf(row), row);
      for (const row of rows) byKey.set(keyOf(row), row);
      ensureDir(dir);
      writeFileSync(join(dir, `${table}.json`), JSON.stringify([...byKey.values()], null, 2));
    },

    async clear(table) {
      rmSync(join(dir, `${table}.json`), { force: true });
    },

    async clearAll() {
      // Synchronous, so there is no window in which half the tables are gone —
      // the same one-statement property the Postgres store gets from a commit.
      for (const table of TABLES) rmSync(join(dir, `${table}.json`), { force: true });
      // The directory itself goes too when the wipe emptied it: a store that
      // exists but is empty is the same state, except that `reset`'s own
      // "already pristine" branch and the "does not exist" branch then disagree
      // about what a clean checkout looks like.
      if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
    },
  };
}

export function fileStore(): Store {
  return fileStoreAt(dataDir());
}
