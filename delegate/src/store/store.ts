/**
 * Where delegate's four tables live, and the one question a caller has about
 * them.
 *
 * The v1 store is four JSON files under `delegate/data/`, and it works on a
 * laptop: one process, one directory, a workshop with three people in it. It
 * stops working the moment the app is deployed somewhere the filesystem is not
 * shared — a Vercel function is read-only outside `/tmp` and is not the same
 * machine as its neighbour, so a session started on one invocation is gone by
 * the next. That is not a tuning problem, it is the substrate the handoff
 * called for (ERPNext + Postgres; `delegate/docker-compose.yml` carries the
 * target), and this file is the swap-in point the README promised.
 *
 * The interface is deliberately three methods and a key, because everything
 * interesting — merge-on-write, event renumbering, score keying — is backend
 * independent and lives above this line, where it is written once and proved
 * once. What a backend owes is: rows come back whole, an upsert never drops a
 * row it was not given, and `clear` empties one table and no other.
 *
 * Both backends answer `read` in the same order (events by their numeric id,
 * everything else by key), so a caller cannot tell which one it has. That is
 * the claim `test-store-backends.ts` proves rather than argues.
 */

export type TableName = "sessions" | "runs" | "events" | "scores";

/** A stored row. Every table is a list of these; `id` is present on some. */
export type Row = Record<string, unknown>;

/** What makes a row the same row: `id` for the event-log tables, run+dimension for scores. */
export type KeyOf = (row: Row) => string;

export interface Store {
  /** Which substrate this is, for the refusal messages and the readout. */
  readonly kind: "file" | "postgres";
  /** Every row in a table, in the order both backends promise. */
  read(table: TableName): Promise<Row[]>;

  /**
   * Write these rows, keyed by `keyOf`, leaving every other row alone. A row
   * already in the table is REPLACED by the one given — event-log rows are
   * immutable in practice, but a run row is mutated in place (submitAnswer
   * stamps it), and last-writer-wins is what the file store has always done.
   */
  upsert(table: TableName, rows: Row[], keyOf: KeyOf): Promise<void>;

  /** Empty one table. The reset tool's `--yes`; nothing else calls it. */
  clear(table: TableName): Promise<void>;

  /**
   * Empty the WHOLE store — the reset tool's, and the reason this is a method
   * rather than four `clear` calls at the call site.
   *
   * On a shared database the difference is not tidiness. Four separate deletes
   * are four commits, and a failure in the middle leaves a workshop room that
   * has lost its sessions and runs but still holds the events and scores that
   * explain them — a state no reader has a name for and no one can interpret
   * after the fact. One statement is one commit, so the store is either what it
   * was or empty. The file store gets the same property from four synchronous
   * unlinks that cannot interleave with anything.
   *
   * It is a separate method rather than a default on top of `clear` because the
   * guarantee is stronger and a backend that cannot make it should have to say
   * so, not inherit it.
   */
  clearAll(): Promise<void>;
}

/** Rows are keyed by their `id`, which is what the event-log tables have always used. */
export const byId: KeyOf = (row) => String(row.id);

/**
 * Whether this row has an id the backends can ORDER BY numerically.
 *
 * One predicate, read by both backends, because the two orderings have to agree
 * and two copies of "what counts as orderable" is a way for them to stop: the
 * file store decides in JS whether to sort, and Postgres decides in SQL from the
 * `id` COLUMN this same predicate fills. A row the file store calls orderable
 * and the column does not is a table the two read in different orders.
 *
 * Only the events table has one — sessions and runs carry string ids and scores
 * carry none, which is why those two are read in insertion order instead.
 */
export const isOrderable = (row: Row): boolean =>
  typeof row.id === "number" && Number.isFinite(row.id as number);

/** Scores are keyed by the pair that makes them unique: one run, one dimension. */
export const byRunAndDimension: KeyOf = (row) => `${String(row.runId)}:${String(row.dimension)}`;

/** Every table, for the callers that have to read or clear all of them. */
export const TABLES: TableName[] = ["sessions", "runs", "events", "scores"];

/**
 * Opens the store this process should use.
 *
 * `DELEGATE_STORE` unset means the JSON files, which is every local run, the
 * Playwright suite and the CLI tools — a store that only changed under an env
 * var nobody sets locally would be a store nobody could test locally. Setting
 * it to `postgres` without a `DATABASE_URL` REFUSES rather than falling back to
 * files: a deploy that quietly kept its sessions in an ephemeral filesystem
 * would answer every request with a working page and lose every participant's
 * run, and a refusal is the only outcome that is visible before the workshop
 * rather than after it.
 */
/**
 * One store for a NAMED directory, for the callers that choose their own path
 * rather than following `DELEGATE_DATA_DIR` — the reset tool, which addresses
 * two different stores in one invocation and must not have the environment
 * decide which is which. Deliberately file-only: a directory is what it takes.
 */
export async function openStoreAt(dir: string): Promise<Store> {
  const { fileStoreAt } = await import("./file-store");
  return fileStoreAt(dir);
}

export async function openStore(): Promise<Store> {
  const asked = (process.env.DELEGATE_STORE ?? "").trim().toLowerCase();
  if (asked === "" || asked === "file") {
    const { fileStore } = await import("./file-store");
    return fileStore();
  }
  if (asked === "postgres") {
    const url = (process.env.DATABASE_URL ?? "").trim();
    if (url === "") {
      throw new Error(
        "DELEGATE_STORE=postgres and no DATABASE_URL — refusing rather than falling back to files,\n" +
          "because a store that answers from an ephemeral filesystem looks like this one until it doesn't.",
      );
    }
    const { postgresStoreFromUrl } = await import("./postgres-store");
    return postgresStoreFromUrl(url);
  }
  throw new Error(`DELEGATE_STORE is "${process.env.DELEGATE_STORE}" — this build knows "file" and "postgres"`);
}
