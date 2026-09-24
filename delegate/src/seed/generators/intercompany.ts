/**
 * Intercompany generator (handoff §3.3 generators/intercompany.ts).
 *
 * Monthly IC charges across all three entity pairs, always mirrored: a
 * charge on the lender's books to its IC receivable exactly equals the
 * charge on the borrower's books to its IC payable. In the CLEAN BASE the
 * pairs net to zero by construction — the scenario-2 defect (FX timing on
 * the CAD leg) is applied later, as a separate pass, so this gate stays honest.
 */

import { ENTITY_IDS } from "../profile";
import type { SeededRng } from "../rng";
import type { EntityId, JournalEntry, Ledger } from "../types";
import { endOfMonth, round2 } from "../types";

interface MonthContext {
  year: number;
  month: number;
  periodEnd: string;
}

/** Receivable/payable account codes per counterparty. */
function icAccounts(self: EntityId, counterparty: EntityId): { recv: string; pay: string } {
  const suffix =
    counterparty === "HLI-US" ? "1250" : counterparty === "HLI-CA" ? "1255" : "1260";
  const paySuffix =
    counterparty === "HLI-US" ? "2250" : counterparty === "HLI-CA" ? "2255" : "2260";
  void self;
  return { recv: suffix, pay: paySuffix };
}

/** Cross-entity service charges: shared services billed parent → subs. */
export function generateIntercompany(
  ledger: Ledger,
  rng: SeededRng,
  months: MonthContext[],
): void {
  for (const ctx of months) {
    const periodEnd = endOfMonth(`${ctx.year}-${String(ctx.month).padStart(2, "0")}-01`);

    // Parent charges subs for shared services (IT, finance, HR allocation).
    for (const sub of ["HLI-CA", "HLS-LLC"] as EntityId[]) {
      const scale = sub === "HLI-CA" ? 0.26 : 0.18;
      const amount = round2(68000 * scale * (0.96 + rng.next() * 0.08));
      // US-side receivable keyed by counterparty; sub-side payable is always
      // 2250 (payable to the parent) — keyed by who is OWED, not who owes.
      const recv = sub === "HLI-CA" ? "1255" : "1260";
      const pay = "2250";

      ledger.journalEntries.push({
        id: `JE-IC-US-${sub}-${ctx.year}-${ctx.month}`,
        date: periodEnd,
        entity: "HLI-US",
        source: "intercompany",
        lines: [
          {
            accountId: recv,
            entity: "HLI-US",
            debit: amount,
            credit: 0,
            memo: `Shared services — ${sub}`,
          },
          {
            accountId: "6010",
            entity: "HLI-US",
            debit: 0,
            credit: amount,
            memo: "Shared services recovery",
          },
        ],
        memo: `IC charge to ${sub}`,
      });

      ledger.journalEntries.push({
        id: `JE-IC-${sub}-US-${ctx.year}-${ctx.month}`,
        date: periodEnd,
        entity: sub,
        source: "intercompany",
        lines: [
          { accountId: "6010", entity: sub, debit: amount, credit: 0, memo: "Shared services allocation" },
          { accountId: pay, entity: sub, debit: 0, credit: amount },
        ],
        memo: `IC charge from HLI-US`,
      });
    }

    // Services LLC performs contract work for the parent (cross-charge).
    const svc = round2(14500 * (0.9 + rng.next() * 0.2));
    ledger.journalEntries.push({
      id: `JE-IC-LLC-US-${ctx.year}-${ctx.month}`,
      date: periodEnd,
      entity: "HLS-LLC",
      source: "intercompany",
      lines: [
        { accountId: "1250", entity: "HLS-LLC", debit: svc, credit: 0, memo: "Contract services — HLI-US" },
        { accountId: "4020", entity: "HLS-LLC", debit: 0, credit: svc },
      ],
      memo: "IC services to parent",
    });
    ledger.journalEntries.push({
      id: `JE-IC-US-LLC-${ctx.year}-${ctx.month}`,
      date: periodEnd,
      entity: "HLI-US",
      source: "intercompany",
      lines: [
        { accountId: "5020", entity: "HLI-US", debit: svc, credit: 0 },
        { accountId: "2260", entity: "HLI-US", debit: 0, credit: svc, memo: "IC payable — HLS-LLC" },
      ],
      memo: "IC services from HLS-LLC",
    });

    // Canada↔US equipment movement, occasionally (deterministic ~40%).
    if (rng.chance(0.4)) {
      const equip = round2(22000 * (0.8 + rng.next() * 0.5));
      ledger.journalEntries.push({
        id: `JE-IC-US-CA-${ctx.year}-${ctx.month}`,
        date: periodEnd,
        entity: "HLI-US",
        source: "intercompany",
        lines: [
          { accountId: "1255", entity: "HLI-US", debit: equip, credit: 0, memo: "Inventory transfer — HLI-CA" },
          { accountId: "1200", entity: "HLI-US", debit: 0, credit: equip },
        ],
        memo: "IC inventory transfer",
      });
      ledger.journalEntries.push({
        id: `JE-IC-CA-US-${ctx.year}-${ctx.month}`,
        date: periodEnd,
        entity: "HLI-CA",
        source: "intercompany",
        lines: [
          { accountId: "1210", entity: "HLI-CA", debit: equip, credit: 0 },
          { accountId: "2250", entity: "HLI-CA", debit: 0, credit: equip, memo: "IC payable — HLI-US" },
        ],
        memo: "IC inventory receipt",
      });
    }
  }
}

/** IC counterparty pairs used by the balance gate. */
export const IC_PAIRS: Array<[EntityId, EntityId]> = [
  ["HLI-US", "HLI-CA"],
  ["HLI-US", "HLS-LLC"],
  ["HLI-CA", "HLS-LLC"],
];
