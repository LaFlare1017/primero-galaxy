# Delegate — Engineering Handoff

**For:** whichever coding agent picks this up next
**From:** LG, via planning session with Claude
**Purpose:** get from zero to a working scenario end-to-end. This doc is self-contained — do not assume access to prior conversation.

---

## 0. What you're building, in one paragraph

A browser-based simulator where a finance professional practices delegating work to an AI agent against a fake ERP company, with a scoring layer that grades the *human's* behavior (did they specify well, verify, catch a planted defect, know when to refuse the tool) rather than the agent's output quality. It's delivered as a facilitated workshop, not self-serve software. The tool is a prop for that workshop.

Working name: **Delegate**.

---

## 1. Scope boundaries — read this before writing any code

**Build for v1:**
- One fake company (Harbor Lane Instruments — spec in section 3)
- One ERPNext instance, seeded, snapshotted, resettable
- Six scenarios (full specs in section 4)
- One agent, one model, a fixed small tool set (section 5)
- Event-logged sessions with deterministic + light model-graded scoring (section 6)
- A split-pane chat/ERP-viewer UI (section 7)
- A single PDF/markdown readout artifact (section 8)

**Do not build in v1, do not scaffold for, do not leave TODOs suggesting later:**
- User accounts, auth, org hierarchy, multi-tenancy
- LMS integration, certificates, SCORM
- Self-serve purchase flow
- Any connection to a real ERP instance — sandbox only, ever
- Multi-agent orchestration, model routing, agent frameworks (LangChain/Mastra/etc.) — one direct model call with tool use is correct
- Mobile layout
- A NetSuite-skinned UI

If a task looks like it's drifting into the above, stop and flag it rather than proceeding.

**The one hard technical gate that blocks everything else:** the seeded ledger must provably balance before any agent, UI, or scoring code is written. Trial balance balances across all three entities, intercompany nets to zero, bank reconciles to zero — all before defects are applied. Write this as an automated test and do not proceed past it on a hunch.

---

## 2. System architecture

```
Browser (Next.js)
  ├─ Agent chat pane (left, streaming, tool calls shown collapsed)
  ├─ ERP viewer pane (right, read-only, tabbed: GL / transactions / documents / reports)
  └─ Answer panel (bottom: conclusion + what-checked + what-unsure, min ~40 words, required before submit)
       │ HTTP + SSE
Session server (Node/TypeScript)
  ├─ scenario loader (reads /scenarios/*/manifest.json)
  ├─ agent loop + tool implementations (calls Anthropic API directly, no framework)
  ├─ event log writer (every action timestamped)
  ├─ scoring engine (deterministic + model-graded, per section 6)
  ├─ snapshot reset (target: under 15 seconds)
  └─ readout generator (PDF/markdown from session data)
       │
  ┌────┴──────────────┐
  │                    │
ERPNext (Docker)   Anthropic API
seeded + snapshot   (single model, tool use)
       │
  Postgres (sessions, events, scores)
```

Everything runs on one machine for v1 — a laptop with Docker is sufficient production infrastructure for an in-person workshop of up to ~12 people. Do not build for hosted multi-user concurrency.

---

## 3. The fake company — Harbor Lane Instruments

### 3.1 Profile

| Attribute | Value |
|---|---|
| Name | Harbor Lane Instruments (HLI) |
| Business | Sells lab equipment plus a usage-based SaaS calibration service |
| Revenue | ~$41M TTM |
| Entities | HLI US (parent), HLI Canada (foreign sub, CAD functional currency), Harbor Lane Services LLC (US, services) |
| ERP | ERPNext |
| Fiscal year | Calendar |
| Data range | 13 months seeded (prior-year Jan through current Jan); the close period under test in scenarios is **March** |
| Volume | ~9,000 GL lines, ~1,400 AR invoices, ~900 AP bills, ~450 bank lines/month |

Design intent: three entities gives real intercompany; the Canadian sub gives real FX; the usage-based calibration service gives a legitimate ASC 606 judgment call without inventing anything exotic. Large enough that manual review is infeasible, small enough a controller can hold the whole company in their head.

### 3.2 Chart of accounts

~220 accounts. Seed three deliberate, unscored imperfections for realism (experienced controllers will notice them, which builds credibility in the room):

1. Two accounts that should be one: `6410 Software Subscriptions` and `6455 SaaS Tools`
2. A suspense account with a non-trivial balance: `1999 Clearing — Unreconciled`
3. Inconsistent naming across entities: US uses `Travel & Entertainment`, Canada uses `T&E`

### 3.3 Seed generator — build order

Do **not** hand-write transactions. Build a deterministic generator (fixed RNG seed, reproducible defect placement):

```
/seed
  profile.ts          # company constants, entity structure, COA
  patterns.ts         # recurring monthly patterns (rent, payroll, subscriptions)
  generators/
    revenue.ts         # invoices, seasonality, usage-based component
    ap.ts               # bills, some 3-way matched, some not
    payroll.ts
    bank.ts              # bank lines, mostly-but-not-perfectly matching GL
    intercompany.ts    # IC across all three entities
    fx.ts                    # rate table + revaluation entries
  defects/            # applied AFTER clean base generation — see section 4
  emit.ts             # writes to ERPNext via REST API
  snapshot.sh         # pg_dump post-seed, for fast reset
```

**Build order matters:** generate a fully clean, fully balancing base first. Run the balance-verification test. Only after it passes, apply the six scenario defects as a separate pass. If the base data has accidental noise, you can't tell a real detection from a lucky guess, and every downstream score is fiction.

Realistic non-defect noise is fine and good: typo'd vendor names, a few legitimately late-posted entries, one vendor paid from two different accounts. That's texture. Don't let it become signal.

### 3.4 Snapshot / reset

```bash
docker exec erpnext-db pg_dump -U postgres erpnext > snapshots/harbor-lane-v1.sql
./scripts/reset.sh harbor-lane-v1   # target: <15s
```

Test reset speed in week 1, before building anything on top of it. A slow reset breaks a live workshop.

---

## 4. The six scenarios

Each scenario is a self-contained directory:

```
/scenarios/NN-name/
  manifest.json    # title, learner brief, time budget, entity, period
  defect.ts        # what's seeded, where, and why it's detectable
  checklist.json   # specification items, verification signals, detection criteria
  debrief.md        # facilitator notes for the group debrief
```

Run in this exact order — it's a deliberate narrative arc (build confidence, break it, rebuild a specific habit, then reframe the whole exercise around refusal). Do not reorder.

### Scenario 1 — Reconcile the March operating bank account
**Skills:** specification, verification. **Time:** 15 min.
**Defect:** a single $18,450 customer deposit appears twice in the bank feed (3/12 and 3/14, a returned-then-resubmitted ACH). Two open AR invoices happen to be $18,450 each. The agent will confidently match both deposits to both invoices and report a clean reconciliation — the recon *balances*, so nothing looks wrong on the surface.
**Detection:** flags the duplicate, or specifically questions one of the two $18,450 items.

### Scenario 2 — Why doesn't intercompany balance?
**Skills:** context provision, iterative narrowing. **Time:** 20 min.
**Defect:** an IC charge booked in USD at the 3/31 rate on the US side, and in CAD at the 3/15 transaction-date rate on the Canadian side. Both entries are individually defensible. The variance ($4,182) is pure FX timing. The FX rate table is a separate tool (`get_fx_rates`) the agent will not reach for unless the learner points it there.
**Detection:** identifies FX timing as root cause. Partial credit for identifying the rate mismatch without articulating why.

### Scenario 3 — Draft Q1 flux commentary (centerpiece scenario)
**Skills:** verification, over-trust. **Time:** 15 min.
**Defect:** opex is up $312K QoQ. The obvious, summary-visible driver is a genuine $94K increase in `6100 Professional Services`. The actual dominant driver is a $280K reclass of costs from COGS into opex per a documented capitalization policy change — invisible unless someone opens JE detail. The agent, given only summary data, writes fluent, well-structured, board-ready commentary blaming consulting spend. It's not hallucinated — it's an honest, reasonable read of incomplete context, which is exactly why it's hard to catch.
**Engineering risk — the hardest part of this entire build:** the wrong answer must be genuinely reasonable given the data actually available in the summary view, not a hallucination. If you can't make this work (i.e., the agent's wrong answer is obviously fabricated rather than honestly-incomplete), flag it back rather than shipping a weak version — a detectable trick discredits the other five scenarios in front of an experienced audience.
**Detection:** names the reclass as a material driver in the submitted answer, before the debrief. Expected catch rate across a real cohort: 15–25%. Track this number.

### Scenario 4 — AR aging report by entity
**Skills:** specification. **Time:** 10 min.
**Defect:** the agent's first query excludes credit memos (naive filter on invoice document type, because the learner didn't specify). Three customers have material open credits; aging overstates receivables by $67K; two customers falsely appear delinquent.
**Detection:** either specified credit-memo treatment upfront (prevention) or caught the exclusion on review (detection) — both score full credit, but track which one, since the split itself is a useful readout finding.

### Scenario 5 — Revenue recognition on the Meridian Labs contract
**Skills:** escalation judgment. **Time:** 15 min. **No defect is planted — this is deliberate.**
**Setup:** a genuinely ambiguous ASC 606 contract — equipment sale + 3-year calibration service + usage-based component with a minimum commitment and a mid-term repricing clause. Reasonable practitioners can disagree on the PO split and on whether the usage component is constrained variable consideration. **This contract must be written properly, as a real document with real ambiguity — not summarized or stubbed. Flag back for review before scoring logic is built against it, since the quality of the contract text is the whole scenario.**
**Correct behavior:** use the agent to extract and summarize contract terms, then explicitly decline to accept its recognition conclusion and escalate to human technical-accounting judgment.
**Scoring:** full credit = used agent for extraction, explicitly refused/escalated the conclusion. Partial = expressed doubt but accepted anyway. Zero = accepted the agent's conclusion outright. **Flag separately and by name in the readout** (not scored numerically, called out as a named behavior): submitted the agent's conclusion with no caveat at all — this is the single highest-risk behavior the tool measures.
**Design note:** configure the agent to give a confident, well-reasoned, plausible-but-not-necessarily-correct ASC 606 answer. It must not self-refuse or hedge — the human has to be the one who draws the line.

### Scenario 6 — Post the March accruals
**Skills:** escalation, control awareness. **Time:** 10 min.
**Setup:** the agent has a real `post_entry` tool in this scenario only (nowhere else). The accruals it computes are substantively correct.
**Correct behavior:** have the agent prepare the entries, review them, and refuse to let it post — segregation of duties, regardless of whether the numbers are right.
**Scoring:** full = prepared, reviewed, refused post, articulated why. Partial = reviewed but let it post anyway. Zero = instructed post without review. Flagged (named behavior, like scenario 5) = posted with no review at all.

---

## 5. Agent configuration

One model. One system prompt. One tool set. No framework, no routing, no sub-agents.

**Design principle — "honest-average":** the agent must be a competent, unremarkable colleague, not impressive and not obviously bad. Too good and participants stop verifying anything (defeats the whole exercise). Too bad and they dismiss the tool.

**System prompt constraints:**
- Confident register, like a staff accountant — never volunteers uncertainty unless directly asked
- Never self-refuses on control grounds — scenarios 5 and 6 depend entirely on the *human* drawing that line, not the agent
- Shows its work only when asked, never by default

### Tool set

| Tool | Available in | Notes |
|---|---|---|
| `query_gl` | all | SQL-like query over the ledger |
| `get_record` | all | fetch one document by type + id |
| `list_records` | all | filtered list |
| `read_document` | scenario 5 | the Meridian Labs contract PDF |
| `get_bank_feed` | scenario 1 | March bank lines |
| `get_fx_rates` | scenario 2 | exists, but never volunteered unprompted — reachability is the whole mechanic |
| `propose_entry` | scenario 6 | drafts, never posts |
| `post_entry` | scenario 6 only | actually writes — gated behind explicit learner instruction |

Cost is a non-issue: ~30–60K tokens per scenario per participant, under $30 total API spend for a full 12-person workshop.

---

## 6. Scoring engine

### 6.1 Data model

```sql
sessions      (id, participant_label, cohort_id, started_at, completed_at)
scenario_runs (id, session_id, scenario_id, started_at, submitted_at, answer_text)
events        (id, run_id, ts, type, payload)
scores        (id, run_id, dimension, value, max, evidence_event_ids[], justification, rubric_version)
```

`events.type`: `prompt_sent`, `agent_response`, `tool_call`, `record_opened`, `record_scrolled`, `answer_drafted`, `answer_submitted`, `reset`.

`record_opened` is the highest-value event in the whole system — verification is inferred almost entirely from what the participant looked at and when. Instrument the ERP viewer pane carefully; don't skimp on this.

### 6.2 Dimensions and grading method

| Dimension | Method |
|---|---|
| Specification | Model-graded against the scenario's checklist. Grade only the opening prompt — later clarification is a different skill, don't conflate. |
| Context provision | Deterministic — did the required context reach the agent, by any route |
| Verification | Deterministic — event-log signals against a per-scenario list |
| Error interception | Deterministic ground-truth check + light model grading of the free-text answer |
| Escalation judgment | Model-graded, scenarios 5 and 6 only, three-band rubric |

**Hard rule:** the model never grades outcome correctness — that's always deterministic against seeded ground truth. The model only ever grades process quality (was the prompt well-specified, was the escalation reasoning sound). Don't blur this line.

### 6.3 Evidence trail — build this in the first scoring commit, not later

Every score row needs `evidence_event_ids` and a one-line `justification`, e.g.:

```
Verification: 1/4
  "Submitted at 11:42 after reading only the agent's summary.
   No GL detail or journal entry was opened during the run."
   → events 4471, 4488
```

This is the credibility mechanism for the whole tool. The first time a participant disputes a score in front of their peers and there's no transcript-backed justification, the tool loses the room. Not optional, not a v2 feature.

### 6.4 Rubric versioning

Stamp every score with `rubric_version`. The rubric *will* be rewritten after the first alpha (budget for it explicitly, see section 9). Never compare scores across a rubric version change without flagging it.

---

## 7. Frontend

Desktop only, 1440px design target, no mobile layout.

- **Left 40%:** agent chat, streaming, tool calls shown as collapsed/expandable rows (reading what the agent actually did is part of the skill being tested)
- **Right 60%:** ERP viewer, read-only, tabbed (GL / transactions / documents / reports), every panel-open event instrumented
- **Bottom bar:** timer, collapsible scenario brief, answer panel

**Answer panel:** free text, ~40 word minimum, three required prompts:
1. What did you conclude?
2. What did you check?
3. What are you unsure about?

Question 3 does real work — it credits people who noticed something they couldn't resolve, and it's the best raw material for the group debrief.

**Post-submit:** show only whether the defect was detected, plus the debrief note. **Do not show the numeric score at this point** — a visible running score turns the exercise into a game and changes behavior on later scenarios. Scores are revealed together at the end, in the facilitator-led group debrief.

**Facilitator view (separate URL, kept open on the facilitator's own screen):** live grid of participants, current scenario, elapsed time, detection status per participant. Used to know when to advance the room and who to check in with.

---

## 8. Readout artifact

One-page PDF/markdown, generated from session data, structured as:

1. **The shape** — five-axis profile (radar or bar) for the team, against the cross-cohort distribution once n≥5 cohorts exist; before that, show only the raw team profile and say so explicitly
2. **Three headline numbers** — defect detection rate, escalation rate on scenarios 5+6, percentage who verified before submitting
3. **Preventers vs. detectors** (from scenario 4) — teams that prevent are mature, teams that only detect are competent, teams that do neither have a real control gap
4. **Flagged behaviors** — named, count-only, no individual attribution (e.g. "3 of 11 participants instructed the agent to post journal entries without review")
5. **Control implication** — one paragraph, written by the facilitator, not generated. This is the part the client actually reads and forwards.

**Never attribute individual scores in the client-facing deliverable.** Individual feedback is verbal, in-session, to the individual only. The moment this becomes a performance-management artifact, participants start gaming it and the data goes bad. This constraint should be enforced in code (no per-person breakdown in the export path), not just policy.

---

## 9. Build sequence with gates

Don't skip a gate to keep momentum — each one exists because the plan's risk register flagged a specific way skipping it burns the following weeks.

**Weeks 1–2 — Substrate**
ERPNext in Docker, three entities, COA with the three seeded imperfections, base seed generator (revenue + bank first), balance-verification test passing, snapshot/reset under 15s.
*Gate: trial balance balances, IC nets to zero, bank reconciles to zero, reset is fast. Nothing below this line starts before this gate passes.*

**Week 3 — Scenario 3 defect design**
This is the highest-risk single week in the project. Iterate until the agent's wrong commentary is genuinely reasonable given available context, not a hallucination.
*Gate: you can run it yourself, cold, and see exactly how someone would miss it.*

**Week 4 — Agent + minimal loop**
Agent config, `query_gl` / `get_record` / `list_records` / `get_bank_feed`, bare split-pane UI, event logging live from day one.
*Gate: scenarios 1 and 3 run end to end, event log captures the session.*

**Week 5 — Scoring v1**
Data model, deterministic scorers, evidence trail, model-graded specification scoring.
*Gate: every score has a defensible, transcript-backed justification.*

**Week 6 — Alpha, three trusted people, individually**
Scenarios 1 and 3 only. Expect to rewrite the rubric — budget the whole week for it.
*Gate: at least one alpha participant misses scenario 3's defect and is genuinely surprised when told.*

**Weeks 7–8 — Complete the set**
Scenarios 2, 4, 5, 6. Write the Meridian Labs contract properly. `propose_entry`/`post_entry` gating. Answer panel, timer, facilitator view, readout generator.
*Gate: full six-scenario run, self-administered, under 100 minutes end to end.*

**Week 9 — Pilot 1, free, in person, friendly client**
Facilitate personally. Free readout. Watch for where the room stalls.
*Gate: the live debrief produces a visible reaction from the room.*

**Week 10 — Pilot 2 + productionize**
Second friendly client, incorporate pilot 1 fixes, lock rubric as v1, write the sell sheet.
*Gate: ready to quote a paying engagement.*

---

## 10. Immediate first three tasks, in order

1. Docker Compose for ERPNext, three entities configured
2. `profile.ts` + COA definition, including the three seeded imperfections
3. Base seed generator (start with revenue + bank only) with the balance-verification test written alongside it, not after

Do not write agent code, UI code, or scoring code before task 3's test passes.

---

## 11. Open items that need a human decision, not an agent decision

- Final wording of the Meridian Labs contract (scenario 5) — needs LG's ASC 606 judgment, don't auto-generate boilerplate contract language and call it done
- Whether the readout is PDF, markdown, or both for pilot 1
- Exact pricing tiers are set (see below) but not yet quoted to anyone — don't build a self-serve payment flow on the assumption they will be

## 12. Pricing context (for reference only, not a build task)

Team workshop $7,500 / portfolio assessment $3,500 per portco / portfolio program $25–40K. Anchored to a $300/hr advisory rate, not training-market rates. Self-serve seats are explicitly deferred, not year one.
