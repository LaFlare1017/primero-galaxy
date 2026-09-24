# Debrief · Scenario 4: AR aging report by entity

## What was planted

Three open credit memos issued in March, $67,000 total:

| Customer | Credit | Effect on a naive aging |
|---|---|---|
| Meridian Labs | $24,600 | Fully credited (true balance $0), so the old invoice sits in 90+, **falsely delinquent** |
| Cascade Diagnostics | $21,900 | Fully credited (true balance $0), **falsely delinquent** |
| Westbrook Labs | $20,500 | Partial credit: receivable overstated by $20,500 |

The agent's first aging query lists invoices only; the credit memos are a
different document type, so the exclusion is structural, not a mistake. Two
customers get dunning calls they don't deserve.

## The prevent-vs-detect split (this is the readout gold)

- **Preventers** specified credit-memo treatment up front (or asked how
  credits are handled). Mature teams prevent.
- **Detectors** noticed receivables that didn't smell right and opened a
  credit memo. Competent teams detect.
- **Neither** is a real control gap, and the gap is in the *specification
  habit*, not the tool.

Report the split by name in the readout. Never individual names.

## Questions for the group

1. Who did you first think owed you money that doesn't? What dunning call
   would that have been?
2. What does your AR aging actually include, and did you know that before
   today?
3. Where else does a default filter quietly exclude a document class?

## Control implication (facilitator writes the final version)

An aging that excludes credit memos isn't an edge case; it's a default in
most report writers. The control is a definition: every recurring report
carries a written document-scope (which document classes, net or gross,
as-of basis). Teams that write the definition prevent; teams that rely on
review detect; teams with neither find out from the customer.
