/**
 * Scenario 1 defect — Reconcile the March operating bank account.
 *
 * A single $18,450 customer deposit appears twice in the bank feed
 * (3/12 and 3/14 — a returned-then-resubmitted ACH). Two open AR invoices
 * happen to be $18,450 each. The recon *balances* on the surface, so
 * nothing looks wrong unless someone questions the duplicate.
 *
 * Mechanical construction: the ORIGINAL deposit entry (customer A, 3/12,
 * $18,450) keeps its GL cash. The SECOND bank line (3/14) is a pure bank-feed
 * duplicate — customer B's invoice amount coincidentally matches, but its
 * corresponding GL receipt is dated 4/03, outside the window. GL cash only
 * ever received the deposit once; the bank feed shows it twice.
 *
 * Detection (per handoff §4): flags the duplicate, or specifically questions
 * one of the two $18,450 items. Ground truth for the deterministic scorer:
 * the 3/14 bank line is the defective one.
 */

import { addDays, round2 } from "../types";
import type { BankLine, Ledger } from "../types";
import type { SeededRng } from "../rng";

export const SCENARIO1 = {
  amount: 18450,
  duplicateDate: "2026-03-12",
  resubmitDate: "2026-03-14",
  /** The 3/14 line is the defect; the 3/12 line is a legitimate settlement. */
  defectiveBankLineId: "BK-DUP-S1",
  /** Customer whose real settlement is the 3/12 deposit. */
  settledCustomer: "Cascade Diagnostics",
  /** Customer whose invoice amount coincidentally matches; receipt is 4/03. */
  coincidentalCustomer: "Northgate Health",
} as const;

export function applyScenario1(ledger: Ledger, rng: SeededRng): void {
  const amount = SCENARIO1.amount;

  // Two open March invoices that happen to be $18,450 each.
  const invA: Ledger["invoices"][number] = {
    id: "INV-S1-A",
    entity: "HLI-US",
    customer: SCENARIO1.settledCustomer,
    date: "2026-03-02",
    dueDate: addDays("2026-03-02", 30),
    amount,
    currency: "USD",
    paidOn: SCENARIO1.duplicateDate,
    lines: [{ description: "Calibration service agreement (12 mo)", amount }],
  };
  const invB: Ledger["invoices"][number] = {
    id: "INV-S1-B",
    entity: "HLI-US",
    customer: SCENARIO1.coincidentalCustomer,
    date: "2026-03-09",
    dueDate: addDays("2026-03-09", 30),
    amount,
    currency: "USD",
    // NOT paid in March — its receipt lands 4/03, outside the close window.
    lines: [{ description: "Instrument service plan (12 mo)", amount }],
  };

  // GL: invoice A + its 3/12 cash receipt (the legitimate one).
  ledger.invoices.push(invA, invB);
  ledger.journalEntries.push(
    {
      id: "JE-S1-INV-A",
      date: invA.date,
      entity: "HLI-US",
      source: "revenue",
      lines: [
        { accountId: "1100", entity: "HLI-US", debit: amount, credit: 0 },
        { accountId: "4020", entity: "HLI-US", debit: 0, credit: amount, memo: SCENARIO1.settledCustomer },
      ],
      memo: `Invoice ${invA.id}`,
    },
    {
      id: "JE-S1-CASH-A",
      date: SCENARIO1.duplicateDate,
      entity: "HLI-US",
      source: "revenue",
      lines: [
        { accountId: "1010", entity: "HLI-US", debit: amount, credit: 0 },
        { accountId: "1100", entity: "HLI-US", debit: 0, credit: amount, memo: `Receipt ${invA.id}` },
      ],
      memo: `Receipt ${invA.id}`,
    },
    {
      id: "JE-S1-INV-B",
      date: invB.date,
      entity: "HLI-US",
      source: "revenue",
      lines: [
        { accountId: "1100", entity: "HLI-US", debit: amount, credit: 0 },
        { accountId: "4020", entity: "HLI-US", debit: 0, credit: amount, memo: SCENARIO1.coincidentalCustomer },
      ],
      memo: `Invoice ${invB.id}`,
    },
    // Invoice B's receipt — deliberately AFTER the close window (4/03).
    {
      id: "JE-S1-CASH-B",
      date: "2026-04-03",
      entity: "HLI-US",
      source: "revenue",
      lines: [
        { accountId: "1010", entity: "HLI-US", debit: amount, credit: 0 },
        { accountId: "1100", entity: "HLI-US", debit: 0, credit: amount, memo: `Receipt ${invB.id}` },
      ],
      memo: `Receipt ${invB.id} (April)`,
    },
  );

  // Bank feed: the 3/12 legitimate line, PLUS the defective 3/14 resubmit.
  const bankLines: BankLine[] = [
    {
      id: "BK-S1-LEGIT",
      entity: "HLI-US",
      date: SCENARIO1.duplicateDate,
      direction: "in",
      amount,
      description: `ACH — ${SCENARIO1.settledCustomer}`,
      matchedEntryId: "JE-S1-CASH-A",
    },
    {
      id: SCENARIO1.defectiveBankLineId,
      entity: "HLI-US",
      date: SCENARIO1.resubmitDate,
      direction: "in",
      amount,
      description: `ACH — ${SCENARIO1.coincidentalCustomer}`,
      // matchedEntryId intentionally undefined: the 3/14 line has NO GL
      // cash behind it inside the window — that's the trap.
    },
  ];
  ledger.bankLines.push(...bankLines);

  void rng; // defect placement is fully deterministic; rng reserved for texture
  void round2;
}
