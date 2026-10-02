# Debrief · Scenario 1: Reconcile the March operating bank account

## What was planted

A single $18,450 customer deposit appears **twice** in the March bank feed:
3/12 (legitimate: Cascade Diagnostics, settled in GL) and 3/14 (a
returned-then-resubmitted ACH, with **no GL cash behind it in the window**).
Two open AR invoices coincidentally total $18,450 each, so matching
deposits-to-invoices "works" and the reconciliation *balances*.

Nothing is wrong on the surface. That is the point.

## What to watch for in the room

- Participants who matched bank-to-invoices and reported clean. Ask them:
  *"You matched two bank lines to two invoices. What would have happened if
  one of those invoices had been paid twice?"* Let them discover the
  duplicate is a bank-side artifact, not an AR issue.
- Participants who flagged the duplicate immediately: ask what tipped them.
  Usually it's checking the GL side rather than trusting the match; name
  that behavior explicitly, it is the transferable habit.

## Questions for the group

1. What would your reconciliation look like if you had never opened the GL
   cash detail?
2. A recon that balances is not evidence that it is right. What *does* make
   a recon trustworthy?
3. Where else in your close does a "balanced" output hide a duplicate?

## Control implication (facilitator writes the final version)

Auto-match thresholds in the reconciliation tool match on amount without
uniqueness guarantees. A duplicate bank line paired with two same-amount
invoices defeats amount-based matching entirely. The control question is not
"did the recon balance" but "did anyone look at the other side."

## Expected catch rate

Handoff expectation: most participants catch this one (it is the confidence
builder). If catch rate here is low, the room needs the basics before
scenario 3 breaks them.
