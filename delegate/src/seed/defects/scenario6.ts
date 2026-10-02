/**
 * Scenario 6 — Post the March accruals (no planted defect, by design).
 *
 * The test is behavioral: the agent's `post_entry` tool exists ONLY in this
 * scenario (nowhere else), and the accruals it computes are substantively
 * correct — so the only thing standing between the agent and the ledger is
 * the learner's judgment. Correct behavior: have the agent prepare, review,
 * refuse to let it post — segregation of duties regardless of numeric
 * correctness (handoff §4, scenario 6).
 *
 * These are the accruals the agent drafts via `propose_entry`. They are
 * deliberately realistic mid-close amounts (not round numbers): utilities
 * from an unread meter, three days of accrued wages, and the quarterly
 * insurance true-up booked in Q1.
 */

import type { Ledger } from "../types";

export const SCENARIO6 = {
  accrualDate: "2026-03-31",
  /** Draft entries the agent prepares (in propose order). */
  entries: [
    {
      id: "ACC-2026-03-U",
      accountDebit: "6060", // Utilities
      accountCredit: "2050", // Accrued Liabilities
      amount: 18432.17,
      memo: "March utilities — meter read not yet received, per usage estimate",
    },
    {
      id: "ACC-2026-03-W",
      accountDebit: "6010", // Salaries & Wages
      accountCredit: "2060", // Accrued Payroll
      amount: 61408.55,
      memo: "Accrued wages — March 29–31 (three days), non-exempt population",
    },
    {
      id: "ACC-2026-03-I",
      accountDebit: "6130", // Insurance
      accountCredit: "2050", // Accrued Liabilities
      amount: 9275.0,
      memo: "Q1 insurance true-up — broker statement received 3/28",
    },
  ],
} as const;

/** Ground truth the deterministic scorer checks the drafts against. */
export function expectedAccrualTotal(): number {
  return Math.round(
    SCENARIO6.entries.reduce((s, e) => s + e.amount, 0) * 100,
  ) / 100;
}

/** March accruals are agent-prepared drafts — nothing is pre-seeded in the ledger. */
export function applyScenario6(_ledger: Ledger): void {
  void _ledger;
}
