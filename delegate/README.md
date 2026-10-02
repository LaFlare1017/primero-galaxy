# Delegate

A browser-based simulator where a finance professional practices **delegating work to an AI agent** against a fake ERP company. The scoring layer grades the *human's* behavior — did they specify well, verify, catch a planted defect, know when to refuse the tool — not the agent's output quality. Delivered as a facilitated workshop, not self-serve software.

Working name: **Delegate**. Engineering handoff: [`docs/delegate-handoff.md`](docs/delegate-handoff.md).

**Status: Weeks 1–8 build loop COMPLETE (v1 pre-alpha).** Substrate, all six scenario packages, runtime (agent loop + tools + event log), scoring v1 with evidence trails, the participant UI, the facilitator view, and the readout generator are built and gate-tested — see [Build status](#build-status).

---

## What this is (and is not)

One fake company (**Harbor Lane Instruments**), one ERPNext instance seeded and snapshotted, six scenarios run in a fixed narrative order, one agent on one model with a fixed tool set, event-logged sessions with deterministic + light model-graded scoring, a split-pane chat/ERP viewer, and a one-page readout.

Explicitly out of scope for v1 (no scaffolding, no TODOs): auth/multi-tenancy, LMS integration, self-serve purchase, any connection to a real ERP, agent frameworks, mobile, NetSuite skinning.

## The hard gate

**No agent, UI, or scoring code is written until the seeded ledger provably balances.** Trial balance across all three entities, intercompany nets to zero, bank reconciles to zero — before defects are applied, verified by an automated test that fails loudly otherwise. The defects in six scenarios are only detectable if the clean base is genuinely clean: accidental noise in the base makes every downstream score fiction.

## Why a deterministic seed generator

Transactions are never hand-written. A fixed-RNG generator produces the 13-month base (revenue with seasonality and the usage-based calibration component, AP, payroll, bank lines that mostly-but-not-perfectly match GL, intercompany across all three entities, FX revaluation), then scenario defects are applied as a separate, reproducible pass. Same seed → same company, same defect placement, every time.

## Build status

| Handoff milestone | Status |
|---|---|
| Weeks 1–2 substrate (entities, COA, base seed, balance test, snapshot/reset) | **Complete** (in-process; ERPNext emission pending — see deviations) |
| Gate: trial balance, IC nets to zero, bank reconciles, AR/AP tie-outs, inventory coherence, determinism | **PASSING** |
| Defect pass: s1 duplicate deposit, s2 FX-timing IC, s3 COGS reclass, s4 credit memos, s6 accrual drafts | **Complete, tested** |
| Week 3 — Scenario 3 defect design | **Complete** — cold-run gate proves the wrong answer is the honest summary read, not a hallucination |
| Week 4 — Agent + minimal loop | **Complete** — direct Anthropic tool-use + deterministic mock; scenarios 1 & 3 run end to end (Week-4 gate) |
| Week 5 — Scoring v1 | **Complete** — deterministic scorers, evidence trail on every score, opt-in model-graded spec/escalation, rubric_version stamped |
| Weeks 7–8 — Complete the set | **Complete** — all six scenario packages, Meridian contract **finalized v1.0 (LG review settled September 2026)**, post gating, answer panel, facilitator view, readout generator |
| Week 6 — Alpha (3 trusted people) | **Kit built — ready to run** (reset script, preflight, run-of-show, dry-run checklist, readout CLI; rubric rewrite expected — budget the week) |

### What exists now (`src/`)

**Seed substrate (`src/seed/`)**

| Module | Role |
|---|---|
| `rng.ts` | Mulberry32 seeded RNG; fixed seed → byte-identical runs |
| `types.ts` | Ledger primitives (entities, accounts, journal lines, invoices, bills, bank lines) |
| `profile.ts` | Harbor Lane constants: 3 entities, CAD functional currency for HLI Canada, 222-account COA with the three deliberate imperfections, month-end FX table + scenario-2 March rates |
| `patterns.ts` | Rent (with Jan escalator), payroll (accrual + settlement from 1020 with bank lines), subscriptions (6410/6455 split, auto-debit), utilities (seasonal), suspense drift (1999 → 2090) |
| `generators/revenue.ts` | AR invoices with seasonality + usage-based calibration component; equipment COGS relief (58%); HLS-LLC consignment sales (no inventory held, AP bill to parent) |
| `generators/ap.ts` | Inventory purchases (1200/1210), consumables, professional services with the **genuine Q1 2026 step-up (~140K→~240K/mo)**, opex bills, payments with bank lines |
| `generators/bank.ts` | Bank fees, interest, float (late-settling receipts booked to 2090 Customer Deposits — texture, not signal) |
| `generators/intercompany.ts` | Mirrored IC across all three pairs: shared services, contract services, inventory transfers |
| `generators/fx.ts` | Monthly CAD remeasurement of HLI-CA's USD 850K time deposit through 6710 |
| `generators/index.ts` | Orchestrator; `professionalServicesStepUp` option shapes the honest driver, never plants signal |
| `balance.ts` | Gate: trial balance ×3, entry balance, IC consolidated + pair mirrors, bank recon ×3, AR tie-out ×3, AP tie-out ×3, inventory non-negative ×6, revenue bands ×3 |
| `defects/scenario1.ts` | $18,450 deposit duplicated in the bank feed (3/12 legit + 3/14 resubmit with no in-window GL cash); two coincidental $18,450 invoices |
| `defects/scenario2.ts` | Meridian program IC charge booked at two defensible rates (3/15 vs 3/31) — variance exactly $4,182.00, tolerated by pair in the IC gate as a timing difference |
| `defects/scenario3.ts` | $280K reclass JE (3/31, 5020→6100) per "capitalization policy CP-2026-01" — merges with the genuine PS step-up in the 6100 summary line; invisible in summary, no cash/AP/AR footprint |
| `defects/scenario4.ts` | Three open credit memos totaling $67,000 (two customers falsely delinquent); credit memos are a distinct document type so the naive aging structurally excludes them |
| `defects/scenario6.ts` | The three accrual drafts the agent prepares (correct amounts); no defect — the post gate is the test |
| `test-balance.ts` | Gate test incl. determinism (FNV hash) + seed sensitivity |
| `test-defects.ts` | Defect-mode integrity + ground-truth presence per scenario + clean-base immutability |
| `build-base.ts` | CLI: build + verify, exit non-zero on gate failure |

Substrate volume: **3,058 JEs · 767 invoices · 1,431 bank lines · 222 accounts**.

**Runtime (`src/runtime/`)**

| Module | Role |
|---|---|
| `state.ts` | `ScenarioRuntime`: read-only window on the shared defect-mode ledger, scenario-gated tool availability, record-opening telemetry, propose/post gating (authorization lives in runtime state — the agent can never self-authorize) |
| `agent.ts` | One agent, one system prompt, one tool set. Direct Anthropic messages API with tool use (no framework) + deterministic honest-average mock for keyless runs |
| `events.ts` | Event log (prompt_sent, agent_response, tool_call, record_opened, answer_drafted/submitted, post_authorized) persisted through the store seam (`src/store/`), flushed once per request |
| `history.ts` | Rebuilds chat history from events for multi-turn context |
| `registry.ts` | Per-process run→runtime map (restart resilience documented) |
| `meridian-doc.ts` | The contract text `read_document` serves |
| `test-contract-integrity.ts` | Gate: the three Meridian copies (runtime-served, scenario package, review doc) stay substantively in sync — 14 section headings, 26 load-bearing terms, participant-facing cleanliness, normalized sections 1–9 byte-identical, review record intact. Any contract edit must land in all three copies or this fails |
| `test-week3-gate.ts` | Week-3 gate: cold-run proof that s3's wrong answer is summary-derived and the detection route is one `get_record` away |

**Scoring (`src/scoring/`)**

| Module | Role |
|---|---|
| `scorers.ts` | Specification (opening prompt only), context provision, verification (event signals), error interception (deterministic ground truth), escalation judgment (s5/s6 three-band + flagged behaviors). Model grading is opt-in, process-quality only. Verification is **actor-scoped** (rubric v0.2-alpha): every event carries `actor: participant \| agent`, and signals credit participant actions only, except the two agent-mediated signals (s5 contract read, s6 entry drafts) marked `actorScope: "any"` in their checklists |
| `scenario-loader.ts` | Reads manifest/checklist/debrief from `scenarios/` |
| `test-smoke-scenarios.ts` | Week-4 gate: verifier-vs-truster simulations across s1/s3/s5/s6, evidence-trail integrity, rubric stamping |

**Reporting (`src/report/`)**

| Module | Role |
|---|---|
| `readout.ts` | One-page cohort readout (§8): five-axis profile, three headline numbers, preventers-vs-detectors, flagged behaviors as counts. Individual attribution structurally excluded and tested |
| `score-store.ts` | Single writer for the `scores` table — `data/scores.json`, or Postgres |
| `test-readout.ts` | Readout aggregation + §8 no-attribution test |
| `src/alpha/` | **Week-6 alpha kit**: `reset-cohort.ts` (store reset through the store seam, so a database deployment resets too — workshop archive+wipe with manifest, `--target e2e` wipes the suite's scratch store, dry run by default), `preflight.ts` (C1–C7 environment checks incl. live server probe, tool-gating verification, C6e chunk-integrity detection of a clobbered dev `.next`, and C7 live-chat verification of which agent the server process is actually running), `readout-cli.ts` (readout from live store or archive) |

**Web UI (root Next.js app)**

| Route | Role |
|---|---|
| `/delegate` | Participant view: split-pane chat + read-only ERP viewer, timer, brief, three-prompt answer panel (40-word min), post-submit shows detection + debrief note only — never numeric scores |
| `/delegate/facilitator` | Live grid (auto-refresh): participant, current scenario, elapsed, status, detection-after-submit, flagged behaviors |
| `/api/delegate/session` | Start session + scenario run |
| `/api/delegate/chat` | One agentic turn; records learner post-authorization (s6) |
| `/api/delegate/view` | ERP viewer read actions; every record open is instrumented |
| `/api/delegate/submit` | Scores the run, persists with evidence, returns detection-only feedback |
| `/api/delegate/facilitator` | Facilitator grid data |

### Deviations from the handoff

- **In-process ledger instead of ERPNext.** Docker/ERPNext isn't available in this environment. The generator produces a typed in-memory ledger with the same entities/COA/periods; the gate runs against it now, and `emit.ts` (ERPNext REST) plus snapshot/reset verification remain the next substrate steps. Gate logic is written to be re-pointed at ERPNext without rewriting it.
- **Seed window ends in March, not January.** The handoff's "prior-year Jan through current Jan" contradicts its own scenarios: the close period under test is March and scenario 3 compares Q1 to Q4. A window ending in January has no March close and no comparable Q1-vs-Q4 pair. The window is 2025-03 → 2026-03 (13 months) so both scenarios have real data. Flagged per the handoff's own escalation rule; trivially changeable if the January window was deliberate.
- **Bank reconciliation** verifies settled lines tie to GL exactly (0 mismatches) with outstanding items reported, not a full statement-to-ledger match.
- **Seed data uses synthetic years 2025–2026** with March 2026 as the close period.
- **Scenario 2's variance was re-engineered to hit $4,182 exactly.** The handoff's "$4,182 variance on a CAD 12,600 charge" is arithmetically impossible with its own rates (12,600 × the 0.021 rate spread = $264.60). The mechanic is unchanged; the charge is CAD 139,400 at 0.769 (3/15) vs 0.739 (3/31) → variance exactly $4,182.00. Flagged, like the seed window.
- **Scenario 3's summary story is data-matched.** The genuine Q1 professional-services step-up is calibrated (~$30K/mo) so the 6100 summary line shows ~$386K QoQ (real ~$94K + the $280K reclass merged), and the learner brief quotes the real computed opex delta (~$570K). The brief must match what participants actually see in the tool.
- **JSON stores instead of Postgres.** Resolved: the four tables live behind `delegate/src/store/`, and `DELEGATE_STORE=postgres` (with a `DATABASE_URL`) swaps in the Postgres backend for a deployment, where a function's filesystem is neither writable nor shared with its neighbour. Unset — every laptop run, the CLI tools, the E2E suite — is still `data/{sessions,runs,events,scores}.json`, and the merge rules, event renumbering and score keying sit above the seam so both backends answer identically (`npm run test:store` plays the same workshop against both and compares the rows, on an in-process engine by default and against a **real** database when `DELEGATE_STORE_TEST_URL` is set — see above, because the driver is the one piece an in-process engine cannot exercise). The alpha kit reads through it too, so a deployed room is reset and inspected by the same commands: `alpha/reset-cohort.ts` archives a database's rows into the same four-file archive the readout already reads, and `alpha/preflight.ts`'s C2 asks the store rather than the filesystem — the file-reading version called a full room pristine, because on a database the file is never there. One thing the swap deliberately leaves alone: a run's `ScenarioRuntime` is rebuilt from the run row on a process that has not seen it (`resolveRuntime`), which is exact for the tool gate and the ledger but starts its per-run `openRecords` empty — harmless because the one scorer that reads them is already an `||` over the event log.
- **In-memory runtime registry.** A server restart mid-scenario rebuilds the runtime from the run record; open-record telemetry accumulated before the restart is lost (event log survives).

## Run it

```bash
cd delegate
npm install
npm run build            # typecheck + compile
npm test                 # ALL gates: balance, defects, contract-integrity, week-3, week-4 smoke, s5 cold-run, readout
npm run test:gate        # just the balance gate
npm run test:week3       # scenario-3 cold-run proof
npm run test:smoke       # end-to-end scored runs (also seeds cohort data)
npm run test:contract    # three Meridian copies in sync (sections, terms, prose deep-compare, review record)
npm run test:s5          # scenario-5 cold-run vs the FINALIZED contract: agent honesty + 3-band scorer + copy sync
npm run test:live        # s1+s3+s5 through the real Anthropic provider path (replay mode without a key)
npm run test:http        # all six scenarios through the LIVE HTTP API + hardening negatives (needs the dev server)
npm run test:store       # the store gate: the same workshop against JSON files AND a real Postgres engine, compared row by row
npm run test:cold        # a runtime that is not in memory: what a deployment resolves from the run row
```

#### The store gate against a real database

`npm run test:store` proves the store's **SQL** on an in-process Postgres (PGlite), which costs nothing and needs no database. It cannot prove the **adapter** above it — `neonQuery`, the HTTP driver that is the only reason a serverless function can hold a Postgres connection at all — because an in-process engine never goes near it. So the engine is a parameter:

```bash
DELEGATE_STORE_TEST_URL='postgres://…@ep-…-pooler.neon.tech/delegate-ci' npm run test:store
```

The same assertions, over the real driver. Three things about that variable are deliberate:

- It is **not** `DATABASE_URL`. A gate that changed substrate on the app's own configuration could be pointed at production by a deploy setting rather than by a deliberate act, and these gates call `clearAll`.
- The gate **refuses** any database whose name carries no `ci`/`test`/`ephemeral`/`scratch` marker, and names the database it was about to write to. `DELEGATE_STORE_TEST_ALLOW_ANY=1` overrides it for the person who is certain.
- A shared database is emptied **once per run**, at the start, by a named call the gate makes in the open — not by opening an engine, because the gate opens a *second* engine half way through to prove that rows outlive the connection that wrote them, and a wipe there would empty the subject of its own check. The gate asserts it started empty and prints what the previous run left behind.

One check cannot run against a shared database: the guard that refuses a `delegate_rows` table this store did not create, because the table it plants is named the same as the store's own. That is why the CI job runs the in-process leg **first and unconditionally** — a remote-only run would skip exactly the check that matters most about running against somebody's database.

CI runs both legs in the `store` job, and the remote leg gets a database of its own: each run **creates a Neon branch, runs the gate against it, and drops it**.

**One repository secret is needed. The other two the job used to need, it settles for itself.**

| variable | what it is |
|---|---|
| `NEON_API_KEY` | a Neon API key. It authorises the management calls and reaches no gate. **Required.** |
| `NEON_PROJECT_ID` | the project these branches live in. Optional — found or created by name. |
| `NEON_PARENT_BRANCH_ID` | a branch kept **empty** for CI to branch from (`br-…`). Optional — found or created. |

The first step of the job runs `scripts/neon-secrets.mjs --resolve`, which prints the two ids for `$GITHUB_ENV`. It makes **no call at all** when both are already set, so a repository that has them behaves exactly as it did before; when they are absent it finds the project and the branch by name, or creates each once. So the first run needs the key alone and the hundredth reuses what the first one made.

That step is skipped by the same `NEON_API_KEY != ''` condition as the rest of the remote leg, which is what makes a **fork** pull request safe: GitHub passes it no secrets, so nothing is ever created for one.

The key cannot be minted by a job. It is a credential, so creating one means handling an account password — that one step stays a person's. The two ids are not credentials; they are addresses, and a job holding the key can find or create them. That is the whole difference between one manual step and three.

The parent is named rather than defaulted to the project's default branch because a branch copies its parent's state: branching from a default branch holding a real room would hand the gate somebody's schema, and the run would fail on the store's own `delegate_rows` guard for a reason that has nothing to do with the driver.

To set all three as repository secrets instead — useful when you want the project pinned and visible rather than looked up by name — one command does it, creating the project and the empty branch only if they are not already there:

```bash
NEON_API_KEY=… npm run secrets:neon -- --apply
```

Without `--apply` it prints the plan and touches nothing, so it is safe to run to see what it would do. The key is read from the environment rather than a flag because a key on a command line lands in the shell history and in `ps` output; `gh secret set` reads each value from stdin, so it never appears in a command line either. Mint a key at **console.neon.tech → Account Settings → API keys** — the script will not do that for you, since it would mean handling your account password.

That covers each program. It does not cover the **job**, and a job is not the sum of its parts: it is the order the steps run in, the variables each one hands the next, and the exact command lines CI writes in YAML. A `--self-test` mode can pass while the workflow calls a program with a mode that no longer exists, and nothing in the doctor would notice — the same class of gap as transcribing a job into prose.

So the whole thing is walked as well, in order, as **processes**, against a console on localhost:

```bash
npm run store:rehearse     # all seven store-job steps, no account and no database
```

It is the `resolve` → `create` → `uri` → gate → `drop` → `report` sequence, each step a child process with `$GITHUB_ENV` handed forward the way GitHub hands it forward, and the run exits non-zero if any step does or if any of its eight claims fails. It runs in the `delegate` CI job on every push and every fork PR, and it is deliberately not in the `store` job: that job is gated on `NEON_API_KEY`, which this repository does not have, so a rehearsal there would never run — and a rehearsal that never runs is a comment.

Two things about it are load-bearing. The steps are **transcribed**, and a transcription rots, so the last check reads `.github/workflows/ci.yml` back and fails if it finds a Neon command line CI depends on that the rehearsal does not itself run: a renamed mode breaks the rehearsal rather than silently un-rehearsing the job. And the **remote gate leg cannot run** — the fake console answers the Neon management API and there is no Postgres behind the URI it hands back — so it is named as unreached in the output and in the exit report of every single run, rather than counted as covered. That leg is the reason the `store` job still exists and still goes red on a push until somebody mints a key; nothing in this rehearsal stands in for a database.

```bash
npm run secrets:neon -- --self-test      # the decisions, against a stubbed fetch
npm run secrets:neon -- --self-test-e2e  # the create path, over real HTTP
```

The second is the one that finds things the first cannot. `--self-test` proves the program chose to create; `--self-test-e2e` stands a fake console up on localhost — the same paths, the same status codes, a 409 on a duplicate name and a 400 on a malformed body — and runs the create against it, then runs it again to prove the second run creates nothing and lands on the same ids. A branch created with `{ name }` instead of `{ branch: { name } }` is a 400 from the real console and a cheerful 201 from a stub written by whoever got it wrong; that check is the difference.

That console is `scripts/neon-fake-console.mjs`, and the client both programs speak through is `scripts/neon-api.mjs` — one `neon()` call, one place a management request is made, so the programs and the thing pretending to be their server cannot drift apart about what a request looks like. Neither module knows about the other program: stand one up with `startFakeNeon({ readyAfter: 2 })`, talk to it with `neon(path, { base: fake.url })`, and `close()` it in a `finally`. It answers over real HTTP on loopback, so a child process can be pointed at it as easily as an in-process call, and `readyAfter` holds a branch in `current_state: init` for that many polls, which is the window no stub ever had.

A branch per run is what removed the queue. The job used to serialise itself against every other ref (`ci-store-database`, `cancel-in-progress: false`) because two runs sharing one database clear each other's rows and fail in a way that reads like a store bug, and cancelling mid-wipe left the next run a half-seeded room. With nothing shared there is nothing to serialise, so the group is gone and a superseded run is cancelled like any other.

Three details of the branch's life are load-bearing:

- It is created with `expires_at`, six hours out. GitHub does not run the later steps of a **cancelled** job, so a cancelled run never reaches the delete step; the expiry is what makes that safe. A step that cannot compute one refuses the run rather than creating a branch that quietly never cleans itself up.
- The job waits for the branch's `current_state` to be `ready` before resolving a connection string. A branch is created asynchronously, and querying its compute too early fails in a way that reads like a broken driver.
- The drop step is a belt to those braces: it runs even when the gate fails, and a drop that fails **warns** rather than failing a run whose verdict has already been reported.

Those three steps were ninety lines of shell inside the workflow until recently, which meant the lifecycle had never actually been executed: this repository has no `NEON_API_KEY`, so every run so far has skipped all of them. It is `scripts/neon-branch.mjs` now — `create`, `uri`, `drop` — and each of those bullets is a claim a check now makes rather than prose a reader has to trust:

```bash
node scripts/neon-branch.mjs --self-test      # the decisions, against a stub
node scripts/neon-branch.mjs --self-test-e2e  # the lifecycle, against a console on localhost
```

The end-to-end mode covers the one thing no stub ever modelled: a Neon branch is created with its compute still starting and answers `current_state: init` for a while, so the console it runs against holds the branch in `init` for its first three polls. Anything that connects the moment it is handed an id gets a database that is not there yet, and that window is the whole reason the poll exists. The last four checks run the program as a **process** — the three commands the workflow actually runs, with `$GITHUB_ENV` handed forward the way GitHub hands it forward — because a missed environment write is a `BRANCH_ID` the next step cannot find, and the answers leave through that wrapper rather than through the functions behind it. Both programs run from the repo doctor on every commit: 52 checks, no account, no network, no secret.

The gate still reads `DELEGATE_STORE_TEST_URL`, and the job still sets that variable to empty at the in-process leg so it is in-process whatever the job's environment says. Two rules keep the remote leg from being green without having run:

- The leg **asserts** the gate reported a remote engine. A gate that fell back to PGlite passes every check it makes while testing the wrong substrate, which is the one outcome this job exists to prevent.
- **No connection URI fails the job**, except on a fork pull request, where GitHub passes no secrets and a notice says the leg did not run. It is keyed on the URI rather than on the API key so that a failed create is reported as the failure it is, instead of reading as a run that never had credentials.

That last refusal is `node scripts/neon-branch.mjs report`, and it is the message this job goes red with on every push until somebody adds a Neon account — so it is a program rather than a string in the workflow, and it is checked. `neon-branch.mjs --self-test` asserts the four things that make it worth printing: that it names all three secrets, that it says **`NEON_API_KEY` alone** fixes it (the two ids are found or created by name, so telling somebody to mint three secrets when one is enough is how a correct refusal gets ignored), that it says what went *untested* rather than only what is missing, and that it points at the create step for the other case — a key that is set and whose call failed. It also pins the two severities: a fork pull request is a notice, a run that has a URI is not a refusal even on a fork, and the error goes to stderr as an annotation because stdout here is `$GITHUB_ENV`. Dropping either of the two id names from the message fails three checks, which is the point: the edit was invisible before.

One override is set for the remote leg: `DELEGATE_STORE_TEST_ALLOW_ANY=1`. The guard that refuses a database whose name carries no `ci`/`test` marker exists to stop a person pointing a destructive tool at a URL they typed, and the branch's database name is whatever the CI parent was created with — not ours to choose. A branch this run created a minute ago and drops a minute from now is disposable by **ownership**, which is a stronger guarantee than a name, and the guard stays armed for the local path above.

One coupling to know before bumping the driver. This workspace and the app are installed separately (CI runs `npm ci` and `npm --prefix delegate ci`), and both declare `@neondatabase/serverless` — the workspace because `neonQuery` imports it and the gate compiles and runs from `delegate/dist`, the app because that is what a deployed function runs. Two installs means two copies on disk, and Node resolves an import from the file's own directory upward, so the app's copy of `postgres-store.ts` picks up **this** workspace's `node_modules` first. The two ranges therefore have to move together: a root bump alone would leave the deployed function quietly on the older driver.

### Week-6 alpha kit

Everything needed to run the three-person alpha (scenarios 1 + 3, individually) — see `docs/alpha-run-of-show.md` (facilitator card) and `docs/alpha-dry-run.md` (rehearsal checklist). For the alpha as a **deployed** room — the Neon database, the deployment's environment variables, and the reset/readout operations on the day — see [`../RUNNING-THE-WORKSHOP.md`](../RUNNING-THE-WORKSHOP.md):

```bash
npm run alpha:preflight -- --url http://127.0.0.1:3000   # environment checks; C6 probes the live server + tool gating; C6e catches a clobbered dev .next

# Build guard: never run a root-level production build (`npm run build` / `next build`) while the
# dev server is live. It overwrites the shared .next; pages keep 200ing but chunks 404 and the UI
# is dead (unhydrated). Preflight C6e detects this; the fix is a dev-server restart, not code.
npm run alpha:reset -- --dry-run                         # plan only — what would be archived or wiped; changes nothing
npm run alpha:reset -- --yes                             # workshop: archive data/ → snapshots/alpha/<ts>/ with manifest, then wipe
npm run alpha:reset -- --target e2e --yes                # the E2E suite's scratch store (.next-e2e/delegate-data) — wiped, no archive
npm run alpha:reset -- --target all --dry-run            # both stores, planned
npm run alpha:readout -- <cohortId> [archiveDir]         # one-page cohort readout → docs/readout-<cohortId>.md
```

The reset covers **two stores**, and the only difference between them is what happens to the rows. The **workshop room** archives **everything** (sessions, runs, events, scores) with a row-count manifest *before* wiping — alpha data is rubric-rewrite raw material and is never destroyed. The **suite's scratch store** (`.next-e2e/delegate-data`, the `DELEGATE_DATA_DIR` `playwright.config.ts` sets) is wiped outright: it is regenerated with the build the suite runs against and belongs to no participant, so a reset that archived it would be a reset nobody runs. The readout works from the live store *or* any reset archive, so a post-alpha reset loses nothing. **Both targets go through the store seam, so a deployment is reset by the same command**: with `DELEGATE_STORE=postgres` the rows come from and go back to the database, and the archive is the same four JSON files either way — which is the point, because the archive is already an interchange format (`alpha:readout <cohortId> <dir>` reads one by pointing the file store at it), so a database's rows become a directory the existing tools read with no code that knows where they came from. The archive is a **local** directory whichever store the rows came from: the snapshot belongs on the machine that will read it, and a reset run from a laptop is how a deployed room is reset between participants. The facilitator grid and scorers read the store fresh per request, so a reset is complete — a running server picks the empty store up on its next request. In-memory runtimes go with it: a rebuilt one is `resolveRuntime`'s job across a process boundary, and a reset invalidates every run id handed out before it — which is exactly the stale `?watch=` link the facilitator console self-heals, and why a reset belongs *between* participants, never during one.

An unconfirmed invocation is a **dry run**: nothing is touched without `--yes`, and the plan prints either way, so the command is safe to run blind. On a database the plan names **which** one — host and database, never the password — because a reset run from a laptop against the wrong `DATABASE_URL` is otherwise invisible until it is done. `DELEGATE_DATA_DIR` (which the suite sets, and which points this tool at a scratch store in tests) is honoured by both file targets; if it names one directory for both, that directory is reset once, with the workshop's archive-then-wipe, and the same is true of a database named by both. A store that does not exist resets as a no-op rather than an error, so the second reset in a row is fine. From the repo root the same tool is `npm run reset:delegate -- --target e2e` (the root script builds the CLI first). `src/alpha/test-reset-store.ts` (`npm run test:reset`) holds the claims that make it safe, each proved by planting the state that must trigger it and against **both** backends: a dry run changes nothing (including no DELETE on a database), the workshop reset moves every row into the archive before wiping, the archive is re-read and counted so a short one refuses instead of resetting — with the partial directory removed rather than left where the next readout would misread it — and the two refusals that matter: `DELEGATE_STORE=postgres` with no `DATABASE_URL`, and `--target e2e` against a database, which is a no-op rather than a wipe of the wrong room.

### Live Anthropic runs

The provider path (gated tools → API call loop → budget guard → usage events → scoring) is verified end-to-end by `test:live`.

```bash
# Replay (no key, no cost): proves request shape, tool gating, budget guard, scoring, persistence
npm run test:live

# Live (real calls, real spend):
ANTHROPIC_API_KEY=sk-ant-... npm run test:live

# Live + rewrite the replay fixture from the real transcript:
RECORD_FIXTURE=1 ANTHROPIC_API_KEY=sk-ant-... npm run test:live
```

Per-turn budget guard (`DEFAULT_BUDGET`, `src/runtime/agent.ts`): 120s wall clock, 12 model calls, 8k output tokens. A trip returns a graceful partial reply and logs a `budget_exceeded` event — a runaway agent loop can never hang a workshop session or blow the bill. Optional env: `DELEGATE_MODEL` (default `claude-sonnet-4-5`), `ANTHROPIC_BASE_URL` (proxy/fixture). In replay mode, `read_document` is gated per-window (s1/s3 never offered it; s5 always) and s5's escalation scorer runs against the scripted uncaveated acceptance — the dimensions asserted per scenario are exactly what its checklist grades. Record mode is live-only by design: fixtures are never captured from canned fallbacks, so a stale fixture can never masquerade as a real model response.

Workshop UI (from the repo root, with the Next.js dev server running): `/delegate` for participants, `/delegate/facilitator` for the facilitator's screen. Set `ANTHROPIC_API_KEY` (+ optional `DELEGATE_MODEL`) to swap the mock agent for the real one — no code changes.

The same key also gates the **cold-process chat spec** (`e2e/delegate-cold-chat.spec.ts`), which is the only place a live model call proves something a mock cannot. The chat route is not just "resolve the run" across a process boundary: it reads every prior turn back for the model's context and appends four or five events before answering, and each of those is satisfied on a laptop by the in-memory registry. So the spec starts a server, takes a real turn, **kills that server**, and starts a second one — a different pid, empty `globalThis`, same store — then asks the new process what it was asked a moment ago. Only a process that recovered the transcript can answer, and that is the assertion. It used to be behind a key, because a mock answers from the prompt text and would have passed with no history in it at all — so the suite's most valuable assertion ran only on whichever machines had `ANTHROPIC_API_KEY`, which is none of CI's. It now runs everywhere: with no key, `e2e/fake-anthropic.ts` replays `e2e/fixtures/cold-chat-transcript.json` against a fake Anthropic on localhost, over the seam the agent already has (`AnthropicProvider` reads `ANTHROPIC_BASE_URL`), so the real provider, the real request shape and the real tool loop are all exercised and only the model's judgement is not. A key turns the replay into a live call and nothing is downgraded to make the replay easier. CI passes `ANTHROPIC_API_KEY` on the `test:e2e` **step** only, so no other spec and nothing the build touches can reach it. The restart machinery — free ports, `next start` on the suite's existing build, the stale-build refusal — is `e2e/cold-process.ts`, shared with `e2e/delegate-cold-process.spec.ts`, which proves the ledger and the score across the same boundary.

What makes the replay worth trusting is that the transcript is **matched against the request**, not handed out in order. The answer that carries "reconcile" is served only when the first turn's text is present in the request, which is only true if the restarted process read it back out of the store; lose the history and a fallback turn answers instead, saying exactly that it has nothing. A sequential fixture would answer the cold turn identically either way, so the spec would pass in the case it exists to catch. Verified by breaking `threadFromEvents` to recover nothing: the spec fails on its own original assertion, *the cold process answered from its own prompt rather than from the transcript*. The two turns the restart has to tell apart are the same question — "what did I just ask you to do?" — and only the presence of the first turn in the request decides which answer comes back.

The `E2E (Playwright)` job's **Say what did not run** step reads the same JSON report `flaky-report.mjs` does and names every test that did not run, with the reason it recorded. A key's *presence* is not the claim; what ran is, and only the report says what ran — a key that was set and the spec still skipped, expired or the wrong shape, is exactly the case a presence check walks past. Three verdicts rather than one: a skip with **no recorded reason fails**, because an unexplained skip is a hole nobody can see including whoever wrote it; a skip for want of a **secret fails** on an event that should have had one and is a notice on a fork pull request, where GitHub sends none at all; and any other skip is named and nothing more, since it was a decision somebody wrote down. The cold-process chat is still called out separately, because it is the one assertion a mock cannot fake and because "ran" does not say whether a live model or the transcript answered it.

### Workshop-day hardening (HTTP layer)

All four routes validate through `src/api/validate.ts`: bodies are capped at 64 KB, chat messages at 4,000 chars, answers at 20,000 chars, labels at 80/40; `scenarioId` is strictly one of s1–s6; viewer args must be a bounded flat object of scalars; `authorizePostEntryIds` is bounded and string-typed. Rejections are clean 4xx/413 (never 500s) with messages a facilitator can read aloud. Route-level state guards: a run is scored exactly once (double-submit → 409), a submitted run's transcript is closed to further chat (→ 409), and session resume requires the participant label to match (no cross-participant row hijacking).

`npm run test:http` drives ALL SIX scenarios through the live API exactly as the room will (session resume → brief → chat → viewer → submit → facilitator grid, including the s6 authorization path and the s3 catcher answer flipping the grid row to `detected=true` mid-sequence), then fires ten negative tests (bad ids, oversized payloads, malformed JSON, write-path tools in the viewer, non-scalar args) and asserts the one-row-per-participant resume model. Run it against a pristine store, reset afterwards.

### Enabling the real agent (zero-work drop-in)

The workshop server reads `ANTHROPIC_API_KEY` from the process environment at request time. Two supported ways to get it there:

1. **`.env.local` (repo root, recommended):** add the line `ANTHROPIC_API_KEY=sk-ant-...`, then restart the server (`launchctl bootout gui/$(id -u)/com.freebuff.delegate-preview; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.freebuff.delegate-preview.plist`). The LaunchAgent script sources `.env.local`, so the key reaches the launchd-spawned process — a shell export alone does not. The startup log prints only `anthropic_key=set` or `missing`, never the value.
2. **Harness (no server restart needed):** `ANTHROPIC_API_KEY=sk-ant-... npm run test:live` runs s1+s3+s5 against the real model in an isolated temp data dir — the workshop store is untouched. Verify s5's live properties: the model reads the contract via `read_document`, takes a confident defensible position **without self-refusing on control grounds** (the honest-average property the scenario depends on), and its JSON extraction ties to the contract (210000/14500/9000/36/10%).

Then confirm with the preflight: `npm run alpha:preflight -- --url http://127.0.0.1:3000` — C5 only reads `real Anthropic agent` for a well-formed key (a stub/placeholder FAILS the shape check instead of promising a live model that will 401), and C7 sends one real chat turn so the server's own response names the provider it is actually running: a server whose key never arrived shows as a C7 MISMATCH (shell has key, server says mock) with the LaunchAgent-restart fix. A rejected key at runtime answers the participant a clean 502 with retry-safe copy, never a raw 500 mid-scenario.

## Repository map

- `docs/delegate-handoff.md` — the full engineering handoff (scope, architecture, six scenarios, scoring, gates)
- `docs/url-state-audit.md` — the URL-state audit across Galaxy, FinBench and Delegate, with the delegate items annotated in place as they ship
- `docs/alpha-run-of-show.md` — facilitator card: per-participant sequence, scripts, interview questions, capture sheet
- `docs/alpha-dry-run.md` — three-pass rehearsal checklist (self-review → full dress → day-of) with go/no-go gates
- `docs/alpha-findings.md` — interview capture + rubric-rewrite candidates template (filled live during the alpha)
- `docs/alpha-debrief-slides.md` — group debrief slide content, mapped slide-by-slide to the readout sections
- `docs/meridian-labs-contract.md` — scenario 5 contract, **v1.0 final**: AMB-1 through AMB-5 confirmed in LG review (rulings recorded inline), header value itemized to tie to the schedules
- `src/seed/` — deterministic substrate + defect pass
- `src/runtime/` — agent loop, tools, event log, scenario runtime
- `src/scoring/` — scorers + scenario loader
- `src/report/` — cohort readout generator
- `src/alpha/` — Week-6 alpha kit (store reset, preflight, readout CLI)
- `scenarios/` — six scenario packages: manifest, checklist, debrief (+ the s5 contract document)
- `app/delegate/`, `app/api/delegate/` (repo root) — participant UI, facilitator view, API routes
