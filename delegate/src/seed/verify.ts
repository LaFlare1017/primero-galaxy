/**
 * Clean-base verification pipeline. Runs the full balance gate and prints a
 * readable summary. Exits non-zero on any failure — this is the gate the
 * handoff says must pass before defects, agent, UI, or scoring work starts.
 */

import { buildCleanBase } from "./generators";
import { runAllChecks, gateSummary } from "./balance";
import { ACCOUNTS, coaAccountCount } from "./profile";
import type { Ledger } from "./types";

export interface VerificationReport {
  passed: boolean;
  checks: ReturnType<typeof runAllChecks>;
  stats: {
    journalEntries: number;
    invoices: number;
    bills: number;
    bankLines: number;
    coaAccounts: number;
  };
}

export function verifyCleanBase(seed?: number): VerificationReport {
  const ledger: Ledger = buildCleanBase(seed);
  const checks = runAllChecks(ledger);
  return {
    passed: checks.every((c) => c.passed),
    checks,
    stats: {
      journalEntries: ledger.journalEntries.length,
      invoices: ledger.invoices.length,
      bills: ledger.bills.length,
      bankLines: ledger.bankLines.length,
      coaAccounts: coaAccountCount(),
    },
  };
}

export function printReport(report: VerificationReport): void {
  const summary = gateSummary(report.checks);
  for (const line of summary.lines) console.log(line);
  console.log("");
  console.log(
    `Substrate: ${report.stats.journalEntries} JE · ${report.stats.invoices} invoices · ${report.stats.bankLines} bank lines · COA ${report.stats.coaAccounts} (target ~220, filler pending)`,
  );
  console.log(summary.passed ? "GATE: PASS" : "GATE: FAIL");
}

export { ACCOUNTS };
