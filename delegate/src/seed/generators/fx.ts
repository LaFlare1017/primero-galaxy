/**
 * FX generator (handoff §3.3 generators/fx.ts).
 *
 * HLI-CA (CAD functional) holds a USD time deposit — the classic anchor for
 * real revaluation entries. Each month-end, the deposit is remeasured at the
 * month-end rate, producing a genuine FX gain/loss on 6710 and keeping the
 * rate table load-bearing (scenario 2 depends on it existing as data, and
 * on `get_fx_rates` being a separate, unvolunteered tool).
 */

import { FX_CAD_USD } from "../profile";
import type { SeededRng } from "../rng";
import type { Ledger } from "../types";
import { round2 } from "../types";

interface MonthContext {
  year: number;
  month: number;
  monthIndex: number;
  periodEnd: string;
}

/** HLI-CA's USD time deposit principal, in USD. */
const US_TIME_DEPOSIT_USD = 850_000;

export function generateFxRevaluation(
  ledger: Ledger,
  _rng: SeededRng,
  months: MonthContext[],
): void {
  let priorCarryingCad: number | null = null;

  for (const ctx of months) {
    const rate = FX_CAD_USD[Math.min(ctx.monthIndex, FX_CAD_USD.length - 1)] as number;
    const carrying = round2(US_TIME_DEPOSIT_USD * rate);

    if (priorCarryingCad !== null) {
      const delta = round2(carrying - priorCarryingCad);
      if (delta !== 0) {
        const gain = delta > 0; // USD strengthened in CAD terms
        ledger.journalEntries.push({
          id: `JE-FX-${ctx.year}-${ctx.month}`,
          date: ctx.periodEnd,
          entity: "HLI-CA",
          source: "fx",
          lines: [
            {
              accountId: "1030",
              entity: "HLI-CA",
              debit: gain ? delta : 0,
              credit: gain ? 0 : delta,
              memo: `USD time deposit remeasurement → CAD ${carrying} @ ${rate}`,
            },
            {
              accountId: "6710",
              entity: "HLI-CA",
              debit: gain ? 0 : delta,
              credit: gain ? delta : 0,
              memo: gain ? "FX gain" : "FX loss",
            },
          ],
          memo: `FX revaluation ${ctx.year}-${ctx.month} @ ${rate}`,
        });
      }
    }
    priorCarryingCad = carrying;
  }
}
