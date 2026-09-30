# LinkedIn assets — the declared-keyboard build

Copy for sharing the learning journey from the session that turned every
keyboard binding in this repo into a declared, checked artifact.

**Read [`README.md`](README.md) for how to post these** (carousel export, timing,
link handling).

<!-- stats:begin copy.figures -->
All figures are the repo's real ones, read out of it by `linkedin/stats.mjs`
as of 2026-09-29: 15 commits in the era, 5 declared
keyboards, 1,410 lines of declaration, 77 enumerated states,
132 e2e tests in 19 files, 8 findings.
<!-- stats:end -->

---

## 1. The main post — the learning journey (text only)

> Recommended: Tuesday–Thursday morning, no link in the body (put the repo in the
> first comment). ~1,600 characters, which lands just past "see more".

---

I spent a session making an invisible interface checkable. The interesting part
wasn't the keyboard.

Every shortcut in our app was written down **four times**: the handler that binds
it, the `aria-keyshortcuts` string that claims it to a screen reader, the
shortcut sheet that documents it, and the little menu that offers it mid-chord.
Four copies that agreed by discipline, and nothing that could tell when they
stopped.

By the end: one declaration per surface, read by all four. Five surfaces, 1,410 lines of declaration, 77 enumerated states, 132 tests.

Four lessons, each bought with a real bug:

**1. A toggle owes both halves.** Our ⌘K palette had tests. They opened it with
Ctrl+K and closed it with Escape — so a palette that could only ever *open*
would have passed every test we had. A binding's test has to press it from the
state where it is live.

**2. Layer order is a claim about the DOM's timing.** Radix dismisses on
`document` in the **capture** phase, so a React handler on the input inside it can
never win. Our "Escape leaves the sub-list" branch had been dead since the day it
was written: the key closed the whole palette instead. The fix was one prop on
the dialog — and then saying so in the declaration, or the next reader
"simplifies" it back.

**3. A check cannot be trusted until you've made it fail.** I aimed a mutation at
our coverage check. It **passed**. The runner iterates a binding's declared *keys*,
so a row that names no keys is walked past without a press and its exercise never
runs. That hole is now refused before a browser opens — and that one mutation
found more than the other three combined.

**4. Two readers of one rule always agree.** Our chord menu and our dispatcher
shared a predicate, so comparing them proved nothing. We had to ask for
*presence* instead: withhold the behaviour, then demand it be absent from both.

The unexpected part: **writing down what we believed found bugs.** Four of the
five surfaces produced a real defect on the day they were declared. Declaring an
interface isn't documentation — it's a debugging instrument.

What's the UI claim in your codebase that's written down in more than one place?
That's where I'd start.

---

*I build evaluation products and facilitation tools — a 3D data galaxy, an
accounting-AI benchmark, and a workshop simulator for AI delegation. The
keyboard work crossed all three.*

#SoftwareEngineering #Accessibility #Testing #TypeScript #A11y #FrontendEngineering

---

## 2. The engineering post — one browser detail, one dead branch

> Shorter, more technical. Good as a follow-up post a few days later, or for an
> engineering-heavy audience. ~1,100 characters.

---

A one-line bug hid behind a browser detail most of us never meet: the **capture
phase**.

We had a command palette where Escape was supposed to leave a sub-list and go
back to the root menu. It never did. It closed the whole palette instead.

Why: Radix's `DismissableLayer` attaches its `keydown` listener to `document`
with `{ capture: true }`. It calls your `onEscapeKeyDown` first, and only if
nobody called `preventDefault()` does it dismiss. Our handler lived on the input
*inside* that layer — a React handler, which runs in the bubble phase. Capture
beats bubble on the same target. Our branch was unreachable from the moment it
was written.

```
Escape ──▶ document (capture) ──▶ Radix: onEscapeKeyDown? ──▶ dismiss
                     │
                     └──▶ …bubble… ──▶ our input handler   ← never mattered
```

The fix was one prop (`onEscapeKeyDown` on the dialog). The harder part was
making it stay fixed: the declaration now says the two Escapes are one key in two
states (`under: 'subroute'`), and a check asserts that no reachable state lets
both answer — so a future refactor that moves the branch back into the input
fails a test with a sentence about the DOM, not a shrug.

Two things I'd tell my past self:

1. When a library owns an overlay, its dismissal path **is** an API. Read where
   the key is handled before deciding where your intent belongs.
2. A layering bug is invisible in review, because the code looks right. The only
   defence is a check that asks the state, not the stack.

#JavaScript #React #Frontend #A11y #SoftwareTesting

---

## 3. The short post — the check that failed to fail

> Punchy, one idea, works well as a single-image post. ~700 characters.

---

Our test suite was green. One of the checks was blind.

I mutated a shortcut declaration to see whether our new coverage check would
catch it — the row's keys emptied, so the binding did nothing. The test **passed**.

The runner iterates a binding's declared *keys*. With none declared, it walks
past the binding entirely: no press, no exercise, no failure. And the check that
looked like it covered this compared ids, which were still perfectly fine.

Eleven lines later it refuses that case before a browser opens, with the message
*"no declared binding may name zero keys, and be exercised by nobody"*.

The lesson isn't about keys. It's this: **a check you have never seen fail is a
claim, not a check.** Write the mutation that should kill it. Every time. The one
that survives is the one that was about to lie to you.

#Testing #QualityEngineering #SoftwareEngineering #MutationTesting

---

## 4. Carousel caption (for `carousel.html`, 10 slides)

---

Ten slides on the session where we stopped writing keyboard shortcuts down four
times. Swipe through for the four lessons — including the test that passed when
it should have failed. →

Full write-up in the first comment.

#SoftwareEngineering #Accessibility #Testing #TypeScript #FrontendEngineering

---

## 5. Optional — the AI-pairing angle

> Only if you're comfortable disclosing the tooling. Kept separate so it can be
> its own post (it's a different audience and a different claim).

---

I built this with an AI coding agent in the loop, and it changed what "review"
means.

Not because it wrote the code faster. Because the work became *asking what would
prove this wrong*.

When an agent can hold 1,410 lines of declaration in context and re-check every
surface at once, the human contribution shifts almost entirely to falsification:
aim a mutation at the new check, watch it die on the assertion it was aimed at,
and when it *doesn't* die, treat that as the finding of the day. My most valuable
minutes were spent making a check fail on purpose.

Three things I'd keep doing:

- **Demand the failure, not the pass.** A green run tells you nothing about a
  check you haven't seen go red.
- **Keep the evidence clean.** Every mutation restored byte-identically and
  verified; one restore had silently changed a file's permissions — a change
  that would have ridden into the commit.
- **Ask for the limit.** "What can this check not see?" belongs in the code next
  to the check. A gap that's named gets watched; a gap that's implied gets
  trusted.

#AI #SoftwareEngineering #DeveloperTools #Testing

---

## 6. Alt text for the slides

Paste these into LinkedIn's image description field (or the post's alt field) —
they're written to carry the slide's argument, not just its title.

| Slide | Alt text |
|---|---|
| 1 | Dark cover: "A keyboard is data — 15 commits to make an invisible interface checkable." Footer: 5 declared keyboards, 77 states, 132 tests. |
| 2 | Diagram: one keyboard shortcut at the centre, with four arrows to four copies of it — the event handler, the aria string, the shortcut sheet, and the chord menu — captioned "they agreed by discipline". |
| 3 | Diagram of three stacked panels (shortcut sheet over watch pane over the grid) with one Escape press reaching two of them, marked as the bug. |
| 4 | Diagram: one declaration module on the left fanning out to four readers — dispatch, aria-keyshortcuts, shortcut sheet, chord menu — with behaviour as the only input from the component. |
| 5 | Three columns labelled Coherence, Agreement, Coverage, each with the question it asks, and a red line naming what it cannot see. |
| 6 | Sequence diagram: Escape reaches document in the capture phase, where the library calls the overlay's handler and dismisses; the input's bubble handler runs afterwards and has no effect. |
| 7 | A mutation aimed at a coverage check with a green tick beside it — the mutation passed — annotated with the runner's blind spot: a binding that declares no keys is pressed zero times. |
| 8 | Ledger of four bugs, each with the symptom and the one-line cause: a dead Escape branch, a form that closed the panel behind it, a documented key the row didn't carry, a duplicated Escape listener. |
| 9 | Five-step recipe: declare, read from it, enumerate the states, press every binding, mutate the check. |
| 10 | Closing statement: "Write down what you believe. Then make the test fail on purpose." |

---

## 7. Posting notes

- **Carousel**: export `carousel.html` to PDF (see `README.md`) and upload as a
  LinkedIn *document* — that's the swipeable format. Individual PNGs work for a
  single-image post instead.
- **The hook is the first two lines.** LinkedIn hides everything after ~210
  characters, so each post here opens with the claim, not the context.
- **No links in the body.** Put the repo/document link in the first comment and
  say so ("link in the comments") — links in the body suppress reach.
- **Reply to your own first comment** with the single most-checkable takeaway so
  the thread starts with substance.
- **Ordering**: the long-form article first ([`article.md`](article.md) — the
  sequel to the piece already in `galaxy/docs/LINKEDIN_ARTICLE.md`), then post #1
  as the feed post that points at it with the carousel attached, then #2 or #3 a
  few days apart. #5 stands alone.
<!-- stats:begin copy.numbers -->
- **Numbers to keep honest if you edit**: generated — run
  `node linkedin/stats.mjs --write` rather than editing them. 15 commits in
  the era · 5 declared keyboards · 1,410 lines of
  declaration · 77 enumerated states · 132 e2e tests across
  19 files · 8 findings, of which
  4 of 5 surfaces found theirs by declaring ·
  28 ways the checkers' own spec breaks a synthetic manifest ·
  6 tests holding the checkers to that standard.
<!-- stats:end -->
