/**
 * The Postgres store, over an injected `query`.
 *
 * One table, four logical tables in it, two DDL statements. The obvious design
 * — a table per logical table — buys nothing here: the rows are opaque JSON
 * either way, `clear` is a `DELETE … WHERE table_name = $1` rather than a
 * `TRUNCATE`, and a single table is one thing for the handoff's snapshot/reset
 * workflow to reason about.
 *
 * Two ordering columns, because the two kinds of table have different natural
 * orders and the file store's order is the one callers were written against:
 *   - `id`, carried beside the body, for the event table, where the order is the
 *     allocator's and a row that gets renumbered still belongs in its numeric
 *     place rather than at the end of the file.
 *   - `seq`, the insertion order, for sessions and runs, whose ids are strings
 *     and so cannot be sorted at all. It is deliberately NOT updated on
 *     conflict: the file store builds a `Map` keyed by id, so re-writing a row
 *     that is already there keeps its original slot, and a row that moved on
 *     every write would put the two backends' answers in a different order.
 *
 * The connection is a parameter rather than an import so this file can be
 * proved: the fixture runs the same SQL against an in-process Postgres, and
 * production supplies one that speaks to Neon. The driver is the only part of
 * the store that is not exercised by a test, and it is five lines of adapter
 * for exactly that reason — the SQL underneath it is all this file.
 */

import { isOrderable, type Row, type Store, type TableName } from "./store";
// Type-only, so the driver is still not loaded until a Postgres store is
// actually asked for — and so the adapter below is checked against the real
// driver's types rather than a hand-written guess at them. A driver upgrade
// that removed `query()` would fail this build instead of the first request a
// deployed workshop makes.
import type { neon as NeonClient } from "@neondatabase/serverless";

/** The one thing this store needs from a Postgres connection. */
export type Query = (text: string, params?: unknown[]) => Promise<{ rows: Row[] }>;

/**
 * Two statements, run one at a time — not one string with both in it. A driver
 * that speaks the extended protocol turns a statement with parameters into a
 * PREPARED statement, and Postgres refuses more than one command in a prepared
 * statement ("cannot insert multiple commands into a prepared statement").
 * That is a per-statement rule rather than a PGlite quirk, so shipping the DDL
 * as one string would have bought a table-less first request on a real
 * deployment — every scenario load failing with `relation "delegate_rows" does
 * not exist`, which reads like a migration was never run. `test-store-backends.ts`
 * caught it by running this against a real Postgres engine.
 */
const DDL: string[] = [
  `create table if not exists delegate_rows (
     seq bigserial not null,
     table_name text not null,
     key text not null,
     id bigint,
     body jsonb not null,
     primary key (table_name, key)
   )`,
  "create index if not exists delegate_rows_in_order on delegate_rows (table_name, seq)",
  "create index if not exists delegate_rows_by_id on delegate_rows (table_name, id)",
];

/**
 * One order for every table, and it is the file store's. `id` when the table
 * has numeric ids (events), `seq` when it does not (sessions, runs) — which is
 * what a `Map` insertion order and a numeric sort produce respectively, so a
 * caller cannot tell which backend it is reading.
 */
const ORDER = "(case when id is not null then id end) asc nulls last, seq asc";

/** The columns this store's table is defined by, in the order it declares them. */
const COLUMNS = ["seq", "table_name", "key", "id", "body"];

/** Is there a `delegate_rows` here at all? One filtered row, never the catalog. */
async function tableExists(query: Query): Promise<boolean> {
  const { rows } = await query(
    "select 1 as present from information_schema.tables where table_name = $1 and table_schema = current_schema() limit 1",
    ["delegate_rows"],
  );
  return rows.length > 0;
}

/**
 * Prove the table is OURS before anything reads from it or deletes from it.
 *
 * `create table if not exists` adopts whatever already sits under that name, so
 * a `DATABASE_URL` pointed at the wrong database produces a store that answers
 * reads from somebody else's rows — and `clearAll` would then delete them. The
 * check is the column set, not the name and not the contents: a table with
 * these five columns and these types is this store's, whoever created it, while
 * a same-named table of any other shape is refused by name so the mistake is
 * legible. Costs one query per cold process.
 */
async function assertOurs(query: Query): Promise<void> {
  const { rows } = await query(
    `select column_name from information_schema.columns
     where table_name = $1 and table_schema = current_schema() order by ordinal_position`,
    ["delegate_rows"],
  );
  const found = rows.map((row) => String(row.column_name ?? ""));
  const same =
    found.length === COLUMNS.length &&
    found.every((name, i) => name.toLowerCase() === (COLUMNS[i] ?? "").toLowerCase());
  if (!same) {
    throw new Error(
      `a table named delegate_rows already exists with columns [${found.join(", ") || "none"}], ` +
        "which is not this store's table — refusing to adopt it. Point DATABASE_URL at this project's own " +
        "database, or rename that table; a store that reads and then DELETES rows it did not create is worse " +
        "than one that will not start.",
    );
  }
}

export function postgresStore(query: Query): Store {
  // The DDL runs once per process, and every caller that arrives before it has
  // finished awaits the same promise: two concurrent first requests must not
  // both try to create the table, and neither should pay for a round trip it
  // does not need. Both statements are `if not exists`, so a warm database pays
  // two round trips per cold start and no more.
  let ready: Promise<void> | null = null;
  const ensure = async () => {
    if (ready) return ready;
    // A rejected promise is kept, so a store that could not start says so
    // identically to every caller rather than half of them succeeding against a
    // table that was never created.
    ready = (async () => {
      // ASK BEFORE CREATING, in that order. `create index … on delegate_rows
      // (table_name, seq)` against somebody else's two-column table fails with
      // `column "table_name" does not exist` — so a guard that ran after the DDL
      // would never get to name the real problem, and the operator would be
      // looking at a missing column rather than at the wrong database.
      if (await tableExists(query)) await assertOurs(query);
      // Idempotent, and still run when the table was already ours: a process
      // that died between creating the table and creating the indexes would
      // otherwise leave the store permanently without them.
      for (const statement of DDL) await query(statement);
    })();
    return ready;
  };

  return {
    kind: "postgres",

    async read(table) {
      await ensure();
      const { rows } = await query(
        `select body from delegate_rows where table_name = $1 order by ${ORDER}`,
        [table],
      );
      return rows.map((row) => row.body as Row);
    },

    async upsert(table, rows, keyOf) {
      if (rows.length === 0) return;
      await ensure();
      // One statement for the batch, so a partial write is not a state the next
      // read can see — the file store gets that from a single writeFileSync, and
      // this is the equivalent rather than a row-at-a-time loop.
      //
      // The batch is keyed first, because Postgres rejects a statement that
      // touches one row twice ("ON CONFLICT DO UPDATE command cannot affect row
      // a second time") and callers legitimately hand over the same key twice:
      // `submitAnswer` pushes the run it is stamping, which the same request
      // already pushed when it started it. The file store survives that because
      // it is a Map; here the last row for a key wins, which is what the Map
      // does too, and the first one's position is kept by leaving `seq` alone.
      const last = new Map<string, Row>();
      for (const row of rows) last.set(keyOf(row), row);
      const values: unknown[] = [];
      const tuples = [...last].map(([key, row], index) => {
        const at = index * 4;
        values.push(table, key, isOrderable(row) ? (row.id as number) : null, JSON.stringify(row));
        return `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}::jsonb)`;
      });
      // `do update` rather than `do nothing`: a run row is mutated in place
      // (submitAnswer stamps submittedAt) and a row that silently kept its old
      // body would be a participant who can never submit. `seq` is left alone,
      // which is what keeps a re-written row in the slot the file store keeps it
      // in (see ORDER).
      await query(
        `insert into delegate_rows (table_name, key, id, body) values ${tuples.join(", ")}
         on conflict (table_name, key) do update set id = excluded.id, body = excluded.body`,
        values,
      );
    },

    async clear(table) {
      await ensure();
      await query("delete from delegate_rows where table_name = $1", [table]);
    },

    async clearAll() {
      await ensure();
      // One statement, so the whole room goes in one transaction. Every row in
      // this table IS a delegate row — the four logical tables are the only
      // thing it holds — so there is nothing to filter on and no other caller's
      // data in it to be careful of. The table is delegate's alone by
      // construction: `create table if not exists` with this name means a
      // pre-existing table of that name would be adopted rather than created,
      // which is the one thing a store should refuse. It is checked below.
      await query("delete from delegate_rows");
    },
  };
}

/**
 * The production connection: Neon's HTTP driver, which is why a serverless
 * function can hold a Postgres connection at all. Loaded only when a store is
 * actually asked for, so nothing that runs on files pays for it.
 *
 * Two things about the driver are load-bearing and neither is guessable from
 * the outside, so they are written down here and proved by the store gate's
 * remote leg (`.github/workflows/ci.yml`, `DELEGATE_STORE_TEST_URL`) rather
 * than by this file's own confidence:
 *
 *   - `client.query(text, params)` is the form, and the ONLY form. Calling the
 *     client as a function — `sql("select $1", [value])` — throws in v1.1:
 *     "This function can now be called only as a tagged-template function …
 *     use sql.query(...)". The store has placeholders in every statement, so
 *     the template form was never an option.
 *   - The query function talks HTTP to the database's `/sql` endpoint. That is
 *     what a serverless function can actually do: `Pool` and `Client` are the
 *     parts of this driver that ride a WebSocket, and the driver has no
 *     built-in WebSocket before Node 22, so on the Node 20 runtime a Vercel
 *     function can still be running they need a `ws` dependency this project
 *     does not have. Staying on `neon()` keeps the store to one request per
 *     query and no socket at all.
 */
export function neonQuery(url: string): Query {
  let client: ReturnType<typeof NeonClient> | null = null;
  return async (text, params) => {
    if (client === null) {
      const { neon } = await import("@neondatabase/serverless");
      client = neon(url);
    }
    // `fullResults: true` is what makes this return `{ rows }` rather than the
    // bare rows array, and it is LOAD-BEARING: without it `client.query()`
    // resolves to an ARRAY, `result.rows` is `undefined`, and every read in
    // this store fails at `rows.length` with `Cannot read properties of
    // undefined (reading 'length')` — a message that names neither the driver
    // nor the store.
    //
    // This was a real bug, not an artefact of the fake console that found it:
    // the remote leg had never been executed by anything in this repository,
    // because it needs `NEON_API_KEY` and a real database, and every check for
    // it ran against PGlite. Both installs of the driver are 1.1.0 and both
    // behave this way, so the adapter would have failed on the first push that
    // had a Neon account.
    const result = (await client.query(text, params ?? [], { fullResults: true })) as { rows: Row[] };
    return { rows: result.rows };
  };
}

/** Opens the store against a URL, which is what `DELEGATE_STORE=postgres` reaches. */
export function postgresStoreFromUrl(url: string): Store {
  return postgresStore(neonQuery(url));
}
