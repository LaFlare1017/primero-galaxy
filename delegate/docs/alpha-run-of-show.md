# Week-6 Alpha; Facilitator Run-of-Show

**Format:** three trusted participants, **individually** (one at a time, you in the room or on the call).
**Scenarios:** s1 (bank reconciliation, 15 min) → s3 (Q1 flux commentary, 15 min). Do not reorder; s1 builds the confidence s3 breaks.
**Total per participant:** ~60 minutes.
**Alpha goals (in priority order):**
1. **Rubric-rewrite data**: you are testing the *scoring*, not the participants. Every confusing prompt, ambiguous answer field, or score that feels wrong is a finding. Capture sheet in §5.
2. **The Week-6 gate**: at least one participant genuinely misses scenario 3's defect and is genuinely surprised when told. If all three catch it, the trap is too easy, that is also a finding.

**Print this card.** Do not run the alpha from memory.

---

## 0. Before the first participant (T-1 day and T-30 min)

| When | Do | Command / check |
|---|---|---|
| T-1 day | Run preflight | `cd delegate && npm run alpha:preflight -- --url http://127.0.0.1:3000` |
| T-1 day | Confirm agent mode | Preflight C5: real Anthropic agent preferred for the alpha; mock is acceptable but note which was used; rubric conclusions may differ |
| T-1 day | Read both debriefs cold | `delegate/scenarios/01-bank-reconciliation/debrief.md`, `delegate/scenarios/03-q1-flux-commentary/debrief.md` |
| T-30 min | Re-run preflight | Same command; everything must pass |
| T-30 min | **Reset the cohort store** | `npm run alpha:reset -- --yes` (archives anything left, wipes for participant #1) |
| T-30 min | Open the facilitator grid on YOUR screen only | `/delegate/facilitator`; never projected, never shared |
| T-15 min | Participant machine: open `/delegate` | Confirm it loads; do NOT start a session; the participant types their own name |

**Environment note:** if the Next.js server was restarted since preflight, re-run the preflight with `--url` (C6 re-probes the session API). In-memory runtimes do not survive restarts mid-scenario; if that happens mid-session, restart the scenario from a fresh session; the event log preserves what happened.

**Build guard (preflight C6e):** never run a production build (`npm run build` / `next build` at the project root) while the dev server is live. The build overwrites the shared `.next` directory; the server keeps answering 200 for pages, but the JavaScript chunks those pages reference 404, so nothing hydrates: every button is dead and there is no error on screen. It looks like a UI bug; it is not. If preflight C6e fails, restart the dev server (`launchctl bootout gui/$(id -u)/com.freebuff.delegate-preview; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.freebuff.delegate-preview.plist`) and re-run preflight. Do not debug the UI.

---

## 1. Welcome (5 min); script

> "Thanks for doing this. You're going to work two short close tasks in a fake company using an AI assistant, exactly like you'd use a tool at your desk. **This is a test of the tool and its scoring, not of you.** The most useful thing you can do is think out loud and be honest when something feels off. Everything you do is logged so we can improve the tool; individual results are never shared with anyone."

Have them type their **real first name** (or a chosen alias; either is fine, it never leaves the machine) and start **Scenario 1**.

Then stop talking. Sit where you can see their screen but not hover over the keyboard.

---

## 2. Scenario 1; bank reconciliation (15 min)

**What they see:** the learner brief is on screen. They chat with the agent, can browse the ERP viewer, then fill the three-prompt answer panel (conclusion / what you checked / what's unsure; all three required, ~40-word minimum) and submit.

**Your job during:** silent observation. Note on the capture sheet (§5):

- Their **opening prompt verbatim**: what they asked for, in their words. Specification grading reads only this.
- Every time they **open a record** in the viewer (what + when relative to submitting).
- Any moment they **distrust the agent** or re-ask with more context.
- Exact time they start the answer panel vs. submit.

**Do NOT (at any point during a scenario):**
- Hint that something is wrong (or right) in the data
- Answer tool questions beyond "the agent can see the same ERP you can"
- React to their screen; no frowns, no raised eyebrows
- Say "interesting…" when they open a record

**Timer:** at 15 min, if not submitted, say once: "Wrap up in the next minute or two with whatever you have." If they hit 18 min, have them submit; the answer panel accepts partial work.

**After they submit** the screen shows only *defect detected: yes/no* and a debrief note. Do not elaborate. Move to §3.

---

## 3. Between scenarios (3 min); script

> "Before the next one; same drill, different task: the CFO wants two sentences on Q1 opex movement for a board deck. The brief is on screen. Same rules."

**Do not reset the store between scenarios**: both runs belong to the same session. Reset only between *participants*.

---

## 4. Scenario 3; Q1 flux commentary (15 min)

Same observation protocol. Two scenario-specific watch items:

- **Did they open JE detail unprompted?** (`JE-S3-RECLASS` or any journal-entry detail on 6100/5020.) This is the single behavior the whole scenario grades.
- **The moment they read the agent's commentary**: note whether they skim it and move on, or interrogate it. Skim-then-accept is the pattern the curriculum exists to break.

At 15 min: same wrap-up nudge. After submit, the screen shows detection status again.

---

## 5. Debrief interview (15 min); this is the rubric-rewrite data

Run it conversationally, but get all of these. Record answers on the capture sheet or straight into `docs/alpha-findings.md`.

**On scenario 1:**
1. Walk me through what you asked the agent first, and why.
2. (If they caught the duplicate:) what made you look there? (If they missed it:) at what point did you feel done; what convinced you it balanced?
3. Did the answer panel's three questions change what you checked?

**On scenario 3:**
4. Read me the sentence you submitted. Are you still happy with it? *(Then, if they missed it: open `JE-S3-RECLASS` on their screen. Let the silence happen. Do not explain for at least five seconds.)*
5. What would have made you open the journal entry without being asked?
6. Was the agent's commentary plausible to you? What would the agent have to sound like for you to distrust it?

**On the tool itself (rubric-rewrite gold):**
7. Anything in the prompts, briefs, or answer panel that was confusing, annoying, or felt like it was grading the wrong thing?
8. Did you ever want to do something the tool didn't let you?
9. On a scale of 1–10, how much did you trust the agent, and what moved that number?

**Then, and only then:** show them their detection outcomes and talk through what happened. Individual feedback is verbal, in-session, to the individual only. Never show numeric scores (there is nothing to show a participant anyway; scores live in the store for the readout).

---

## 6. Between participants

1. **Reset:** `npm run alpha:reset -- --yes`; archives the just-finished participant's data into `snapshots/alpha/<timestamp>/` with a manifest, wipes the store.
2. Close any leftover browser tabs (a stale session keeps an in-memory runtime alive).
3. Two minutes of your own notes **before** the next participant walks in; memory decays fast and the next session flushes it.

After participant #3: no reset yet; the store now holds the full alpha cohort (`cohortId: alpha-w6`). Generate the readout when you're ready:

```bash
cd delegate && npm run alpha:readout -- alpha-w6
```

(Works against the live store or any reset archive, so a post-alpha reset doesn't lose the readout; point it at `snapshots/alpha/<timestamp>`.)

The readout is cohort-level by design (no individual attribution; enforced in the export path and tested). Individual insight lives in your interview notes, not the artifact.

---

## 7. Capture sheet (one per participant)

```
Participant: ____________          Agent mode:  [ ] anthropic  [ ] mock
Started: ____:____                 Finished: ____:____

S1 opening prompt (verbatim):
________________________________________________________________
________________________________________________________________

S1: opened records?  which/when: __________________________________
S1: detected duplicate?  [ ] yes  [ ] no     Caught via (their words): ________

S3: opened JE detail unprompted?  [ ] yes  [ ] no
S3: agent commentary;  [ ] interrogated  [ ] skimmed/accepted
S3: detected reclass?  [ ] yes  [ ] no

Surprised at reveal (their reaction, verbatim if possible):
________________________________________________________________

Tool friction / rubric complaints:
________________________________________________________________

Trust score 1-10 (start → end): ____ → ____
Quote for the readout (optional, unattributed): ______________________
```

---

## 8. The do-not list (the whole card in six lines)

1. Never hint, confirm, or deny mid-scenario.
2. Never reveal or mention scores.
3. Never answer "am I right?"; "tell me why you think so, and put it in the answer panel."
4. Never let a scenario run past 18 minutes.
5. Never run two participants on one store; reset between, always.
6. Never treat the participant as the subject under test; the tool is. Say so in the welcome, mean it in the debrief.
