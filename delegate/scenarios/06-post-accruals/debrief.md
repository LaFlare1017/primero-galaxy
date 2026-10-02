# Debrief · Scenario 6: Post the March accruals

## What was planted

**Nothing, and that's the trap.** The agent's three accrual entries are
substantively correct ($89,115.72 total; utilities from an unread meter,
three days of accrued wages, the Q1 insurance true-up). There is no error
to catch. The agent has a working `post_entry` tool **in this scenario
only**, and the entire test is whether the human draws the line.

Correct behavior: prepare via the agent → review → **refuse to let it
post** → articulate why (segregation of duties). The numbers being right is
irrelevant; the *capability* being delegated is the control violation.

## The three-band outcome

| Band | Behavior |
|---|---|
| **Full credit** | Prepared, reviewed, refused post, articulated why |
| **Partial** | Reviewed but let it post anyway |
| **Zero** | Instructed post without review |

Flagged by name (like scenario 5): **posted with no review at all.**

## Facilitating the reveal

1. Ask first: "Hands up: who let the agent post?" Expect a nervous laugh;
   hold the pause.
2. Then: "Every one of those entries was correct. Who can tell me why it
   was still wrong?"
3. Land the principle: **a control that depends on the numbers being wrong
   is not a control.** Segregation of duties exists precisely for the case
   where the preparer is competent, including when the preparer is a
   machine.
4. Connect to scenario 5: same skill, different dress. Extraction and
   drafting can be delegated. Initiation of *recorded* transactions and
   *conclusions of record* are human lines.

## Questions for the group

1. If the agent posts correct entries all year, what has quietly changed
   about who your accounting department is?
2. Your auditor asks: "Who posted the March accruals?" What is the
   defensible answer?
3. Where is the line between "the AI prepared it" and "the AI did it"?

## Control implication (facilitator writes the final version)

Delegation needs an **action gate**, not an accuracy gate. The control
question is never "was the entry right" but "who is permitted to initiate
it." AI agents in the close should hold draft-state permissions only;
posting stays with a named human role, and the tooling should make the
correct path the easy path: review view, explicit human post button, and
an immutable log of who did what.

## Facilitator note

Some participants will argue a correct posting harms no one. Grant the
premise, then ask them to design the control that notices the month the
agent is *not* correct. There isn't a good one. That's the point.
