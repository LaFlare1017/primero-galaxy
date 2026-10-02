/**
 * Revenue generator (handoff §3.3 generators/revenue.ts): AR invoices for
 * equipment and service with seasonality, plus the usage-based calibration
 * component that gives the ASC 606 texture the scenarios rely on.
 *
 * Every invoice is backed by a balanced journal entry: AR debit, revenue
 * credits. A deterministic share is paid within the window (paidOn set),
 * the rest remain open so the AR aging has real material.
 */

import { CUSTOMERS, ENTITY_IDS, VENDOR_TYPOS } from "../profile";
import type { SeededRng } from "../rng";
import type {
  ArInvoice,
  EntityId,
  JournalEntry,
  Ledger,
} from "../types";
import { addDays, endOfMonth, round2 } from "../types";

interface MonthContext {
  year: number;
  month: number;
  periodEnd: string;
}

export function generateRevenue(
  ledger: Ledger,
  rng: SeededRng,
  months: MonthContext[],
  fxRateFor: (entity: EntityId, monthIndex: number) => number,
): void {
  let invoiceSeq = 0;
  const consignmentBills: Ledger["bills"] = [];

  for (const ctx of months) {
    for (const entity of ENTITY_IDS) {
      // Seasonality: labs buy in fiscal-Q1 ramps and September refreshes.
      const seasonal =
        1 +
        0.22 * Math.sin(((ctx.month - 2) / 12) * 2 * Math.PI) +
        (ctx.month === 9 ? 0.15 : 0) +
        (ctx.month === 3 ? 0.08 : 0);
      const scale = entity === "HLI-US" ? 1.55 : entity === "HLI-CA" ? 0.32 : 0.16;
      const invoiceCount = Math.max(3, Math.round(28 * scale * seasonal));

      for (let i = 0; i < invoiceCount; i++) {
        invoiceSeq += 1;
        const customer = rng.pick(CUSTOMERS);
        // Mix: 55% equipment, 30% calibration service, 15% usage-based.
        const kind = rng.weighted(
          ["equipment", "service", "usage"] as const,
          [0.55, 0.3, 0.15],
        );
        const fx = fxRateFor(entity, months.indexOf(ctx));

        let amount: number;
        let currency: ArInvoice["currency"];
        let lines: ArInvoice["lines"];

        if (kind === "equipment") {
          const units = rng.intInclusive(1, 6);
          const unitPrice = rng.weighted(
            [14200, 22800, 31500, 47600],
            [0.4, 0.3, 0.2, 0.1],
          );
          amount = round2(units * unitPrice);
          currency = entity === "HLI-CA" ? "CAD" : "USD";
          lines = [
            {
              description: `Instrument sale (${units} unit${units > 1 ? "s" : ""})`,
              amount,
            },
          ];
        } else if (kind === "service") {
          const months_ = rng.pick([12, 24, 36]);
          const monthly = round2(rng.next() * 1800 + 600);
          amount = round2(monthly * months_);
          currency = entity === "HLI-CA" ? "CAD" : "USD";
          lines = [
            {
              description: `Calibration service agreement (${months_} mo)`,
              amount,
            },
          ];
        } else {
          // Usage-based: minimum commitment billed monthly with an
          // overage true-up — the variable-consideration shape.
          const minimum = round2(rng.next() * 5200 + 2400);
          const overage = rng.chance(0.35)
            ? round2(minimum * (0.1 + rng.next() * 0.5))
            : 0;
          amount = round2(minimum + overage);
          currency = entity === "HLI-CA" ? "CAD" : "USD";
          lines = [
            { description: "Usage minimum commitment", amount: minimum },
            ...(overage > 0
              ? [{ description: "Usage overage true-up", amount: overage }]
              : []),
          ];
        }

        const day = rng.intInclusive(1, 28);
        const date = `${ctx.year}-${String(ctx.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const dueDate = addDays(date, rng.pick([30, 45, 60]));

        const invoice: ArInvoice = {
          id: `INV-${String(invoiceSeq).padStart(5, "0")}`,
          entity,
          customer,
          date,
          dueDate,
          amount,
          currency,
          lines,
        };

        // ~72% settle inside the seed window.
        if (rng.chance(0.72)) {
          invoice.paidOn = addDays(date, rng.intInclusive(20, 75));
        }

        ledger.invoices.push(invoice);

        // Journal: DR AR / CR revenue, with COGS relief on equipment sales.
        const revAccount =
          kind === "equipment" ? "4010" : kind === "service" ? "4020" : "4030";
        const jeLines: JournalEntry["lines"] = [
          { accountId: "1100", entity, debit: amount, credit: 0 },
          {
            accountId: revAccount,
            entity,
            debit: 0,
            credit: amount,
            memo: `${customer} — ${kind}`,
          },
        ];
        if (kind === "equipment") {
          // HLS-LLC resells calibration services only — its equipment sales
          // are pass-through consignment units with no inventory held. The
          // payable to the parent is represented as an open AP bill so the
          // AP subledger ties.
          if (entity === "HLS-LLC") {
            const consignment = round2(amount * 0.92);
            jeLines.push(
              { accountId: "5010", entity, debit: consignment, credit: 0, memo: "Consignment equipment cost" },
              { accountId: "2010", entity, debit: 0, credit: consignment, memo: "Payable to HLI-US" },
            );
            consignmentBills.push({
              id: `BILL-CON-${invoice.id}`,
              entity,
              vendor: "Harbor Lane Instruments, Inc. (consignment)",
              date,
              dueDate: addDays(date, 30),
              amount: consignment,
              currency: "USD",
              threeWayMatched: false,
            });
          } else {
            const cogs = round2(amount * 0.58); // hardware margin profile
            jeLines.push(
              { accountId: "5010", entity, debit: cogs, credit: 0, memo: "Equipment cost relief" },
              { accountId: "1200", entity, debit: 0, credit: cogs, memo: "Inventory relief" },
            );
          }
        }
        ledger.journalEntries.push({
          id: `JE-REV-${invoice.id}`,
          date,
          entity,
          source: "revenue",
          lines: jeLines,
          memo: `Invoice ${invoice.id}`,
        });

        if (invoice.paidOn) {
          ledger.journalEntries.push({
            id: `JE-CASH-${invoice.id}`,
            date: invoice.paidOn,
            entity,
            source: "revenue",
            lines: [
              { accountId: "1010", entity, debit: amount, credit: 0 },
              { accountId: "1100", entity, debit: 0, credit: amount },
            ],
            memo: `Receipt ${invoice.id}`,
          });
          ledger.bankLines.push({
            id: `BK-IN-${invoice.id}`,
            entity,
            date: invoice.paidOn,
            direction: "in",
            amount,
            description: `Deposit — ${customer}`,
            matchedEntryId: `JE-CASH-${invoice.id}`,
          });
        }
      }
    }
  }
  // fxRateFor is part of the signature so the CA-entity booking can later be
  // restated through FX without changing call sites when emit.ts lands.
  void fxRateFor;
  ledger.bills.push(...consignmentBills);
}

/** Vendor typos are re-exported here so AP texture stays near revenue texture. */
export const KNOWN_TYPOS = VENDOR_TYPOS;
