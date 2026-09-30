# Running the workshop (deployed)

For standing up the Delegate workshop somewhere other than a laptop, and for
the two operations that happen on the day: **resetting the room between
participants** and **reading the room back afterwards**.

If you only remember one thing: the room lives in a **Neon database**, not on
the server. Everything else in this document follows from that. A deployed
function's filesystem is read-only outside `/tmp` and is not the same machine as
its neighbour, so a session started on one request is gone by the next unless
the rows are in a database.

For the local version of all this, see [RUNNING-LOCALLY.md](RUNNING-LOCALLY.md).
The two are not alternatives: **you run the deployed room from a laptop.** The
reset tool talks to the database over the network and writes the archive to
*your* machine, which is the only place a snapshot can usefully live.

---

## 1. The database

### Create it

In the [Neon console](https://console.neon.tech): create a project, then a
branch. Leave the branch empty — the store creates its own table on the first
request, and an empty branch is what the CI job branches from as well.

Two settings worth knowing:

- **Region.** Anything close to the room. Each query is one HTTP round trip, so
  the distance is small but real.
- **Compute size.** The smallest one is fine. A workshop of three is a handful
  of queries a minute.

### The connection string

Click **Connect**, copy the **Postgres** connection string, and keep the
password out of anything that logs.

Either host works with this app. The driver speaks **HTTP** to Neon's `/sql`
endpoint, and both the direct host (`ep-…-region.aws.neon.tech`) and the pooled
host (`ep-…-pooler-…`) answer it — verified by dialling both and being refused
on credentials rather than on routing. This document uses the **direct** one,
because that is the host Neon documents for the serverless driver and because
the store issues its own DDL on first contact. Keep `?sslmode=require`.

The database name is whatever Neon created (`neondb` by default). Leave it.
The store puts **all four tables into one** — `delegate_rows` — with the
logical table named in a column, so there is nothing to create by hand and no
migration to run.

### What the store will not do

If a table named `delegate_rows` already exists in that database with a
different shape, the store **refuses to start** and says so. That is deliberate:
`create table if not exists` adopts whatever it finds, and a store that adopts
somebody else's table will also `DELETE` from it on the next reset. If you hit
that refusal, you are pointed at the wrong database — the error names the
columns it found.

---

## 2. Environment variables

Set these in the host's environment (Vercel: Project → Settings → Environment
Variables). Mark the ones that are secrets.

### Required for a deployment

| variable | value | if you get it wrong |
|---|---|---|
| `DELEGATE_STORE` | `postgres` | Unset means the four JSON files, which a serverless function cannot write and its neighbour cannot see. The app answers every request with a working page and loses every participant's run. |
| `DATABASE_URL` | the Neon connection string | `DELEGATE_STORE=postgres` with no `DATABASE_URL` **refuses to start** rather than falling back. That is the intended behaviour, not a bug to work around. |
| `ANTHROPIC_API_KEY` | your key | See `DELEGATE_AGENT` below — this is the pair that decides whether the agent is real. |
| `DELEGATE_AGENT` | `anthropic` | **Unset means the mock agent.** A mock turn reads like a real one, so a deployment missing this variable gives participants a convincing fake. Set it to `anthropic` with no key and the server throws instead — again, deliberately. |

### Set per workshop, not per deployment

| variable | what it is |
|---|---|
| `DELEGATE_COHORT_ID` | Names the cohort in every row the room creates — the alpha run-of-show uses `alpha-w6`. The readout groups by this, so set it before participants arrive; changing it afterwards splits one cohort in two. Falls back to `workshop-1`. |
| `DELEGATE_MODEL` | Defaults to `claude-sonnet-4-5`. |
| `DELEGATE_ONLY` | `1` turns every route that is not the workshop into a redirect to `/delegate`, which makes the deployment a room of three rather than the whole company. Off by default, so local dev, CI and the Playwright suite still see everything. |

### Never set on a deployment

| variable | why |
|---|---|
| `DELEGATE_STORE_TEST_URL` | The gate's own database. It is emptied with `clearAll` on sight. |
| `DELEGATE_STORE_TEST_ALLOW_ANY` | Disables the guard that refuses a database whose name does not say it is disposable. |
| `DELEGATE_DATA_DIR` / `DELEGATE_ARCHIVE_DIR` | Paths on a machine that is not yours. `DELEGATE_ARCHIVE_DIR` is useful **on the laptop** that runs the reset (section 4), useless on the deployment. |

---

## 3. Deploy, and check it before anyone arrives

Deploy as you would any Next app, then point the preflight at the live URL.
It is the same check the alpha run does, and it is the fastest way to learn
which of the four things above you got wrong:

```bash
npm --prefix delegate run build --silent
npm --prefix delegate run alpha:preflight -- --url https://your-deployment
```

It checks, in order: the build is current (C1), the store's state and whether a
reset is due (C2), all five gate suites (C3), the six scenario packages (C4),
which agent the **server** is actually using (C5/C6c), the live pages and the
tool gating (C6), and one real chat turn end to end (C7).

Then open the room yourself, start a scenario, send one prompt, and watch the
facilitator grid pick the participant up within four seconds. That last check is
not in the preflight: it is the one that proves the *deployed process* is
reading the database rather than a file.

---

## 4. Reset the room between participants

The one operation you will do on the day. **Dry run first, always** — the dry
run is not a formality, it is where you read which database you are about to
empty.

```bash
# 1. What is in there, and what would happen.
npm run reset:delegate -- --target workshop --dry-run

# 2. Do it.
npm run reset:delegate -- --target workshop --yes
```

`reset:delegate` builds the workspace first, so there is no separate build step
to forget. Add `--keep N` to change how many snapshots the archive keeps (ten by
default).

### What you should see

```
[reset] DRY RUN — no changes made. Store: postgres ep-adjacent-moss-123456.us-east-2.aws.neon.tech/neondb (postgres)
  sessions: 12 rows
  runs: 19 rows
  events: 340 rows
  scores: 9 rows
  would archive to /Users/you/…/snapshots/alpha/<timestamp> and then wipe (archived rows are never destroyed)
  retention: 4 snapshot(s) once this lands, at or under the cap of 10 — nothing to remove (97 kB on disk)
```

(The first line names the **database** — host and database, never the password.
Run against the local file store instead, it names a **path** there. Same tool,
same three lines below it.)

Then the real thing:

```
[reset] Archived 380 rows → /Users/you/…/snapshots/alpha/2026-09-30T16-33-42-651Z
[reset] Workshop store is pristine (380 rows, from postgres ep-adjacent-moss-123456.us-east-2.aws.neon.tech/neondb). In-memory runtimes for old runIds are invalid — start fresh sessions.
[reset] retention: removed 2 snapshot(s), freed 64 kB of 152 kB — 2026-09-28T…, 2026-09-29T…
```

Read three things in that output:

- **The store it named** — host and database, never the password. If this is not
  the database you meant, stop.
- **The archive path** — on *your* machine, under `snapshots/alpha/`. That is
  where the day's rows now live.
- **What retention did.** The last line says "nothing to remove" while the
  archive is under its cap, and names what it removed once it is over — oldest
  first, never the snapshot just written, and a snapshot it cannot delete is a
  warning rather than a failure. That line is also the whole reason the dry run
  is worth reading: it tells you what you are about to lose.

### If it refuses

The tool is built so that the destructive outcome it exists to prevent cannot
happen quietly, and a refusal is a **refusal**, not a partial reset:

- *"could not archive to … — Nothing was deleted"* — the archive could not be
  written whole (disk full, bad path). Every row is still in the database. Fix
  the path or free the space and run it again.
- *"a table named delegate_rows already exists with columns […]"* — the
  `DATABASE_URL` points at a database this store did not create. See section 1.
- *"holds 0 rows — already pristine"* — nothing to do. This is a success, and it
  is also what you get if you forgot `--yes`: without it the tool prints the
  plan and stops.

### Two flags worth knowing

- `--target e2e` is the Playwright suite's scratch store, not a workshop. Against
  a database it is a **no-op**: a database is not a scratch directory, and the
  tool says so rather than emptying the wrong room.
- `--target all` does both. Against a database the two names reach the same
  store, so it is reset **once** — you will not get two archives of the same
  room.

---

## 5. Read the archive back

An archive is a directory of the same four JSON files the file store uses, plus
a `manifest.json`. Nothing about it is database-shaped, which is the point: a
deployment's rows become a directory the existing tools read with no code that
knows where they came from.

```
snapshots/alpha/2026-09-30T14-02-11-113Z/
  sessions.json  runs.json  events.json  scores.json  manifest.json
```

`manifest.json` records when it was taken, why, and how many rows each file
holds — enough to tell two resets of the same room apart.

To generate the cohort readout from an archive instead of the live store:

```bash
npm --prefix delegate run alpha:readout -- alpha-w6 snapshots/alpha/2026-09-30T14-02-11-113Z
```

Add `--stdout` to print it instead of writing `docs/readout-<cohort>.md`. The
cohort id is the `DELEGATE_COHORT_ID` the room was using, and reading an
archive **touches nothing** — it does not restore, and it does not need the
database to be reachable.

The readout is cohort-level by construction: it carries no participant labels,
which is enforced in the export path and tested. Individual scores are revealed
in the room at submission and are not in that document.

---

## 6. When something is wrong

| symptom | what it is | what to do |
|---|---|---|
| The room is empty, or a participant's run vanished | The store fell back to files, so rows are in a function's `/tmp` | Check `DELEGATE_STORE=postgres` and `DATABASE_URL` are both set on the **deployment**, then reset the room (section 4) |
| Every scenario load throws `manifest not found` | The scenario briefs were not traced into the build | `next.config.js` carries the `outputFileTracingIncludes` entry; redeploy from a branch that has it |
| A chat turn 504s after ~10s | The turn is longer than the function's default | The chat route declares `maxDuration = 60`; redeploy from a branch that has it |
| The agent answers but it is obviously canned | `DELEGATE_AGENT` is unset, so the provider is the mock | Set `DELEGATE_AGENT=anthropic` and `ANTHROPIC_API_KEY` |
| Two cohorts in one readout | `DELEGATE_COHORT_ID` changed mid-workshop | It defaults to `workshop-1`; set it once, before participants arrive |
| The facilitator grid shows a row the API does not | Rare; a 4s poll can be one cycle behind | It resolves within four seconds. If it persists, compare `/api/delegate/facilitator` with the grid |
| `refusing to run a destructive store gate against database "…"` | The **CI** gate, not this run | Only set `DELEGATE_STORE_TEST_ALLOW_ANY=1` if you are certain; the name should say `ci`/`test`/`ephemeral`/`scratch` |

---

## 7. What this deployment is not

Worth knowing before the room fills up:

- **There is no authentication.** Anyone who reaches the URL can start a
  session. `DELEGATE_ONLY=1` narrows *what is deployed*; it does not narrow
  *who can use it*. Put it behind whatever fronts your workshop (Vercel
  protection, a shared password, a private network) if that matters.
- **The archive is not in the deployment.** It is written by the reset tool on
  the machine that runs it. If that laptop is the only copy, copy the day's
  snapshot somewhere else before you wipe the laptop.
- **The store is one table, and `clearAll` is one statement.** That is why a
  reset is all-or-nothing rather than half of each — but it also means a reset
  is not a soft delete. The archive is the only undo.
- **The deployment is the repo.** `DELEGATE_ONLY=1` is what makes that a room of
  three rather than the whole company, and it is off by default on purpose.

---

## Related

- [RUNNING-LOCALLY.md](RUNNING-LOCALLY.md) — the laptop version, and what to do
  when the dev server breaks.
- [`delegate/README.md`](delegate/README.md#the-store-gate-against-a-real-database)
  — the store seam, the gate that proves both backends answer alike, and the CI
  job that runs it against a real Neon branch per run.
