# Debrief · Scenario 2: Why doesn't intercompany balance?

## What was planted

The Meridian calibration platform build generated a CAD 139,400 IC charge:

- **HLI-CA** booked its receivable at the **3/15 transaction-date rate (0.769)** → USD 107,198.60
- **HLI-US** booked the payable at the **3/31 month-end rate (0.739)** → USD 103,016.60
- Variance: **USD 4,182.00: pure FX timing.**

Both entries are individually defensible. Neither side is "wrong." The
reconciliation doesn't balance, and the answer is a rate table.

## What to watch for in the room

- Most participants will chase amounts first. The delta ($4,182) will not
  match any single document; it's the *difference between two currency
  conversions*. The people who get it fastest are the ones who ask "what
  rate did each side use" rather than "which entry is wrong."
- Watch who asks the agent for FX rates unprompted; that's the context
  provision skill. The tool exists but is never volunteered.

## Questions for the group

1. Both entries are defensible. So what exactly is "out of balance"?
2. When both sides of a reconciliation are individually correct, where does
   the variance live?
3. What would you have needed to specify up front to get the right analysis
   on the first pass?

## Control implication (facilitator writes the final version)

IC recs should carry a documented FX policy: which side books at
transaction date, which at month-end, and who books the remeasurement.
Without it, every close inherits a variance that is individually defensible
and collectively unresolved, and *that* variance is what fraud hides
behind when it wants to look like noise.

## Expected catch rate

Medium. Identifying "rate mismatch" is common; articulating *why* the two
rates differ (transaction-date vs. close-date conversion) is the partial /
full credit line.
