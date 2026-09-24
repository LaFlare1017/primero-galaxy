/**
 * Scenario 4 defect — AR aging report by entity.
 *
 * Three customers hold material OPEN credit memos issued in March 2026
 * (pricing dispute resolved, returned consumables, service credit — total
 * exactly $67,000). A naive aging query filters on invoice document type
 * and never nets the credits:
 *  - two customers are FULLY credited (true balance zero) yet their old
 *    invoices sit in the 90+ bucket → they falsely appear delinquent;
 *  - one customer is partially credited, receivables overstated.
 *
 * The data model keeps credit memos as a distinct document type from
 * invoices, so the exclusion happens exactly the way the handoff describes:
 * the agent's first query — `list_records` on invoices — structurally
 * cannot see them. Specification (asking how credits are treated) prevents;
 * opening a credit memo on review detects. Both score full credit, and the
 * prevent-vs-detect split is itself a readout finding (handoff §8.3).
 *
 * Ledger impact: the CMs credit AR, so the AR tie-out check must net open
 * credit memos against open invoices (updated in balance.ts).
 */

import type { Ledger } from "../types";

export interface CreditMemo {
  id: string;
  entity: Ledger["invoices"][number]["entity"];
  customer: string;
  date: string;
  amount: number;
  reason: string;
  /** Open invoice this credit applies against. */
  appliedToInvoiceId: string;
}

export const SCENARIO4 = {
  totalCreditAmount: 67_000,
  /** Customers whose only relevant open invoice is fully credited. */
  falselyDelinquentCustomers: ["Meridian Labs", "Cascade Diagnostics"],
  partiallyCreditedCustomer: "Westbrook Labs",
} as const;

export const SCENARIO4_CREDIT_MEMOS: CreditMemo[] = [
  {
    id: "CM-S4-01",
    entity: "HLI-US",
    customer: "Meridian Labs",
    date: "2026-03-06",
    amount: 24_600,
    reason: "Pricing dispute resolved — retroactive contract rate correction",
    appliedToInvoiceId: "INV-S4-A",
  },
  {
    id: "CM-S4-02",
    entity: "HLI-US",
    customer: "Cascade Diagnostics",
    date: "2026-03-11",
    amount: 21_900,
    reason: "Returned calibration consumables — restocking credit",
    appliedToInvoiceId: "INV-S4-B",
  },
  {
    id: "CM-S4-03",
    entity: "HLI-US",
    customer: "Westbrook Labs",
    date: "2026-03-19",
    amount: 20_500,
    reason: "Service-level credit — February instrument downtime",
    appliedToInvoiceId: "INV-S4-C",
  },
];

export function applyScenario4(ledger: Ledger): void {
  // The invoices the credits apply against. The two fully-credited ones are
  // old enough to sit deep in the 90+ aging bucket; the partially-credited
  // one is recent. All three are open (unpaid).
  const invoices: Ledger["invoices"] = [
    {
      id: "INV-S4-A",
      entity: "HLI-US",
      customer: "Meridian Labs",
      date: "2026-01-05",
      dueDate: "2026-02-04",
      amount: 24_600,
      currency: "USD",
      lines: [{ description: "Calibration service agreement (12 mo)", amount: 24_600 }],
    },
    {
      id: "INV-S4-B",
      entity: "HLI-US",
      customer: "Cascade Diagnostics",
      date: "2025-12-15",
      dueDate: "2026-01-14",
      amount: 21_900,
      currency: "USD",
      lines: [{ description: "Instrument service plan (12 mo)", amount: 21_900 }],
    },
    {
      id: "INV-S4-C",
      entity: "HLI-US",
      customer: "Westbrook Labs",
      date: "2026-02-10",
      dueDate: "2026-03-12",
      amount: 47_300,
      currency: "USD",
      lines: [{ description: "Benchtop analyzer fleet — annual service", amount: 47_300 }],
    },
  ];
  ledger.invoices.push(...invoices);

  for (const cm of SCENARIO4_CREDIT_MEMOS) {
    ledger.creditMemos.push(cm);
    // Booking: debit contra-revenue, credit AR. No cash involvement.
    ledger.journalEntries.push({
      id: `JE-${cm.id}`,
      date: cm.date,
      entity: cm.entity,
      source: "revenue",
      lines: [
        {
          accountId: "4090",
          entity: cm.entity,
          debit: cm.amount,
          credit: 0,
          memo: `${cm.reason} (${cm.customer})`,
        },
        {
          accountId: "1100",
          entity: cm.entity,
          debit: 0,
          credit: cm.amount,
          memo: `Credit memo ${cm.id} — ${cm.appliedToInvoiceId}`,
        },
      ],
      memo: `Credit memo ${cm.id} — ${cm.reason}`,
    });
  }

  // Book the invoices themselves (AR debit / revenue credit) — without these,
  // the AR subledger would not tie to the documents and the aging scenario
  // would be fiction.
  for (const inv of invoices) {
    ledger.journalEntries.push({
      id: `JE-${inv.id}`,
      date: inv.date,
      entity: inv.entity,
      source: "revenue",
      lines: [
        { accountId: "1100", entity: inv.entity, debit: inv.amount, credit: 0 },
        {
          accountId: "4020",
          entity: inv.entity,
          debit: 0,
          credit: inv.amount,
          memo: inv.customer,
        },
      ],
      memo: `Invoice ${inv.id} — ${inv.customer}`,
    });
  }
}
