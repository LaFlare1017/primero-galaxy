/**
 * The store gate: one suite, run twice, once per substrate.
 *
 * The claim under test is not "the Postgres store works" — it is the claim
 * `store.ts` makes in its own words: *a caller cannot tell which one it has*.
 * That is a claim about the ANSWER, not about the code, so it is checked the
 * only way it can be: the same workshop is played against a directory of JSON
 * files and against a real Postgres engine (PGlite, in-process, so this is a
 * unit test rather than something needing a database), and the two sets of rows
 * are compared field by field, in order, including the event ids.
 *
 * Four things this suite exists to catch, each of which was true of a version of
 * this code that had never been run against Postgres:
 *
 *   1. Multi-statement DDL. A driver using the extended protocol turns a
 *      parameterised statement into a PREPARED one, and Postgres refuses more
 *      than one command in it. The DDL as one string meant a first request
 *      against a real database would fail with `relation "delegate_rows" does
 *      not exist` — a deployment whose only symptom is every scenario failing
 *      to load.
 *   2. Order. The two tables have different natural orders: events are numeric
 *      and must come back in id order (a renumbered event still belongs in its
 *      numeric place), sessions and runs have string ids and must come back in
 *      insertion order. Getting this wrong on either side hands a facilitator
 *      grid or a transcript a plausible but wrong sequence.
 *   3. Same-id collisions between two logs. The renumbering has to account for
 *      ids handed out within its OWN batch, not only against what the store
 *      already holds.
 *   4. A repeated key in one batch. `submitAnswer` pushes the run it is
 *      stamping, which the same request already pushed when starting it, so
 *      every submit hands the store the same run twice.
 *
 * Plus the two refusals `openStore` makes, because a store that falls back
 * quietly is the failure this whole exercise exists to prevent.
 *
 * One difference between the backends is real and is NOT papered over here:
 * a `jsonb` round trip does not preserve the order of an object's fields, so a
 * row read from Postgres can list its keys in a different order than the same
 * row read from a file. Nothing in the app depends on it (the fields are read
 * by name, and the rows only leave the process as JSON to a browser), so the
 * comparison is by field and value — sorted keys — and there is a check below
 * that says so out loud rather than leaving a future reader to discover it as a
 * diff.
 *
 * Nothing here touches `delegate/data/`: the file store is pointed at a scratch
 * directory through `DELEGATE_DATA_DIR`, and the Postgres engine lives in a
 * temp directory that is removed on the way out. Wired into `npm test`.
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { EventLog, latestRunFor, type ScenarioRun } from "../runtime/events";
import { persistScores, readScores } from "../report/score-store";
import type { Score } from "../scoring/scorers";
import { fileStore } from "./file-store";
import { postgresStore } from "./postgres-store";
import { ignoreClosedPipe } from "../print";
import { assertDisposable, describeDatabase, emptySharedDatabase, openTestEngine } from "./test-engine";
import { byId, openStore, TABLES, type Row, type Store, type TableName } from "./store";

// A reader who pipes this to `head` must not kill the run before it cleans up.
ignoreClosedPipe();

let failures = 0;
function check(name: string, passed: boolean, detail: string): void {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!passed) failures += 1;
}

const SCENARIO = "s5-cold-call";
const COHORT = "cohort-store-gate";

/** One score row, built rather than spelled out five times. */
function score(runId: string, dimension: Score["dimension"], value: number, evidenceEventIds: number[]): Score {
  return {
    runId,
    scenarioId: SCENARIO,
    dimension,
    value,
    max: 4,
    evidenceEventIds,
    justification: `credited for ${dimension}`,
    rubricVersion: "v0.2-rubric",
    gradedBy: "deterministic",
  };
}

/**
 * The workshop. Two requests over one run, which is the shape every route
 * takes: open a log, log, flush, score. Run identically against both backends.
 */
async function playWorkshop(store: Store): Promise<void> {
  const first = await EventLog.open(store);
  const session = first.startSession("P-01", COHORT);
  const run = first.startRun(session.id, SCENARIO);
  first.log(run.id, "prompt_sent", "participant", { text: "Can you pull the record for renewal risk?" });
  first.log(run.id, "agent_response", "agent", { text: "Opening the record now." });
  first.log(run.id, "tool_call", "agent", { tool: "open_record", id: "rec-7" });
  first.submitAnswer(run.id, "I would ask for the ledger export before I trust the summary.");
  await first.flush();
  await persistScores([score(run.id, "specification", 3, [4])], store);

  // A second request: a fresh log over a store that already holds rows, which
  // is where merge-on-write is either honoured or quietly dropped.
  const second = await EventLog.open(store);
  second.log(run.id, "record_scrolled", "participant", { to: 3 });
  second.submitAnswer(run.id, "I would ask for the ledger export before I trust the summary, and reconcile it.");
  await second.flush();
  await persistScores(
    [score(run.id, "verification", 2, [5]), score(run.id, "escalation_judgment", 4, [2])],
    store,
  );
}

/**
 * What the two backends must agree on, with the parts that are allowed to
 * differ made identical rather than compared loosely: generated ids become
 * `#1`, `#2` in the order they were minted, and clock readings become `<ts>`.
 * Everything else — the field set, the values, the event ids, the row order — is
 * compared as it stands, because those are the parts a caller could notice.
 */
async function snapshot(store: Store): Promise<string> {
  const sessions = (await store.read("sessions")) as Array<Row & { id: string }>;
  const runs = (await store.read("runs")) as Array<Row & { id: string }>;
  const events = (await store.read("events")) as Array<Row & { id: number }>;
  const scores = (await store.read("scores")) as Array<Row & { runId: string }>;

  const ids = new Map<string, string>();
  const nameOf = (id: string): string => {
    const seen = ids.get(id);
    if (seen !== undefined) return seen;
    const label = `#${ids.size + 1}`;
    ids.set(id, label);
    return label;
  };
  const clock = (value: unknown): unknown => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? "<ts>" : value);
  const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  // Every object sorted by field name, at every depth: `jsonb` does not keep
  // the order fields were written in, and a payload's keys are fields too.
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Row)
          .sort(([a], [b]) => byName(a, b))
          .map(([key, inner]) => [key, canonical(inner)]),
      );
    }
    return value;
  };
  const scrub = (row: Row): Row => {
    const out: Row = {};
    for (const [key, value] of Object.entries(row)) {
      if ((key === "id" || key === "runId" || key === "sessionId") && typeof value === "string") out[key] = nameOf(value);
      else if (key === "ts" || key === "startedAt" || key === "submittedAt") out[key] = clock(value);
      else out[key] = value;
    }
    return canonical(out) as Row;
  };

  return JSON.stringify(
    {
      sessions: sessions.map(scrub),
      runs: runs.map(scrub),
      events: events.map(scrub),
      scores: scores.map(scrub),
    },
    null,
    2,
  );
}

/** The score rows, straight through the seam the submit route uses. */
async function scores(store: Store): Promise<unknown[]> {
  return (await readScores(store)) as unknown[];
}

/** How many rows each table holds, for the `clear` check. */
async function counts(store: Store): Promise<Record<TableName, number>> {
  const out = {} as Record<TableName, number>;
  for (const table of TABLES) out[table] = (await store.read(table)).length;
  return out;
}

/** A bare event row, for handing straight to a store. */
function eventRow(id: number, type: string, to: number): Row {
  return { id, runId: "run-shuffled", ts: "2026-01-01T00:00:00.000Z", type, actor: "participant", payload: { to } };
}

/**
 * Two logs, both opened before either wrote anything: the state a deployment
 * creates for two requests in the same millisecond. The third event of the
 * second log is the one that matters — its id is 2, and the second log's first
 * event is renumbered ONTO 2, so renumbering that only looks at the store hands
 * the same id out twice and the second event overwrites the first.
 */
async function collidingLogs(store: Store): Promise<{ before: number; rows: Array<Row & { id: number }> }> {
  const before = ((await store.read("events")) as Array<Row & { id: number }>).length;
  const early = await EventLog.open(store);
  const late = await EventLog.open(store);
  const runId = "run-collision";

  early.log(runId, "record_opened", "participant", { record: "rec-1" });
  await early.flush();

  late.log(runId, "record_opened", "agent", { record: "rec-2" });
  late.log(runId, "record_scrolled", "participant", { to: 1 });
  late.log(runId, "record_scrolled", "participant", { to: 2 });
  await late.flush();

  const events = (await store.read("events")) as Array<Row & { id: number }>;
  return { before, rows: events };
}

/** A row as a comparable shape: id, kind, who, and what — never the clock. */
const shape = (event: Row): string =>
  `${event.id} ${String(event.type)} ${String(event.actor)} ${JSON.stringify(event.payload)}`;

/** What the four planted events must read back as, from the first new id up. */
const planted = (first: number): string[] =>
  [
    "record_opened participant {\"record\":\"rec-1\"}",
    "record_opened agent {\"record\":\"rec-2\"}",
    "record_scrolled participant {\"to\":1}",
    "record_scrolled participant {\"to\":2}",
  ].map((line, i) => `${first + i} ${line}`);

async function parity(root: string): Promise<void> {
  process.env.DELEGATE_DATA_DIR = join(root, "files");
  const files = fileStore();
  await playWorkshop(files);

  const engine = await openTestEngine(join(root, "pg"));
  console.log(`store gate: postgres leg on ${engine.where}\n`);
  const postgres = engine.store;
  // A shared database carries whatever the last run left, and a gate that
  // asserted on row counts would be asserting on the previous run. Once per
  // run, never on the reopen below — which is the check that rows outlive the
  // connection that wrote them, and a wipe there would empty its own subject.
  const leftBehind = engine.kind === "remote" ? await emptySharedDatabase(postgres) : {};
  const startingRows = await counts(postgres);
  check(
    "the postgres leg starts from an empty store",
    TABLES.every((table) => startingRows[table] === 0),
    engine.kind === "remote"
      ? `emptied first: the previous run left ${TABLES.map((t) => `${t} ${String(leftBehind[t] ?? 0)}`).join(", ")}`
      : "a directory this run created, so there was nothing to empty",
  );
  await playWorkshop(postgres);

  // 1. Same rows, same order, same event ids.
  const fromFiles = await snapshot(files);
  const fromPostgres = await snapshot(postgres);
  check(
    "both backends answer the workshop identically",
    fromFiles === fromPostgres,
    fromFiles === fromPostgres ? `${JSON.parse(fromFiles).events.length} events, byte-equal snapshots` : firstDifference(fromFiles, fromPostgres),
  );
  check(
    "both backends read their scores through the same seam",
    JSON.stringify(await scores(files)).length > 0 &&
      (await scores(files)).length === (await scores(postgres)).length,
    `${(await scores(files)).length} score rows on files, ${(await scores(postgres)).length} on postgres`,
  );

  // 2. A collision between two logs loses nothing, in the same order, on both.
  const fileCollide = await collidingLogs(fileStore());
  const postgresCollide = await collidingLogs(postgresStore(engine.query));
  const fileNew = fileCollide.rows.slice(fileCollide.before);
  const postgresNew = postgresCollide.rows.slice(postgresCollide.before);
  check(
    "two logs minting the same ids both survive",
    fileNew.length === 4 && new Set(fileNew.map((e) => e.id)).size === 4,
    `ids ${fileNew.map((e) => e.id).join(", ")} for 4 planted events`,
  );
  check(
    "every planted event is still there, unedited",
    JSON.stringify(fileNew.map(shape)) === JSON.stringify(planted(fileNew[0].id)),
    `${JSON.stringify(fileNew.map(shape))}`,
  );
  check(
    "the same collision renumbers identically on Postgres",
    JSON.stringify(postgresNew.map((e) => e.id)) === JSON.stringify(fileNew.map((e) => e.id)),
    `ids ${postgresNew.map((e) => e.id).join(", ")} on postgres vs ${fileNew.map((e) => e.id).join(", ")} on files`,
  );
  check(
    "the surviving rows are the same rows",
    JSON.stringify(postgresNew.map(shape)) === JSON.stringify(fileNew.map(shape)),
    `${postgresNew.length} rows compared by id, type, actor and payload`,
  );
  check(
    "events come back in id order, not in write order",
    fileCollide.rows.every((e, i) => i === 0 || e.id > fileCollide.rows[i - 1].id),
    `ids ${fileCollide.rows.map((e) => e.id).join(", ")} ascending across all ${fileCollide.rows.length}`,
  );

  // 3. clear() empties one table and touches nothing else.
  await files.clear("events");
  const afterFiles = await counts(files);
  await postgres.clear("events");
  const afterPostgres = await counts(postgres);
  check(
    "clear empties one table and leaves the other three alone",
    afterFiles.events === 0 && afterFiles.runs > 0 && afterFiles.sessions > 0 && afterFiles.scores > 0 &&
      JSON.stringify(afterFiles) === JSON.stringify(afterPostgres),
    `${JSON.stringify(afterFiles)} on files, ${JSON.stringify(afterPostgres)} on postgres`,
  );

  // The one difference between the backends, stated as a check: the same row
  // has the same FIELDS on both sides, and Postgres is free to list them in a
  // different order because jsonb does not keep the written order.
  const fileRun = (await fileStore().read("runs"))[0] as Row;
  const postgresRun = (await postgres.read("runs"))[0] as Row;
  check(
    "the same fields, whatever order the backend lists them in",
    JSON.stringify(Object.keys(fileRun).sort()) === JSON.stringify(Object.keys(postgresRun).sort()) &&
      fileRun.scenarioId === postgresRun.scenarioId,
    `files: ${Object.keys(fileRun).join(",")} | postgres: ${Object.keys(postgresRun).join(",")}`,
  );

  // 4. Rows handed over out of order. Nothing in the app writes events like
  //    this, which is exactly why it has to be planted: a read that trusts the
  //    order it was written in is a read that has only ever been lucky. The
  //    same three rows, in the same wrong order, on both backends.
  process.env.DELEGATE_DATA_DIR = join(root, "files-out-of-order");
  const shuffled = fileStore();
  await shuffled.upsert(
    "events",
    [eventRow(3, "record_scrolled", 2), eventRow(1, "record_opened", 0), eventRow(2, "record_scrolled", 1)],
    byId,
  );
  const shuffledIds = (await shuffled.read("events")).map((e) => e.id);
  await postgres.upsert(
    "events",
    [eventRow(3, "record_scrolled", 2), eventRow(1, "record_opened", 0), eventRow(2, "record_scrolled", 1)],
    byId,
  );
  const orderedIds = (await postgres.read("events")).map((e) => e.id);
  check(
    "rows written out of order still read back in id order",
    JSON.stringify(shuffledIds) === "[1,2,3]" && JSON.stringify(orderedIds) === "[1,2,3]",
    `files: ${JSON.stringify(shuffledIds)}, postgres: ${JSON.stringify(orderedIds)}`,
  );
  await shuffled.clear("events");
  await postgres.clear("events");

  // 4b. A table holding SOME orderable rows and some not. Check 4 plants rows
  //     written out of order, but every one of them has a numeric id, so both
  //     backends took their numeric path and the case where the two paths
  //     DISAGREE was never planted. It is reachable by hand — the store's files
  //     are documented as readable mid-workshop, and this is a documented
  //     swap-in point — and it disagreed: the file store returned the file's own
  //     order because not every row qualified, while Postgres's
  //     `(case when id is not null then id end) asc nulls last, seq asc` put the
  //     numeric ids first. On `sess-a, 9, sess-b, 2` that was `sess-a, 9,
  //     sess-b, 2` against `2, 9, sess-a, sess-b`.
  process.env.DELEGATE_DATA_DIR = join(root, "files-mixed-ids");
  const mixedFiles = fileStore();
  const mixedRows = [
    { id: "sess-a", note: "no numeric id, written first" },
    { id: 9, note: "numeric id 9, written second" },
    { id: "sess-b", note: "no numeric id, written third" },
    { id: 2, note: "numeric id 2, written fourth" },
  ];
  await mixedFiles.upsert("events", mixedRows as unknown as Row[], byId);
  await postgres.upsert("events", mixedRows as unknown as Row[], byId);
  const mixedFileIds = await mixedFiles.read("events");
  const mixedPgIds = await postgres.read("events");
  check(
    "a table of both orderable and unorderable rows reads the same on both backends",
    JSON.stringify(mixedFileIds.map((r) => r.id)) === JSON.stringify(mixedPgIds.map((r) => r.id)) &&
      JSON.stringify(mixedFileIds.map((r) => r.id)) === JSON.stringify([2, 9, "sess-a", "sess-b"]),
    `files: ${JSON.stringify(mixedFileIds.map((r) => r.id))}, postgres: ${JSON.stringify(mixedPgIds.map((r) => r.id))} — numeric ids first in id order, the rest in the order written`,
  );
  await mixedFiles.clear("events");
  await postgres.clear("events");

  // 4c. A caller must pick the LATEST RUN by the run's own key, not by its
  //     position in what the store handed back. This is the store-order
  //     distrust that check 4b is the mechanism for, aimed at a real caller:
  //     the facilitator grid derives a whole row — scenario, elapsed clock,
  //     submitted status, detection, and the copy-run-link URL — from
  //     `sessionRuns[sessionRuns.length - 1]`, which is a POSITION in an
  //     insertion-ordered list. Insertion order is a storage artifact: two runs
  //     started seconds apart whose flushes interleave give the EARLIER run the
  //     higher `seq`, and the grid then showed the participant on the scenario
  //     they had already left.
  //
  //     The rows are planted in the wrong order on purpose, and the assertion is
  //     that the key-based derivation and the positional one DISAGREE — so this
  //     fails if `latestRunFor` ever reaches for the array again.
  const interleaved = [
    { id: "run-1700000002000-bbbbbb", sessionId: "sess-order", scenarioId: "s5", startedAt: "2026-09-30T10:00:02.000Z" },
    { id: "run-1700000000000-aaaaaa", sessionId: "sess-order", scenarioId: "s1", startedAt: "2026-09-30T10:00:00.000Z" },
  ];
  const byPosition = interleaved.filter((r) => r.sessionId === "sess-order").slice(-1)[0];
  const byKey = latestRunFor(interleaved as unknown as ScenarioRun[], "sess-order");
  check(
    "the latest run is found by its startedAt, not by its position in the store's order",
    byPosition?.scenarioId === "s1" && byKey?.scenarioId === "s5",
    `position picks ${byPosition?.scenarioId} (started first), the key picks ${byKey?.scenarioId} (started last) — the grid derives its whole row from this`,
  );
  check(
    "…and it agrees whichever order the store returned those rows in",
    latestRunFor([...interleaved].reverse() as unknown as ScenarioRun[], "sess-order")?.id === byKey?.id &&
      latestRunFor(interleaved as unknown as ScenarioRun[], "sess-order")?.id === byKey?.id,
    "a positional pick would flip when the store's order did; this one cannot",
  );
  check(
    "two runs sharing a millisecond are separated by id, not by position",
    latestRunFor(
      [
        { id: "run-1700000000000-aaaaaa", sessionId: "sess-tie", scenarioId: "s1", startedAt: "2026-09-30T10:00:00.000Z" },
        { id: "run-1700000000000-bbbbbb", sessionId: "sess-tie", scenarioId: "s2", startedAt: "2026-09-30T10:00:00.000Z" },
      ] as unknown as ScenarioRun[],
      "sess-tie",
    )?.id === "run-1700000000000-bbbbbb",
    "startedAt ties on a millisecond, so the id decides — deterministically, on either backend",
  );
  check(
    "a session with no runs has no current run, rather than the last one in the table",
    latestRunFor(interleaved as unknown as ScenarioRun[], "sess-nobody") === undefined,
    "another session's runs are not this session's current run",
  );

  // 5. A different engine, later, against the same files. This is the whole
  //    reason the store exists, so it is checked on its own rather than as a
  //    footnote: a serverless invocation is not the process that wrote the row.
  //    On a remote engine this is the same claim with a sharper edge — a second
  //    client, a second connection, a second HTTP driver, the same database.
  const before = (await postgres.read("runs")).length;
  await engine.close();
  const reopened = await openTestEngine(join(root, "pg"));
  const cold = reopened.store;
  const after = (await cold.read("runs")).length;
  check(
    "rows outlive the engine that wrote them",
    after === before && after > 0,
    `${after} run rows read by a second engine — ${reopened.where}`,
  );

  // 6. `clearAll` — the reset tool's, and a stronger promise than `clear`:
  //    the whole store goes, and both backends answer the same.
  await files.clearAll();
  const afterFilesClear = await counts(files);
  await cold.clearAll();
  const afterPostgresClear = await counts(cold);
  const totalOf = (c: Record<TableName, number>): number => Object.values(c).reduce((sum, n) => sum + n, 0);
  check(
    "clearAll empties the whole store on both backends",
    totalOf(afterFilesClear) === 0 && totalOf(afterPostgresClear) === 0,
    `${totalOf(afterFilesClear)} rows left on files, ${totalOf(afterPostgresClear)} on postgres`,
  );
  await reopened.close();

  // 7. The guard that makes `clearAll` safe to state. A DATABASE_URL pointed
  //    at somebody else's database finds a `delegate_rows` already there —
  //    `create table if not exists` adopts it happily — and then the reset
  //    tool's `delete from delegate_rows` deletes rows this store never wrote.
  //    It needs an engine it may create and drop a table in, so it asks for a
  //    throwaway one even during a remote run.
  const foreign = await openTestEngine(join(root, "foreign"), { force: "local" });
  await foreign.query("create table delegate_rows (id bigint primary key, note text)");
  await foreign.query("insert into delegate_rows (id, note) values (1, 'a row this store did not write')");
  let refusal = "";
  try {
    await postgresStore(foreign.query).read("runs");
  } catch (error) {
    refusal = (error as Error).message;
  }
  const survivor = (await foreign.query("select count(*)::int as n from delegate_rows")).rows[0] as { n: number };
  check(
    "a same-named table this store did not write is refused, not adopted",
    refusal.includes("refusing to adopt it") && survivor.n === 1,
    refusal === ""
      ? `no refusal was raised, and ${survivor.n} foreign row(s) are now reachable`
      : `refused: "${refusal.slice(0, 80)}…" with the foreign row still there`,
  );
  await foreign.close();
}

/** The two refusals, each proved by the env state that must trigger it. */
async function refusals(): Promise<void> {
  const saved = { store: process.env.DELEGATE_STORE, url: process.env.DATABASE_URL, remote: process.env.DELEGATE_STORE_TEST_URL };
  try {
    delete process.env.DELEGATE_STORE;
    delete process.env.DATABASE_URL;
    check("no env var still means the file store", (await openStore()).kind === "file", "kind=file");

    process.env.DELEGATE_STORE = "postgres";
    let message = "";
    try {
      await openStore();
    } catch (error) {
      message = (error as Error).message;
    }
    check(
      "postgres without a DATABASE_URL refuses rather than falling back",
      message.includes("refusing rather than falling back"),
      message.split("\n")[0] || "no refusal was raised",
    );

    process.env.DELEGATE_STORE = "sqlite";
    message = "";
    try {
      await openStore();
    } catch (error) {
      message = (error as Error).message;
    }
    check(
      "a store this build does not know is refused",
      message.includes('knows "file" and "postgres"'),
      message || "no refusal was raised",
    );

    // ── The guard on the REMOTE leg. These gates call `clearAll`, so the one
    // piece of code that decides which database that is has to be as carefully
    // planted as the store's own refusals: a name with no test marker in it is
    // refused, one with a marker is allowed, and the printed description never
    // carries the password.
    let guard = "";
    try {
      assertDisposable("postgres://admin:hunter2@db.example.com:5432/delegate-production");
    } catch (error) {
      guard = (error as Error).message;
    }
    check(
      "a database with no disposable marker in its name is refused",
      guard.includes("refusing to run a destructive store gate") && guard.includes("delegate-production"),
      guard === "" ? "no refusal was raised" : guard.split(" — ")[0],
    );
    let allowed = "refused";
    try {
      assertDisposable("postgres://admin:hunter2@db.example.com:5432/delegate-ci");
    } catch (error) {
      allowed = (error as Error).message;
    }
    check(
      "a database named for CI is allowed through",
      allowed === "refused",
      allowed === "refused" ? "delegate-ci accepted" : allowed.split(" — ")[0],
    );
    const described = describeDatabase("postgres://admin:hunter2@db.example.com:5432/delegate-ci");
    check(
      "the description of a remote database carries no password",
      described === "db.example.com/delegate-ci",
      described,
    );
  } finally {
    if (saved.store === undefined) delete process.env.DELEGATE_STORE;
    else process.env.DELEGATE_STORE = saved.store;
    if (saved.url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved.url;
    if (saved.remote === undefined) delete process.env.DELEGATE_STORE_TEST_URL;
    else process.env.DELEGATE_STORE_TEST_URL = saved.remote;
  }
}

/** Where two snapshots first part company, so a failure is a place to look. */
function firstDifference(left: string, right: string): string {
  const a = left.split("\n");
  const b = right.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `line ${i + 1}: files have ${a[i] ?? "nothing"}, postgres has ${b[i] ?? "nothing"}`;
  }
  return "the snapshots differ in length only";
}

async function main(): Promise<number> {
  const root = mkdtempSync(join(tmpdir(), "delegate-store-gate-"));
  const savedDataDir = process.env.DELEGATE_DATA_DIR;
  try {
    await parity(root);
    await refusals();
  } finally {
    if (savedDataDir === undefined) delete process.env.DELEGATE_DATA_DIR;
    else process.env.DELEGATE_DATA_DIR = savedDataDir;
    rmSync(root, { recursive: true, force: true });
  }
  console.log(failures === 0 ? "\nall store-backend checks passed" : `\n${failures} store-backend check(s) FAILED`);
  return failures === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error("store-backend gate threw:", error);
    process.exit(1);
  },
);
