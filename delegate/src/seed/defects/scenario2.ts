/**
 * Scenario 2 defect — Why doesn't intercompany balance?
 *
 * A single large IC charge (Meridian program costs, CAD 139,400) is booked:
 *  - on HLI-CA (lender): a USD-denominated receivable held in CAD functional,
 *    converted at the 3/15 transaction-date rate (0.769) → USD 107,188.60
 *  - on HLI-US (borrower): the mirrored payable converted at the 3/31
 *    month-end rate (0.739) → USD 103,006.60
 *
 * Variance: USD 4,182.00 — pure FX timing. Both entries are individually
 * defensible; neither side is "wrong". The FX rate table exists as data
 * (get_fx_rates), but the agent never reaches for it unless the learner
 * points it there (handoff §4, scenario 2 mechanic).
 *
 * The defect deliberately targets the US↔CA pair only. The IC mirror gate
 * tolerates exactly this one variance by pair (see checkIntercompany),
 * because the two sides are recorded in different currencies converted at
 * different rates — a timing difference, not a broken ledger.
 */

import { SCENARIO2_IC_CAD_AMOUNT } from "../profile";
import type { Ledger } from "../types";

export const SCENARIO2 = {
  cadAmount: SCENARIO2_IC_CAD_AMOUNT, // 139,400
  txDate: "2026-03-15",
  usBookDate: "2026-03-31",
  midMarchRate: 0.769, // transaction-date rate (CA side)
  monthEndRate: 0.739, // month-end rate (US side)
  program: "Meridian calibration platform build",
  /** CA-side receivable booked in USD terms at the tx-date rate. */
  get usdAtTxRate(): number {
    return Math.round(this.cadAmount * this.midMarchRate * 100) / 100;
  },
  /** US-side payable booked at the month-end rate. */
  get usdAtMonthEnd(): number {
    return Math.round(this.cadAmount * this.monthEndRate * 100) / 100;
  },
  get variance(): number {
    return Math.round((this.usdAtTxRate - this.usdAtMonthEnd) * 100) / 100;
  },
  entryCaId: "JE-S2-IC-CA",
  entryUsId: "JE-S2-IC-US",
} as const;

export function applyScenario2(ledger: Ledger): void {
  const s = SCENARIO2;

  // CA side: booked in CAD functional. The receivable is denominated in USD
  // (parent-invoiced), so the CAD-side carrying amount reflects the 3/15
  // rate. Recorded as CAD 139,400 × 0.769 → USD-equivalent 107,188.60.
  ledger.journalEntries.push({
    id: s.entryCaId,
    date: s.txDate,
    entity: "HLI-CA",
    source: "intercompany",
    lines: [
      {
        accountId: "1250",
        entity: "HLI-CA",
        debit: s.usdAtTxRate,
        credit: 0,
        memo: `IC receivable — HLI-US (${s.program}), USD-denominated @ 0.769 (3/15)`,
      },
      {
        accountId: "4020",
        entity: "HLI-CA",
        debit: 0,
        credit: s.usdAtTxRate,
        memo: "Contract engineering services — Meridian program",
      },
    ],
    memo: `IC charge to HLI-US — ${s.program} (CAD ${s.cadAmount.toLocaleString("en-CA")} @ 3/15 rate)`,
  });

  // US side: payable at the 3/31 month-end rate.
  ledger.journalEntries.push({
    id: s.entryUsId,
    date: s.usBookDate,
    entity: "HLI-US",
    source: "intercompany",
    lines: [
      {
        accountId: "5020",
        entity: "HLI-US",
        debit: s.usdAtMonthEnd,
        credit: 0,
        memo: "Contract engineering — Meridian program",
      },
      {
        accountId: "2255",
        entity: "HLI-US",
        debit: 0,
        credit: s.usdAtMonthEnd,
        memo: `IC payable — HLI-CA (${s.program}), booked @ 0.739 (3/31 close)`,
      },
    ],
    memo: `IC charge from HLI-CA — ${s.program}`,
  });
}
