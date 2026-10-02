/**
 * Bank feed generator (handoff §3.3 generators/bank.ts).
 *
 * Most bank lines are the mirrored cash side of GL activity already emitted
 * by the revenue/AP generators (those push their own bank lines with
 * matchedEntryId set). This module adds the texture that makes March
 * reconciliation non-trivial WITHOUT planting signal:
 *   - a few days of float between GL posting and bank settlement,
 *   - bank fees,
 *   - interest,
 *   - customer receipts posted in-period but settling after month-end.
 */

import { CUSTOMERS, ENTITY_IDS } from "../profile";
import type { SeededRng } from "../rng";
import type { BankLine, EntityId, Ledger } from "../types";
import { addDays, round2 } from "../types";

interface MonthContext {
  year: number;
  month: number;
  periodEnd: string;
}

export function generateBankTexture(
  ledger: Ledger,
  rng: SeededRng,
  months: MonthContext[],
): void {
  for (const ctx of months) {
    for (const entity of ENTITY_IDS) {
      // ── Bank fees ───────────────────────────────────────────
      const fee = round2(180 + rng.next() * 240);
      ledger.journalEntries.push({
        id: `JE-FEE-${entity}-${ctx.year}-${ctx.month}`,
        date: ctx.periodEnd,
        entity,
        source: "bank",
        lines: [
          { accountId: "6700", entity, debit: fee, credit: 0 },
          { accountId: "1010", entity, debit: 0, credit: fee },
        ],
        memo: "Monthly account analysis fee",
      });
      ledger.bankLines.push({
        id: `BK-FEE-${entity}-${ctx.year}-${ctx.month}`,
        entity,
        date: ctx.periodEnd,
        direction: "out",
        amount: fee,
        description: "Account analysis fee",
        matchedEntryId: `JE-FEE-${entity}-${ctx.year}-${ctx.month}`,
      });

      // ── Interest income ─────────────────────────────────────
      const interest = round2(90 + rng.next() * 400);
      ledger.journalEntries.push({
        id: `JE-INT-${entity}-${ctx.year}-${ctx.month}`,
        date: ctx.periodEnd,
        entity,
        source: "bank",
        lines: [
          { accountId: "1010", entity, debit: interest, credit: 0 },
          {
            accountId: "6710",
            entity,
            debit: 0,
            credit: interest,
            memo: "Interest credited",
          },
        ],
        memo: "Interest income",
      });
      ledger.bankLines.push({
        id: `BK-INT-${entity}-${ctx.year}-${ctx.month}`,
        entity,
        date: ctx.periodEnd,
        direction: "in",
        amount: interest,
        description: "Interest paid",
        matchedEntryId: `JE-INT-${entity}-${ctx.year}-${ctx.month}`,
      });      // ── Float: late-settling receipts recorded before month-end ──
      // GL cash posted on/before period end, bank settles a few days after.
      // These create legitimate outstanding items, not defects.
      const lateCount = rng.intInclusive(1, 3);
      for (let i = 0; i < lateCount; i++) {
        const customer = rng.pick(CUSTOMERS);
        const amount = round2(2400 + rng.next() * 9800);
        const postDay = rng.intInclusive(24, 28);
        const postDate = `${ctx.year}-${String(ctx.month).padStart(2, "0")}-${String(postDay).padStart(2, "0")}`;
        const settle = addDays(postDate, rng.intInclusive(2, 5));
        ledger.journalEntries.push({
          id: `JE-FLT-${entity}-${ctx.year}-${ctx.month}-${i}`,
          date: postDate,
          entity,
          source: "bank",
          lines: [
            { accountId: "1010", entity, debit: amount, credit: 0 },
            { accountId: "2090", entity, debit: 0, credit: amount, memo: `Customer deposit — ${customer}` },
          ],
          memo: `Deposit in transit — ${customer}`,
        });
        ledger.bankLines.push({
          id: `BK-FLT-${entity}-${ctx.year}-${ctx.month}-${i}`,
          entity,
          date: settle, // after period end → outstanding item
          direction: "in",
          amount,
          description: `Deposit — ${customer}`,
          matchedEntryId: `JE-FLT-${entity}-${ctx.year}-${ctx.month}-${i}`,
        });
      }
    }
  }
}
