# Week-6 Alpha; Dry-Run Checklist

**Purpose:** rehearse the alpha before real participants touch it. A dry run that finds the friction is the point; every awkward step you discover here is one a participant won't stumble on later.

**Verification status (2026-09-15):** every box marked ✓* was mechanically verified on this date against the live server (preflight all-pass, the timed solo dry-run, the analytics dress rehearsal with a seeded 3-participant cohort, and a real browser walkthrough of the UI) and needs no re-run before participant #1. Unmarked boxes are the human checks; walk them on the day. If the server, build, or scenario files change after 2026-09-15, re-run `npm run alpha:preflight -- --url http://127.0.0.1:3000` instead of trusting the ✓* marks.

**Three passes, in order:**
1. **Self-review** (you, both scenarios, ~40 min); mechanical correctness
2. **Full dress** (you + one friendly colleague as pseudo-participant, ~75 min); human friction
3. **Day-of checks** (per participant, ~10 min); the go/no-go

Work top to bottom in each pass. Do not skip a red box.

---

## Pass 1; Self-review (mechanical correctness)

### §0 Environment preflight

```bash
cd delegate && npm run alpha:preflight -- --url http://127.0.0.1:3000
```

- [x] **C1** ✓* build current (`npm run build` if stale)
- [x] **C2** ✓* store state; reset performed after every probe (pristine now)
- [x] **C3** ✓* all gate suites pass (7 suites, 108 assertions)
- [x] **C4** ✓* all six scenario packages load
- [x] **C5** ✓* agent mode noted: **mock by decision (2026-09-15)**; the commented `ANTHROPIC_API_KEY` line in `.env.local` is a 10-character placeholder, not a key (a real one is ~100 chars, `sk-ant-api03-...`), and LG chose the deterministic mock for Week 6. Guard note added above the placeholder so it cannot be uncommented by accident. Server restarts pick up `.env.local` automatically; a real key later means restart + re-preflight (C5 → real agent, C7 proves the chat path live). **2026-09-16:** the flip path is now guarded end to end: a stub/placeholder key FAILS C5 (90-char length floor + sk-ant- shape check; boundary-proven: 89 chars fails, 90 passes) instead of silently claiming "real agent", and C7 sends one live chat turn so the server's own answer names the running agent; a server whose key never arrived is caught as a C7 MISMATCH with the restart fix. A bad key at runtime now answers a clean 502 with participant-safe copy, never a raw 500 mid-scenario.
- [x] **C6** ✓* `/delegate` 200, `/delegate/facilitator` 200, session API probe passes, tool gating verified (s1 offers `get_bank_feed`, never `post_entry`; re-verified per-window by the live harness)
- [x] **C6e** ✓* chunk integrity: every `/_next/static` asset referenced by `/delegate` actually loads (catches a production `next build` having clobbered the dev server's `.next` while it was live: pages 200 but the UI is dead, unhydrated buttons, 404 chunks. Fix is a dev-server restart, never a code change; see run-of-show §0 build guard)
- [x] N/A: real agent declined by decision (2026-09-15). `ANTHROPIC_API_KEY` would need to be a valid key set for the **server process** (the chat route reads it at request time; a shell export alone does nothing for an already-running server). The commented line in `.env.local` is a placeholder and stays commented
- [x] ✓* After preflight: `npm run alpha:reset -- --yes` (done; participant #1 starts from zero)

### §1 Scenario 1 self-run (~15 min, through the UI, as a participant would)

- [x] ✓* Session starts; name + scenario selection work (browser walkthrough)
- [x] ✓* Brief on screen matches `manifest.json` learnerBrief (exact 236-char brief rendered)
- [x] ✓* Ask the agent to do the recon, it responds and calls tools
- [x] ✓* Tool calls appear as readable rows in the chat pane (expandable "N tool calls" disclosure showing each call with args and row counts)
- [x] ✓* Open a record in the ERP viewer; works (JE chips in line-level GL view open entry detail) and the facilitator grid shows activity (`working` row plus a `record_opened` event in the log)
- [x] ✓* Deliberately submit a too-short answer; the ~40-word gate blocks it (UI disables below 40 words; the server now enforces it too: 422)
- [x] ✓* Submit a proper answer; screen shows detection status + debrief note, **no numeric score anywhere** (verified via the API path; scores persist server-side only)
- [x] ✓* Facilitator grid shows the row as `submitted` with detection status

### §2 Scenario 3 self-run

- [x] ✓* Second run starts in the same session (no reset between scenarios; resume model verified: one facilitator row per participant)
- [x] ✓* Ask the agent for the flux commentary; note its answer quotes the real summary numbers (~$570K, consulting up)
- [x] ✓* **Open `JE-S3-RECLASS` via the viewer or `get_record`**: the reclass is visible and readable (amount 280,000, accounts 6100/5020, memo CP-2026-01; the one `get_record`-away guarantee holds)
- [x] ✓* Submit an answer that names the reclass → `detected: true`
- [x] ✓* Submit (second run, fresh session) an answer that blames consulting only → `detected: false`

### §3 Reset + data integrity

- [x] ✓* `npm run alpha:reset -- --yes`; creates `snapshots/alpha/<timestamp>/` with all four JSON files + manifest
- [x] ✓* Manifest counts match what was produced (verified: 202-row rehearsal archive)
- [x] ✓* After reset: `/delegate/facilitator` shows zero rows; new session starts clean
- [x] ✓* **Archive recovery:** `npm run alpha:readout -- <cohortId> snapshots/alpha/<timestamp>` regenerates the readout from the archive (proven: rehearsal readout reproduced identical numbers from the archive; the live store stays untouched; this is also the post-alpha recovery path if you reset before generating the readout)

### §4 Cross-check scoring integrity (store-level, after §1–§2)

```bash
cat delegate/data/scores.json   # or the archived copy
```

- [x] ✓* Every score row has non-empty `evidenceEventIds` and a `justification` (12/12 in the rehearsal cohort)
- [x] ✓* `rubricVersion` is stamped on every row (v0.1-alpha)
- [x] ✓* Verification scores correlate with what was actually opened (opening JE detail moved verification 2 → 3; BUT see the known rubric caveat below)

---

## Pass 2; Full dress (with a pseudo-participant)

Run Pass 1's §0 preflight again (fresh state). Then run the **entire run-of-show card** end to end with your pseudo-participant; welcome script through debrief interview; while they:

- [ ] Work s1 genuinely (don't coach; let them fail naturally)
- [ ] Work s3 genuinely
- [ ] Fill the capture sheet as you observe

**Facilitator-side checks:**
- [x] ✓* You stayed silent through both scenarios (mechanical pass: no facilitator surface exists in the participant UI; the room-behavior check remains for Pass 2)
- [ ] Timing: did 15 min feel right per scenario? Where did time actually go? Note it. *(machine timing verified: full participant flow is ~1s of tool latency, s1 feed is 75 lines to scan; the human-feel check is still yours)*
- [ ] The debrief interview produced at least two concrete tool-friction findings

**Pseudo-participant debrief (meta):**
- [ ] Where did they hesitate at the UI?
- [ ] Did the three-prompt answer panel make sense without explanation?
- [ ] Did anything feel like a game rather than work? (Anything that does will change behavior; flag it)

**After:** capture findings into `docs/alpha-findings.md`, then `npm run alpha:reset -- --yes`.

### Go/no-go for real participants

| Gate | Bar | Status (2026-09-15) |
|---|---|---|
| Preflight | All checks pass | ✓ green (re-run on the day) |
| Pass 1 | Every box checked; s3 detection works both ways | ✓ mechanically verified (browser + API walkthrough; s3 detection true AND false) |
| Pass 2 | Zero facilitator interruptions; timing fits ~60 min/participant | **open** (needs the human dress rehearsal) |
| Agent | Real Anthropic agent confirmed live (or a deliberate, noted decision to run the mock) | **closed**: mock by decision (2026-09-15); placeholder in `.env.local` guarded, C5 warning expected and accepted. To flip later: real key into `.env.local`, restart the LaunchAgent, re-run preflight; C5 shows real agent only for a well-formed key and C7 proves the chat path live |
| Store | Reset performed after the dress rehearsal | ✓ done (analytics rehearsal archived + reset; pristine) |

Any red box: fix, re-run the affected pass, then decide.

---

## Pass 3; Day-of, per participant (~10 min before each)

1. [ ] `npm run alpha:preflight -- --url http://127.0.0.1:3000`; all green
2. [ ] `npm run alpha:reset -- --yes`; store starts empty **for this participant**
3. [ ] Facilitator grid open on your screen only; zero rows
4. [ ] Participant machine: `/delegate` loads; you have NOT started a session
5. [ ] Run-of-show card printed / open; capture sheet ready
6. [ ] Timer visible to you (not them)

---

## After the third participant

- [ ] Full cohort in the store (6 runs, 12+ scores, full event log)
- [ ] `npm run alpha:readout -- alpha-w6` → one-page cohort readout (works from the live store or any reset archive)
- [ ] All three capture sheets + interviews consolidated into `docs/alpha-findings.md`
- [ ] **Rubric-rewrite session with yourself** (budget: half a day). Start from: what did the scorers get wrong or miss? What did the interviews say the tool graded that it shouldn't, or didn't grade that it should? Stamp the result `rubric_version` v0.2; never compare v0.1 and v0.2 scores without flagging.
- [ ] **Week-6 gate call:** did at least one participant miss s3's defect and react with genuine surprise? Record the verdict, that gate decides whether s3 holds for the pilot (Week 9).
