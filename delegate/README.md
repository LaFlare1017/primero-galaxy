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
| `events.ts` | Event log (prompt_sent, agent_response, tool_call, record_opened, answer_drafted/submitted, post_authorized) persisted as JSON |
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
| `score-store.ts` | Single writer for `data/scores.json` |
| `test-readout.ts` | Readout aggregation + §8 no-attribution test |
| `src/alpha/` | **Week-6 alpha kit**: `reset-cohort.ts` (store reset — workshop archive+wipe with manifest, `--target e2e` wipes the suite's scratch store, dry run by default), `preflight.ts` (C1–C7 environment checks incl. live server probe, tool-gating verification, C6e chunk-integrity detection of a clobbered dev `.next`, and C7 live-chat verification of which agent the server process is actually running), `readout-cli.ts` (readout from live store or archive) |

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
- **JSON stores instead of Postgres.** `data/{sessions,runs,events,scores}.json` for v1; the writer interface is the swap-in point for Postgres.
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
```

### Week-6 alpha kit

Everything needed to run the three-person alpha (scenarios 1 + 3, individually) — see `docs/alpha-run-of-show.md` (facilitator card) and `docs/alpha-dry-run.md` (rehearsal checklist):

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

The reset covers **two stores**, and the only difference between them is what happens to the rows. The **workshop room** (`delegate/data/`) archives **everything** (sessions, runs, events, scores) with a row-count manifest *before* wiping — alpha data is rubric-rewrite raw material and is never destroyed. The **suite's scratch store** (`.next-e2e/delegate-data`, the `DELEGATE_DATA_DIR` `playwright.config.ts` sets) is wiped outright: it is regenerated with the build the suite runs against and belongs to no participant, so a reset that archived it would be a reset nobody runs. The readout works from the live store *or* any reset archive, so a post-alpha reset loses nothing. Store state: `delegate/data/{sessions,runs,events,scores}.json`; the facilitator grid and scorers read them fresh per request, so a file-level reset is a complete reset — a running server picks the empty store up on its next request. In-memory runtimes go with it: they are per-process and keyed by runId, so a reset invalidates every run id handed out before it — which is exactly the stale `?watch=` link the facilitator console self-heals, and why a reset belongs *between* participants, never during one.

An unconfirmed invocation is a **dry run**: nothing is touched without `--yes`, and the plan prints either way, so the command is safe to run blind. `DELEGATE_DATA_DIR` (which the suite sets, and which points this tool at a scratch store in tests) is honoured by both targets; if it names one directory for both, that directory is reset once, with the workshop's archive-then-wipe. A store that does not exist resets as a no-op rather than an error, so the second reset in a row is fine. From the repo root the same tool is `npm run reset:delegate -- --target e2e` (the root script builds the CLI first). `src/alpha/test-reset-store.ts` (`npm run test:reset`) holds the two claims that make it safe: a dry run changes nothing, and the workshop reset moves every row into the archive before wiping.

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
