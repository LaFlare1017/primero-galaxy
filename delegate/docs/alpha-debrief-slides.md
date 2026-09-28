# Alpha debrief · slide content (cohort `alpha-w6`)

The group debrief after the three individual sessions. 20–25 minutes,
projected. Every slide is white background, black text, one idea; the same
visual language as the tool. Placeholders marked ⟦fill⟧ come from
`docs/readout-alpha-w6.md` (readout CLI) and `docs/alpha-findings.md`
(interview notes); fill them in the 10 minutes between participant 3 leaving
and the group sitting down.

Hard rules honored here (handoff §7/§8): individual numeric scores are never
shown or implied by ordering; flagged behaviors are named with counts, never
attributed; the "shape" is the team against the rubric, explicitly not a
leaderboard; the slide order reveals the s3 trap only after every
participant's own miss/detect outcome has already been shared with them
individually (run-of-show §5).

---

## Slide 1: Title

**Delegate; Alpha Debrief**
Week 6 · cohort alpha-w6 · 3 sessions · scenarios 1 & 3

Speaker note: "You were the test pilots; the *tool* is what we tested. Three
of you, two scenarios each, and everything you did is already aggregated into
the shape you'll see. Nobody's individual sheet is in this room."

---

## Slide 2: What we measured (and what we didn't)

Five axes, one per behavior:

| Axis icon | Axis | What it means |
|---|---|---|
| ⌨ | **Specification** | Did you direct the agent precisely; scope, period, entity? |
| 📄 | **Context provision** | Did you hand it the documents it needed? |
| 🔍 | **Verification** | Did you check anything yourself before deciding? |
| 🚨 | **Error interception** | Did you catch the planted defect? |
| 🧭 | **Escalation judgment** | Did you know when *not* to accept the agent's conclusion? |

Speaker note: "No axis is a personality test. Each one maps to a control
question your real close process has to answer."

---

## Slide 3: The shape (readout §1)

Show the five bars verbatim from `docs/readout-alpha-w6.md`:

```
Specification        ████████░░░░░░░░░░░░  ⟦fill⟧%
Context provision    (not applicable / ⟦fill⟧%)
Verification         ████████████░░░░░░░░  ⟦fill⟧%
Error interception   ██████░░░░░░░░░░░░░░  ⟦fill⟧%
Escalation judgment  (not applicable / ⟦fill⟧%)
```

> No cross-cohort comparison: fewer than five cohorts exist. This is your
> team against the rubric, not against other teams.

Speaker note: alpha n=3, so read bars as *signals*, not statistics. The bars
are the same ones every future cohort gets, which is why we can't show you a
ranking, there is nothing to rank against yet.

---

## Slide 4: Three headline numbers (readout §2)

| Metric | Result | Basis |
|---|---|---|
| Defect detection rate | ⟦fill⟧% | ⟦fill⟧ defect-scenario runs |
| Escalation rate (s5+s6) | n/a this cohort | s5/s6 not in the alpha sequence |
| Verified before submitting | ⟦fill⟧% | ⟦fill⟧ submitted runs |

Speaker note: verification is measured from what you *did* in the ERP; the
records you actually opened, not what you *said* you checked. That's why
it's the number we trust most.

---

## Slide 5: Scenario 1: the duplicated deposit

What was planted: a returned-then-resubmitted $18,450 ACH appearing twice in
the bank feed, with two open invoices of exactly that amount begging to
"explain" both lines.

- Caught: ⟦fill: n of 3⟧
- The tell: one bank line with **no GL counterpart**
- Plausible-looking answer the agent gave: *"reconciled cash is $412,881.90
  with no unreconciled items"*

Speaker note: the trap wasn't arithmetic; every number the agent quoted was
real. The trap was that the *matching logic looked satisfied*.

---

## Slide 6: Scenario 3: the invisible reclass

What was planted: one journal entry dated 3/31 (`JE-S3-RECLASS`) moving
$280,000 of service-delivery costs from COGS into opex (account 6100) under
"capitalization policy change CP-2026-01."

- Summary views showed it: opex up ~$570K, "professional services" soaring
- JE detail showed the truth, but only if someone opened it
- Caught: ⟦fill: n of 3⟧

Speaker note: this is the slide where, if you missed it, you already know,
we showed each of you your own result individually before this meeting. The
point of the silence earlier wasn't the gotcha; it's that the tool measures
whether the *process* surfaces what summaries hide.

---

## Slide 7: The process trace (why verification beats confidence)

Two participants can submit identical answers and score differently, because
the evidence trail records what was opened, when:

- record opens, tool calls, query patterns; timestamped, before submit
- ⟦fill: one concrete contrast from the alpha, e.g. "a catcher who opened
  JE-S3-RECLASS vs. a catcher who named it from memory"⟧

Speaker note: "What you checked" is not an essay question, it's telemetry.
That's the whole idea of the tool.

---

## Slide 8: Flagged behaviors (readout §4)

| Behavior | Count |
|---|---|
| ⟦e.g. accepted_agent_conclusion_uncaveated, not expected this cohort⟧ | ⟦fill⟧ |

Named behaviors, counts only; never attributed to a person.

Speaker note: flags exist because a *confident wrong answer* is the specific
failure mode delegation creates. If this table is empty, say that plainly
and move on; an empty flag table is a good slide.

---

## Slide 9: What YOU said (interview gold, anonymized)

3–5 verbatim lines from `alpha-findings.md` §1–2, e.g.:

> "⟦fill: quote about the answer panel changing what they checked⟧"
> "⟦fill: quote about what the agent would have to sound like to be distrusted⟧"
> "⟦fill: quote about something the tool wouldn't let them do⟧"

Speaker note: this is the part the rubric rewrite eats. Read the room's own
words back to it.

---

## Slide 10: What changes because of this week

1. **Rubric v0.2**: ⟦fill: the top 1–2 rewrite candidates from
   alpha-findings §3⟧
2. **Scenario changes**: ⟦fill or "none"⟧
3. **Next cohort**: Month-1 run, full scenario set, live agent

Speaker note: name the gate verdict explicitly: "we needed at least one of
you to genuinely miss the reclass, otherwise the scenario can't tell strong
delegators from weak ones. ⟦verdict sentence⟧"

---

## Slide 11: The control implication (readout §5, written live)

Facilitator fills this ON the slide, in the room, after the discussion, it's the paragraph the client reads and forwards:

> "This team's delegation risk is ______. The control that addresses it is
> ______. We will re-measure in ______."

Speaker note: do not pre-write it. If the group writes it, it's theirs.

---

## Slide 12: Close

**You were never the test. The tool was.**
Debrief questions → `docs/alpha-findings.md`
Team shape → `docs/readout-alpha-w6.md`

---

### Build notes

- One idea per slide, white/black/gray only; the two "caught: n of 3"
  numbers are the only data on slides 5–6 (counts, not attribution).
- Slides 3, 4, 8 paste directly from the readout; regenerate it AFTER the
  final reset-less participant and BEFORE the debrief.
- Keep slide 7's concrete contrast, it's the slide that sells the whole
  method. If nothing in the alpha produced a contrast, that is itself a
  rubric-rewrite finding for alpha-findings §3.
