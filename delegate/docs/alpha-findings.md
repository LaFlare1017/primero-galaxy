# Alpha findings · Week 6 (cohort `alpha-w6`)

Filled in live during the per-participant debrief interviews (run-of-show §5)
and immediately after the final participant. This document is the raw material
for the rubric rewrite and the Week-6 gate verdict. Individual answers stay in
this file and never enter the readout.

**Participants (3):** _____________ · _____________ · _____________
**Dates:** _____________ · **Agent mode:** mock / live Anthropic

---

## 1. Per-participant capture

### Participant 1; Scenario 1 (bank recon)

- First request to the agent (verbatim-ish):
- Caught the duplicate deposit? yes / no; what convinced them it balanced:
- Did the three answer prompts change what they checked? how:
- Anything confusing / annoying / graded the wrong thing:
- Anything they wanted to do that the tool didn't let them:
- Trust 1–10 (start → end), and what moved it:

### Participant 1; Scenario 3 (Q1 flux)

- The sentence they submitted (verbatim):
- Caught the reclass? yes / no; if no, what the 5-second silence looked like:
- What would have made them open the journal entry unprompted:
- Was the agent's commentary plausible? what would make the agent distrusted:
- Trust 1–10:

*(repeat the block for participants 2 and 3)*

---

## 2. Tool-behavior observations (facilitator notes, not interview)

- Places a participant hesitated on the UI (unlabeled control, unclear pane):
- Places the agent's answer shaped their next question (anchoring):
- Timer behavior: did 15/15 minutes feel right?
- 40-word gate: did it force reflection or provoke word-padding?
- Any telemetry gaps noticed (something they clearly did that the grid didn't show):

---

## 3. Rubric-rewrite candidates

For each, record the *behavior observed* and the *rubric rule that missed or
mis-scored it*. This is the input to the v0.2 rewrite session.

| # | Observed behavior | Current rubric treatment | Rewrite candidate |
|---|---|---|---|
| 1 | Participant never opens the ERP; the agent's own feed/GL pulls satisfy the participant's verification signals (rehearsal: all three s1 runs scored 2/4, including the no-open participant) | Verification signals match ANY event of the type in the run, regardless of actor | **ADDRESSED pre-alpha (2026-09-17):** events carry an `actor` field (`participant` / `agent`); verification scoring counts participant events only by default, with per-item `actorScope: "any"` for the two agent-mediated signals (s5 ver-contract-read, s6 ver-drafts-requested). Rubric bumped to v0.2-alpha; smoke gate proves an agent-only session scores 0/4 on s1 verification while a real verifier scores 4/4. The "split the axis" option remains open for the v0.3 rewrite session. |
| 2 | A denial containing the defect keyword ("no duplicate items found") scores as detection (rehearsal: false positive on a scripted miss) | `answerSignals.strong` are substring/regex keyword matches with no negation handling | Phrase-level patterns for denial forms, or a human spot-check rule for near-miss answers |
| 3 | s1/s3 define zero required-context items, so the Context provision axis is always n/a in the alpha | Axis prints 0% unless the readout guards it *(fixed in the readout generator: now prints n/a)* | None needed for the axis itself; keep the spoken caveat in the debrief |

Specific questions to answer in the rewrite session:

1. Did any participant catch s3 but word the answer so the pattern-matcher missed it? *(false negative → broaden signals or move to model-graded)*
2. Did any participant miss s3 but use verification language that scored well? *(score/behavior mismatch, which dimension is wrong?)*
3. Is the s1 40-word gate set at the right difficulty?
4. Should `record_opened` evidence be REQUIRED for full verification credit, or currently-correct partial behavior?

---

## 4. Week-6 gate verdict (after participant 3)

- Participant who genuinely missed s3's reclass: yes / no
  *(the gate: at least one of three must genuinely miss it, otherwise the
  scenario is too easy to be discriminative)*
- Rubric changes needed: none / minor / major
- Judgment: proceed to Month-1 cohort as-is / rewrite rubric v0.2 first
- One sentence of evidence for the verdict:

---

## 5. Readout + rubric session checklist

- [ ] `npm run alpha:readout -- alpha-w6` → `docs/readout-alpha-w6.md`
- [ ] Write the control-implication paragraph (§5 of the readout; yours, by design)
- [ ] Hold the rubric-rewrite session (60 min, this doc is the agenda)
- [ ] Bump `rubric_version` in all six checklists if rules changed
- [ ] Record the gate verdict in the handoff/README
