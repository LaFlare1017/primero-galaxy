/**
 * AP generator (handoff §3.3 generators/ap.ts).
 *
 * Feeds the expense side of the company with realistic texture:
 *  - inventory purchases (both COGS relief and stock build flow through here)
 *  - service delivery materials/consumables
 *  - professional services with the Q1 2026 step-up scenario 3 requires
 *  - general opex bills
 * Bills are paid inside the window with a payment journal + bank line.
 */

import { ENTITY_IDS, VENDORS, VENDOR_TYPOS } from "../profile";
import type { SeededRng } from "../rng";
import type {
  ApBill,
  EntityId,
  JournalEntry,
  Ledger,
} from "../types";
import { addDays, round2 } from "../types";

interface MonthContext {
  year: number;
  month: number;
  periodEnd: string;
}

interface BillSpec {
  vendor: string;
  account: string;
  lo: number;
  hi: number;
  perMonth: number;
  threeWayRate: number;
}

const BILL_SPECS: Record<EntityId, BillSpec[]> = {
  "HLI-US": [
    // Finished-goods builds: instrument assemblies into 1200, later relieved
    // by equipment COGS at sale time.
    // Volume sized to cover equipment COGS relief (~10.4M over the window)
    // with buffer.
    { vendor: "Meridian Instrument Parts", account: "1200", lo: 48000, hi: 140000, perMonth: 14, threeWayRate: 0.9 },
    { vendor: "Thames Scientific Supply", account: "1210", lo: 8000, hi: 46000, perMonth: 6, threeWayRate: 0.85 },
    { vendor: "Meridian Instrument Parts", account: "1210", lo: 3000, hi: 22000, perMonth: 3, threeWayRate: 0.7 },
    { vendor: "Atlas Calibration Consumables", account: "5030", lo: 900, hi: 5200, perMonth: 3, threeWayRate: 0.3 },
    { vendor: "Halstead & Marsh LLP", account: "6110", lo: 4000, hi: 26000, perMonth: 1, threeWayRate: 0 },
    { vendor: "Trueline Audit Group", account: "6120", lo: 9000, hi: 15000, perMonth: 0.3, threeWayRate: 0 },
    { vendor: "Cortland Facilities Services", account: "6360", lo: 600, hi: 4800, perMonth: 1.5, threeWayRate: 0.2 },
    { vendor: "Vector Freight Systems", account: "5100", lo: 700, hi: 6200, perMonth: 5, threeWayRate: 0.4 },
    { vendor: "Quarry Hill Insurance", account: "6130", lo: 5200, hi: 5800, perMonth: 0.25, threeWayRate: 0 },
    { vendor: "Signalpath Telecom", account: "6350", lo: 900, hi: 1400, perMonth: 1, threeWayRate: 0 },
    { vendor: "Oakline Recruiting", account: "6850", lo: 8000, hi: 24000, perMonth: 0.2, threeWayRate: 0 },
    { vendor: "Juniper Office Products", account: "6500", lo: 200, hi: 1500, perMonth: 2, threeWayRate: 0 },
  ],
  "HLI-CA": [
    // Sized to cover HLI-CA equipment COGS relief (~2.15M over the window)
    // with buffer.
    { vendor: "Meridian Instrument Parts", account: "1200", lo: 32000, hi: 96000, perMonth: 4, threeWayRate: 0.85 },
    { vendor: "Thames Scientific Supply", account: "1210", lo: 2000, hi: 11000, perMonth: 2, threeWayRate: 0.7 },
    { vendor: "Atlas Calibration Consumables", account: "5030", lo: 300, hi: 1800, perMonth: 1, threeWayRate: 0.3 },
    { vendor: "Cortland Facilities Services", account: "6360", lo: 250, hi: 1600, perMonth: 0.8, threeWayRate: 0.2 },
    { vendor: "Vector Freight Systems", account: "5100", lo: 200, hi: 1900, perMonth: 1.5, threeWayRate: 0.4 },
  ],
  "HLS-LLC": [
    { vendor: "Atlas Calibration Consumables", account: "5020", lo: 400, hi: 2600, perMonth: 2, threeWayRate: 0.3 },
    { vendor: "Vector Freight Systems", account: "5100", lo: 150, hi: 1200, perMonth: 1, threeWayRate: 0.4 },
  ],
};

export function generateAp(
  ledger: Ledger,
  rng: SeededRng,
  months: MonthContext[],
  opts: { professionalServicesStepUp?: boolean } = {},
): void {
  let billSeq = 0;

  for (const ctx of months) {
    // Professional services (6100): steady ~140K/mo through 2025, stepping up
    // ~30K/mo in Q1 2026 — the genuine summary-visible driver scenario 3
    // offers before the reclass dominates (~90K/quarter, per the handoff's
    // flux story). HLI-US only (subs are too small). Calibrated so that the
    // TOTAL Q1−Q4 opex delta including the $280K reclass lands near the
    // ~$312K the learner brief quotes — the brief must match the data.
    const psStepUp =
      opts.professionalServicesStepUp !== false &&
      ctx.year === 2026 &&
      ctx.month >= 1 &&
      ctx.month <= 3;
    const psMonthly = psStepUp ? 170000 : 140000;
    const psAmount = round2(psMonthly * (0.92 + rng.next() * 0.16));
    billSeq += 1;
    const psId = `BILL-${String(billSeq).padStart(5, "0")}`;
    const psDate = `${ctx.year}-${String(ctx.month).padStart(2, "0")}-15`;
    ledger.bills.push({
      id: psId,
      entity: "HLI-US",
      vendor: "Halstead & Marsh LLP",
      date: psDate,
      dueDate: addDays(psDate, 30),
      amount: psAmount,
      currency: "USD",
      paidOn: addDays(psDate, 30),
      threeWayMatched: false,
    });
    ledger.journalEntries.push({
      id: `JE-AP-${psId}`,
      date: psDate,
      entity: "HLI-US",
      source: "ap",
      lines: [
        { accountId: "6100", entity: "HLI-US", debit: psAmount, credit: 0, memo: "Professional services" },
        { accountId: "2010", entity: "HLI-US", debit: 0, credit: psAmount },
      ],
      memo: `Bill ${psId} — professional services`,
    });
    // PS bill settles net-30 with a payment JE + bank line.
    ledger.journalEntries.push({
      id: `JE-PAY-${psId}`,
      date: addDays(psDate, 30),
      entity: "HLI-US",
      source: "ap",
      lines: [
        { accountId: "2010", entity: "HLI-US", debit: psAmount, credit: 0 },
        { accountId: "1010", entity: "HLI-US", debit: 0, credit: psAmount },
      ],
      memo: `Payment ${psId} — professional services`,
    });
    ledger.bankLines.push({
      id: `BK-OUT-${psId}`,
      entity: "HLI-US",
      date: addDays(psDate, 30),
      direction: "out",
      amount: psAmount,
      description: "ACH — Halstead & Marsh LLP",
      matchedEntryId: `JE-PAY-${psId}`,
    });

    for (const entity of ENTITY_IDS) {
      for (const spec of BILL_SPECS[entity] as BillSpec[]) {
        const count = Math.floor(spec.perMonth) + (rng.next() < spec.perMonth % 1 ? 1 : 0);
        for (let i = 0; i < count; i++) {
          billSeq += 1;
          const amount = round2(spec.lo + rng.next() * (spec.hi - spec.lo));
          const vendor = rng.chance(0.04)
            ? (VENDOR_TYPOS[spec.vendor] ?? spec.vendor)
            : spec.vendor;
          const day = rng.intInclusive(1, 27);
          const date = `${ctx.year}-${String(ctx.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const paidOn = rng.chance(0.88) ? addDays(date, rng.intInclusive(14, 45)) : undefined;

          const bill: ApBill = {
            id: `BILL-${String(billSeq).padStart(5, "0")}`,
            entity,
            vendor,
            date,
            dueDate: addDays(date, 30),
            amount,
            currency: entity === "HLI-CA" ? "CAD" : "USD",
            paidOn,
            threeWayMatched: rng.chance(spec.threeWayRate),
          };
          ledger.bills.push(bill);

          ledger.journalEntries.push({
            id: `JE-AP-${bill.id}`,
            date,
            entity,
            source: "ap",
            lines: [
              { accountId: spec.account, entity, debit: amount, credit: 0, memo: vendor },
              { accountId: "2010", entity, debit: 0, credit: amount },
            ],
            memo: `Bill ${bill.id} — ${spec.vendor}`,
          });

          if (paidOn) {
            ledger.journalEntries.push({
              id: `JE-PAY-${bill.id}`,
              date: paidOn,
              entity,
              source: "ap",
              lines: [
                { accountId: "2010", entity, debit: amount, credit: 0 },
                { accountId: "1010", entity, debit: 0, credit: amount },
              ],
              memo: `Payment ${bill.id} — ${vendor}`,
            });
            ledger.bankLines.push({
              id: `BK-OUT-${bill.id}`,
              entity,
              date: paidOn,
              direction: "out",
              amount,
              description: `ACH — ${vendor}`,
              matchedEntryId: `JE-PAY-${bill.id}`,
            });
          }
        }
      }
    }
  }
}
