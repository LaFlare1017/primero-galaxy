/**
 * Scenario 3 defect — Draft Q1 flux commentary (centerpiece).
 *
 * The reclass: per a documented capitalization-policy change, $280K of
 * previously-COGS service delivery costs was reclassified into opex in
 * Q1 2026 — booked via a single journal entry dated 3/31/2026. Summary
 * views show: opex up $312K QoQ, professional services up $94K (genuine),
 * and a small consulting line. The reclass is INVISIBLE unless someone
 * opens JE detail — the wrong answer (blaming consulting spend) is the
 * honest read of summary data, not a hallucination.
 *
 * Ground truth for the deterministic scorer: JE-S3-RECLASS is the defective
 * entry; detection = the submitted answer names the reclass as a material
 * driver. The agent, given summary tools, will credibly miss it (handoff:
 * expected cohort catch rate 15–25%).
 */

import type { Ledger } from "../types";

export const SCENARIO3 = {
  reclassAmount: 280000,
  reclassEntryId: "JE-S3-RECLASS",
  reclassDate: "2026-03-31",
  /** COGS account relieved; opex account charged. */
  fromAccount: "5020",
  toAccount: "6100",
  /** Documentation the ERP shows on the entry — legitimate-looking. */
  memo: "Reclass per capitalization policy change CP-2026-01 (board-approved 2/26)",
} as const;

export function applyScenario3(ledger: Ledger): void {
  const amount = SCENARIO3.reclassAmount;

  ledger.journalEntries.push({
    id: SCENARIO3.reclassEntryId,
    date: SCENARIO3.reclassDate,
    entity: "HLI-US",
    source: "ap",
    lines: [
      {
        accountId: SCENARIO3.toAccount,
        entity: "HLI-US",
        debit: amount,
        credit: 0,
        memo: SCENARIO3.memo,
      },
      {
        accountId: SCENARIO3.fromAccount,
        entity: "HLI-US",
        debit: 0,
        credit: amount,
        memo: SCENARIO3.memo,
      },
    ],
    memo: SCENARIO3.memo,
  });
}
