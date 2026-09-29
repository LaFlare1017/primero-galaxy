# We wrote every keyboard shortcut down four times. Here's what 15 commits taught me about interfaces you can't see.

*My last piece covered the first 78 commits — two products, a data galaxy, and the rules that came from scars. This is the sequel: the session where the least visible interface in the app, its keyboard, became something a test could check. Same format: real numbers, real bugs, and the playbook I'd repeat.*

<!-- stats:begin article.stats -->
**The stats up front:**
15 commits · 5 declared keyboards · 1,410 lines of declaration · 77 states enumerated · 131 e2e tests across 18 files · 4 of 5 surfaces produced a real defect on the day they were declared · 28 ways the checkers break a synthetic manifest · 1 test that passed when it should have failed
<!-- stats:end -->

---

## The keyboard was written down four times

Every shortcut in the app existed in four places: the handler that binds it, the `aria-keyshortcuts` string that claims it to a screen reader, the shortcut sheet that documents it, and the menu that offers it mid-chord. Four copies, agreeing by discipline. Nothing could tell when they stopped.

By the end of the session, each surface declares its keyboard once — rows of `{ id, keys, gate, mount, under }` with the readers that interpret them — and everything else reads that declaration: the dispatcher, the aria strings, the sheet, the menu. The surface supplies behaviour keyed by row id. That's all it supplies.

**Lesson: a binding written down twice is a claim nothing can check.** Don't ask whether the copies agree today; ask whether a disagreement could survive a week.

---

## The bug that started it: one Escape closed two layers

The facilitator console has two overlays that can sit on top of each other. One press of Escape closed both.

The cause was timing nobody can see in a diff. Radix listens for Escape on `document` in the **capture** phase, so by the time the page's own listener asked "which layer is open?", the top layer had already flipped itself to `closed`, the selector answered "nobody", and the key fell through to the layer underneath.

So we stopped asking the DOM mid-keystroke and started asking the state.

**Lesson: ordering that lives in an event's phase cannot be reviewed.** If a key's meaning depends on what is on top, that fact belongs in data, not in the order of `if` statements.

---

## The move: one declaration, read four ways

```
one key ──▶ declaration (id · keys · gate · mount · under)
                    │
                    ├──▶ what runs       (the page dispatches from it)
                    ├──▶ what is claimed (aria-keyshortcuts, built from rows)
                    ├──▶ what is shown   (the shortcut sheet, rendered from rows)
                    └──▶ what is offered (the armed-chord menu, filtered by rows)
```

The two halves of the drift became impossible rather than unlikely. Add a row with no behaviour and the menu can't offer it, because the menu reads the declaration. Add behaviour with no row and the sheet can't advertise it — and the test that presses every declared binding fails under the binding's own name.

The declaration is import-free on purpose: no React, no DOM, no imports. That's what lets a spec import it straight into node and check it in milliseconds.

**Lesson: the strongest safety property is structural, not procedural.** "We promise to keep these in sync" is procedure. "There is only one of them" is structure.

---

## Three questions one declaration can't ask itself

The declaration can answer a lot. It cannot answer these:

- **Coherence — does it agree with itself?** In every state the surface can be in: no two live bindings on one key, and every gate either reachable from a real state or removed. Runs in node, in milliseconds.
- **Agreement — do two declarations of one binding describe it the same way?** A key owned by a component elsewhere is declared twice: once by the surface that binds it, once by a surface that only documents it. Compare the facts — keys as a *set* (the order you list alternatives in is a rendering choice), the gate, what it stands down for, how it is mounted. Leave out the ids and labels, because those are how each surface talks to its own readers.
- **Coverage — does pressing it do something visible?** No declaration can answer this about itself. A row is documentation until something presses it.

That middle check paid for itself within minutes of running on real code. The console's shortcut sheet documented `⌘K` while the palette also answered `Ctrl+K` — one declaration missing a spelling the other had. The failure message wasn't "something is wrong"; it was *"the console open-palette and the palette toggle-palette describe one binding with different keys ([Meta+k] and [Ctrl+k Meta+k])"*.

**Lesson: a check that says *where* and *how* is worth ten that say *no*.** The sentence a failure prints is the product.

---

## The DOM's timing is part of your interface

The capture-phase lesson showed up three more times, on three surfaces. In the ⌘K palette, the branch that was supposed to leave a sub-list and return to the root menu **had never once run**: we'd written it on the input, in the React bubble phase, where capture will always beat it. Escape closed the whole palette instead.

The fix was one prop on the dialog — and then the part that matters: saying in the declaration that those two Escapes are *one key in two states* (`under: 'subroute'`), so a future refactor that moves the branch back into the input fails a test with a sentence about the DOM rather than a shrug.

**Lesson: when a library owns an overlay, its dismissal path is an API.** Read where the key is handled before deciding where your intent belongs. A layering bug is invisible in review, because the code looks right.

---

## The test that passed when it should have failed

This is the one I keep telling people about.

We had a new check that presses every binding a declaration names and demands a visible effect of each. To prove the check worked, I aimed a mutation at it: empty a row's keys, so the binding does nothing.

The test **passed**.

The runner iterates a binding's declared *keys* — so with none declared, it walks past the binding entirely: no press, no exercise, no failure. And the check that looked like it covered this compared *ids*, which were perfectly fine.

Eleven lines later it refuses that case before a browser opens: *"no declared binding may name zero keys, and be exercised by nobody."*

That mutation found more than the three that behaved.

**Lesson: a check you have never seen fail is a claim, not a check.** Write the mutation that should kill it. Every time. And when one survives, that's not a gap in your test run — that's the finding of the day.

There's a second version of this trap worth knowing. Two readers built from the *same* predicate agree with each other however wrong that predicate is — so comparing them proves nothing. We had to ask for *presence* instead: withhold a behaviour, then demand it be absent from both the dispatcher and the menu.

---

## Declaring a surface finds bugs

The part I did not expect. Four of the five surfaces produced a real defect on the day their keyboard was declared:

- A palette sub-list whose Escape branch was **dead** (above).
- A saved-views form whose Escape closed **the panel behind it**, because the branch sat on the input instead of the layer.
- A shortcut sheet promising `Ctrl+K` that the binding's row didn't carry.
- A sheet that bound Escape **twice** — its own window listener plus the page's ladder, two owners of one press with nothing to keep them in order.

Not one of these was found by reading the code. They were found by writing down what we believed and then asking a machine whether it was true.

**Lesson: declaring an interface isn't documentation — it's a debugging instrument.** The bug hunt and the refactor are the same act.

---

## One honest admission

The design can only see keys the app owns, and one product surface **has no app-owned keys to declare**: FinBench's filter popover is a `cmdk` list inside a Radix popover, so its arrows, Enter and Escape belong to those libraries. Declaring them would be a lie in the other direction. We wrote that limit down next to the code instead of pretending to cover it.

Two smaller admissions, both recorded rather than papered over: the coverage runner can't tell you whether the *declaration* is right (only what it declares), and one rung of a three-key dismissal ladder is defensive rather than load-bearing, because the UI as built can't put those two states on screen at once.

Oh — and the session ended with a real bug I chose **not** to fix: on the galaxy page, an open company profile covered the bottom bar, so its Search control couldn't be clicked while a profile was showing. The keyboard path worked (focus it, press Enter), which is how the test reached it. It sat in the ledger, unfixed. The next session closed it in one line — declare the bar's height once and let the panel and the toast stack offset by that — and the interesting part is what finally *caught* it: not the keyboard checks, which had no word for "the click lands on something else", but the coverage step's own click, retrying until it timed out. The test that had been written around the bug became the test that proves it is gone.

**Lesson: write the limit next to the check.** A gap that's named gets watched. A gap that's implied gets trusted.

---

## The playbook, if you're doing this

1. **Declare the binding once**, as data: keys, the condition that makes it live, how it's mounted, and what it yields while something else holds the keyboard.
2. **Read from it everywhere** — dispatch, aria, the sheet, the menu. If a consumer can't read it, the declaration is in the wrong place.
3. **Enumerate the states it can be in** and the invariant that filters them, then assert coherence in all of them. A hand-written table of cases is only the cases you thought of.
4. **Compare two declarations of one binding** on facts only. The pairing is knowledge, so state it explicitly and pin it — a renamed id must break the spec rather than quietly pair with nothing.
5. **Press every binding** from a state where it is live, and demand a visible effect. Every *key* of a binding, not every binding — one row with two spellings owes two presses.
6. **Mutate the check**, and only trust it once you've watched it die on the assertion it was aimed at.
7. **Write the guard where the check would otherwise be vacuous**: no states enumerated, nothing to compare, no keys to press. A check that walks nothing reads green.

---

*The interesting part for me wasn't the keyboard. It was discovering that "write down what you believe, then try to prove it wrong" is not a documentation task. It's the fastest bug-finding tool I picked up this year — and it works on anything with hidden state: feature flags, permissions, an API contract, a data model.*

*What's the claim in your codebase that's written down in more than one place? I'd start there.*

#AI #SoftwareEngineering #Accessibility #Testing #TypeScript #A11y
