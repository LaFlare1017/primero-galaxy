/**
 * Which Postgres the store gates run against.
 *
 * `test-store-backends.ts` proves the store's SQL. It cannot prove the
 * five-line adapter above it — `neonQuery`, the HTTP driver that is the only
 * reason a serverless function can hold a Postgres connection at all — because
 * an in-process engine never goes near it. So the engine is a parameter:
 * unset, the gates use PGlite in a temp directory and cost nothing; set, they
 * use the real driver against a real database, which is the only way the
 * adapter is executed at all rather than assumed.
 *
 * The variable is named `DELEGATE_STORE_TEST_URL` and deliberately NOT
 * `DATABASE_URL`: a gate that switched substrate on the app's own
 * configuration would be a gate whose behaviour changes with deployment
 * settings, and one whose "database" could be production by accident.
 *
 * Which brings the safety question, because a remote engine is not a scratch
 * engine: the gates seed rows and call `clearAll`. `assertDisposable` refuses a
 * URL whose database does not look like a test database unless
 * `DELEGATE_STORE_TEST_ALLOW_ANY` says otherwise, and the refusal names the
 * database it was about to write to rather than a rule. A gate that silently
 * emptied somebody's Neon project because a variable was set would be the worst
 * thing in this repository.
 *
 * `disposable` is the other half of the contract, and it is what the gates read
 * to decide whether a check that creates and drops a TABLE may run. Against a
 * shared database the honest answer is to skip and say so — the alternative,
 * creating a `delegate_rows` in a schema the real store also uses, is a way of
 * breaking the thing the gate is here to check.
 */

import { PGlite } from "@electric-sql/pglite";
import { neonQuery, postgresStore, type Query } from "./postgres-store";
import { TABLES, type Store } from "./store";

export interface TestEngine {
  /** What the checks should say about where they are running. */
  readonly kind: "pglite" | "remote";
  /** One line for the gate's header: a path, or a redacted host/database. */
  readonly where: string;
  /** The store under test, over whichever engine this is. */
  readonly store: Store;
  /** Raw SQL, for the checks that plant a table or count rows directly. */
  readonly query: Query;
  /**
   * May this run create and drop tables? True for a directory the gate owns,
   * false for a database somebody else may be using — and the checks that need
   * it are skipped rather than run when this is false.
   */
  readonly disposable: boolean;
  close(): Promise<void>;
}

/** The URL the gates should use, or "" for the in-process engine. */
export function remoteUrl(): string {
  return (process.env.DELEGATE_STORE_TEST_URL ?? "").trim();
}

/** Host and database, never the password — this string reaches CI logs. */
export function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, "");
    return `${parsed.hostname}${database ? `/${database}` : ""}`;
  } catch {
    return "a URL this build cannot parse";
  }
}

/**
 * Refuse a database whose name does not look disposable. A test that wipes what
 * it wrote is fine; a test pointed at `delegate-production` is not, and the
 * only moment to notice is before the first DELETE.
 */
export function assertDisposable(url: string): void {
  if (process.env.DELEGATE_STORE_TEST_ALLOW_ANY === "1") return;
  const database = (() => {
    try {
      return new URL(url).pathname.replace(/^\//, "").toLowerCase();
    } catch {
      return "";
    }
  })();
  const looksDisposable = database !== "" && /(^|[-_])(ci|test|testing|ephemeral|disposable|scratch)([-_]|$)/.test(database);
  if (looksDisposable) return;
  throw new Error(
    `refusing to run a destructive store gate against database "${database || "(unnamed)"}" — ` +
      "these gates call clearAll, so the database has to be one that exists to be emptied. Name it with " +
      "ci/test/ephemeral/scratch in it, or set DELEGATE_STORE_TEST_ALLOW_ANY=1 if you are certain.",
  );
}

/**
 * Open the engine the gates should use. `dir` is the PGlite data directory and
 * is ignored for a remote engine, which has files of its own. `force: "local"`
 * asks for the in-process engine whatever the environment says, which is how a
 * check that must create and drop a table still runs during a remote run.
 */
export async function openTestEngine(dir: string, opts: { force?: "local" } = {}): Promise<TestEngine> {
  const url = opts.force === "local" ? "" : remoteUrl();
  if (url === "") {
    const engine = new PGlite(dir);
    await engine.waitReady;
    const query: Query = (text, params) => engine.query(text, params as never[]);
    return {
      kind: "pglite",
      where: `in-process postgres (${dir})`,
      store: postgresStore(query),
      query,
      // PGlite here is a directory this process created and will remove, so a
      // check may create and drop anything in it.
      disposable: true,
      close: () => engine.close(),
    };
  }

  assertDisposable(url);
  const query = neonQuery(url);
  const store = postgresStore(query);
  return {
    kind: "remote",
    where: `remote postgres (${describeDatabase(url)})`,
    store,
    query,
    // A shared database is not a scratch engine: a check here may not create
    // and drop a table, because the table it would plant is named the same as
    // the store's own.
    disposable: false,
    close: async () => undefined,
  };
}

/**
 * Empty a shared database before a run, and report what it found.
 *
 * Separate from `openTestEngine` on purpose. Opening an engine must not have
 * side effects, because the store gate opens a SECOND engine half way through —
 * to prove that rows outlive the connection that wrote them — and a wipe on
 * every open would destroy the very rows that check is about. So the one
 * destructive act the gates perform is a separate, named, once-per-run call
 * that the gate makes in the open, where a reader can see it.
 *
 * Returns the row counts found BEFORE the wipe, because "the last run left 14
 * rows" is worth printing and "the wipe happened" is worth asserting.
 */
export async function emptySharedDatabase(store: Store): Promise<Record<string, number>> {
  const before: Record<string, number> = {};
  for (const table of TABLES) before[table] = (await store.read(table)).length;
  await store.clearAll();
  return before;
}
