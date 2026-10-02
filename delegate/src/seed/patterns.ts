/**
 * Recurring monthly patterns (handoff §3.3 patterns.ts): rent, payroll,
 * software subscriptions, utilities. These run for all 13 seeded months
 * across all three entities and provide the steady base the flux scenarios
 * depend on — the period-to-period movement should be boring except where
 * a scenario defect or deliberate seasonality says otherwise.
 */

import { ACCOUNTS, ENTITY_IDS, VENDORS } from "./profile";
import { SeededRng } from "./rng";
import type { EntityId, JournalEntry, Ledger } from "./types";
import { endOfMonth, round2 } from "./types";

interface MonthContext {
  year: number;
  month: number; // 1-12
  monthIndex: number; // 0..12 across the seed window
  periodStart: string;
  periodEnd: string;
}

function monthContexts(): MonthContext[] {
  // 13 months ending in the close period under test: prior-year Mar ..
  // current Mar (handoff tests a March close and a Q1-vs-Q4 flux, so the
  // window must end in March; the doc's "prior-year Jan" is internally
  // inconsistent with its own QoQ scenario — deviation documented in README).
  const contexts: MonthContext[] = [];
  const startYear = 2025;
  const startMonth = 3;
  for (let i = 0; i < 13; i++) {
    const m0 = startMonth - 1 + i;
    const year = startYear + Math.floor(m0 / 12);
    const month = (m0 % 12) + 1;
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    contexts.push({
      year,
      month,
      monthIndex: i,
      periodStart: `${ym}-01`,
      periodEnd: endOfMonth(`${ym}-01`),
    });
  }
  return contexts;
}

export const SEED_MONTHS = monthContexts();

function entry(
  id: string,
  date: string,
  entity: EntityId,
  source: JournalEntry["source"],
  lines: JournalEntry["lines"],
  memo?: string,
): JournalEntry {
  return { id, date, entity, source, lines, memo };
}

/** Rent across entities; modest annual escalator each January. */
export function generateRent(ledger: Ledger, rng: SeededRng): void {
  for (const ctx of SEED_MONTHS) {
    for (const entity of ENTITY_IDS) {
      const base =
        entity === "HLI-US" ? 42500 : entity === "HLI-CA" ? 16800 : 7900;
      const escalator = ctx.month === 1 ? 1 + (ctx.year - 2025) * 0.03 : 1;
      const amount = round2(base * escalator);
      ledger.journalEntries.push(
        entry(
          `rent-${entity}-${ctx.year}-${ctx.month}`,
          ctx.periodStart,
          entity,
          "patterns",
          [
            {
              accountId: "6050",
              entity,
              debit: amount,
              credit: 0,
              memo: "Monthly rent",
            },
            {
              accountId: "2010",
              entity,
              debit: 0,
              credit: amount,
              memo: "Accrued rent payable",
            },
          ],
        ),
      );
      // Rent is paid from the operating account on the 1st.
      ledger.journalEntries.push(
        entry(
          `rent-pay-${entity}-${ctx.year}-${ctx.month}`,
          ctx.periodStart,
          entity,
          "patterns",
          [
            { accountId: "2010", entity, debit: amount, credit: 0 },
            { accountId: "1010", entity, debit: 0, credit: amount },
          ],
          "Rent payment",
        ),
      );
      ledger.bankLines.push({
        id: `BK-RENT-${entity}-${ctx.year}-${ctx.month}`,
        entity,
        date: ctx.periodStart,
        direction: "out",
        amount,
        description: "Rent — Cortland Facilities",
        matchedEntryId: `rent-pay-${entity}-${ctx.year}-${ctx.month}`,
      });
    }
  }
}/**
 * Semi-monthly payroll, employer taxes, and benefits per entity.
 * Net pay is settled from the payroll bank account (1020) mid-month and
 * month-end with a payment journal + bank line, so cash activity reflects
 * real payroll movement instead of a permanently accrued liability.
 */
export function generatePayroll(ledger: Ledger, rng: SeededRng): void {
  for (const ctx of SEED_MONTHS) {
    for (const entity of ENTITY_IDS) {
      const headcount =
        entity === "HLI-US" ? 86 : entity === "HLI-CA" ? 22 : 14;
      const perPeriod =
        entity === "HLI-US" ? 6100 : entity === "HLI-CA" ? 8200 : 7400; // CAD for CA
      const periods = 2;
      const growth = 1 + ctx.monthIndex * 0.004; // mild headcount creep
      const gross = round2(headcount * perPeriod * periods * growth);
      const taxes = round2(gross * 0.092);
      const benefits = round2(gross * 0.114);
      /** Current-year January bonus, current-year March Q1 bonus. */
      const bonus =
        ctx.month === 1 && ctx.year === 2026
          ? round2(gross * 0.08)
          : ctx.month === 3 && ctx.year === 2026
            ? round2(gross * 0.045)
            : 0;

      const lines: JournalEntry["lines"] = [
        { accountId: "6010", entity, debit: gross, credit: 0 },
      ];
      if (bonus > 0) {
        lines.push({ accountId: "6020", entity, debit: bonus, credit: 0 });
      }
      lines.push(
        { accountId: "6040", entity, debit: taxes, credit: 0 },
        { accountId: "6030", entity, debit: benefits, credit: 0 },
        { accountId: "2060", entity, debit: 0, credit: round2(gross + bonus) },
        { accountId: "2010", entity, debit: 0, credit: round2(taxes + benefits) },
      );
      ledger.journalEntries.push(
        entry(
          `payroll-${entity}-${ctx.year}-${ctx.month}`,
          ctx.periodEnd,
          entity,
          "payroll",
          lines,
          "Semi-monthly payroll accrual",
        ),
      );

      // Settlement: net pay + taxes/benefits remitted from payroll cash.
      const netPay = round2((gross + bonus) * 0.78);
      const remit = round2(taxes + benefits);
      const settleDate = ctx.periodEnd;
      ledger.journalEntries.push(
        entry(
          `payroll-settle-${entity}-${ctx.year}-${ctx.month}`,
          settleDate,
          entity,
          "payroll",
          [
            { accountId: "2060", entity, debit: netPay, credit: 0 },
            { accountId: "2010", entity, debit: remit, credit: 0 },
            { accountId: "1020", entity, debit: 0, credit: round2(netPay + remit) },
          ],
          "Payroll settlement",
        ),
      );
      ledger.bankLines.push({
        id: `BK-PR-${entity}-${ctx.year}-${ctx.month}`,
        entity,
        date: settleDate,
        direction: "out",
        amount: round2(netPay + remit),
        description: "Payroll batch",
        matchedEntryId: `payroll-settle-${entity}-${ctx.year}-${ctx.month}`,
      });
    }
  }
}

/**
 * Software subscriptions — deliberately split across 6410 and 6455
 * (imperfection 1) so controllers who know the COA wince slightly.
 */
export function generateSubscriptions(ledger: Ledger, rng: SeededRng): void {
  const cloudVendor = VENDORS[4] as string;
  for (const ctx of SEED_MONTHS) {
    for (const entity of ENTITY_IDS) {
      const usd =
        entity === "HLI-US" ? 21800 : entity === "HLI-CA" ? 4900 : 3600;
      const amount = round2(usd * (0.97 + rng.next() * 0.06));
      // Deterministic 60/40 split between the two should-be-one accounts.
      const to6410 = round2(amount * 0.6);
      const to6455 = round2(amount - to6410);
      ledger.journalEntries.push(
        entry(
          `subs-${entity}-${ctx.year}-${ctx.month}`,
          ctx.periodEnd,
          entity,
          "patterns",
          [
            { accountId: "6410", entity, debit: to6410, credit: 0, memo: cloudVendor },
            { accountId: "6455", entity, debit: to6455, credit: 0, memo: cloudVendor },
            { accountId: "1010", entity, debit: 0, credit: amount },
          ],
        ),
      );
      // Subscription bills auto-debit the operating account.
      ledger.bankLines.push({
        id: `BK-SUBS-${entity}-${ctx.year}-${ctx.month}`,
        entity,
        date: ctx.periodEnd,
        direction: "out",
        amount,
        description: `Auto-debit — ${cloudVendor}`,
        matchedEntryId: `subs-${entity}-${ctx.year}-${ctx.month}`,
      });
    }
  }
}

/** Utilities with seasonal shape (labs run HVAC hard in summer). */
export function generateUtilities(ledger: Ledger, rng: SeededRng): void {
  for (const ctx of SEED_MONTHS) {
    for (const entity of ENTITY_IDS) {
      const base = entity === "HLI-US" ? 9800 : entity === "HLI-CA" ? 3900 : 1700;
      const seasonal = 1 + 0.18 * Math.sin(((ctx.month - 3) / 12) * 2 * Math.PI);
      const amount = round2(base * seasonal * (0.95 + rng.next() * 0.1));
      ledger.journalEntries.push(
        entry(
          `util-${entity}-${ctx.year}-${ctx.month}`,
          ctx.periodEnd,
          entity,
          "patterns",
          [
            { accountId: "6060", entity, debit: amount, credit: 0 },
            { accountId: "1010", entity, debit: 0, credit: amount },
          ],
        ),
      );
      ledger.bankLines.push({
        id: `BK-UTIL-${entity}-${ctx.year}-${ctx.month}`,
        entity,
        date: ctx.periodEnd,
        direction: "out",
        amount,
        description: "Utilities — Copperfield Utilities",
        matchedEntryId: `util-${entity}-${ctx.year}-${ctx.month}`,
      });
    }
  }
}

/**
 * Suspense-account texture (imperfection 2): small unreconciled amounts
 * accumulate on 1999 at a slow, boring rate — never cleared in the base,
 * so it carries a non-trivial balance by the close period.
 */
export function generateSuspenseDrift(ledger: Ledger, rng: SeededRng): void {
  for (const ctx of SEED_MONTHS) {
    for (const entity of ENTITY_IDS) {
      if (!rng.chance(0.4)) continue;
      const amount = round2(120 + rng.next() * 900);
      ledger.journalEntries.push(
        entry(
          `suspense-${entity}-${ctx.year}-${ctx.month}`,
          ctx.periodEnd,
          entity,
          "patterns",
          [
            { accountId: "1999", entity, debit: amount, credit: 0, memo: "Unidentified remittance" },
            { accountId: "2090", entity, debit: 0, credit: amount, memo: "Cash applied pending ID" },
          ],
        ),
      );
    }
  }
}

/** Run all recurring patterns; mutates ledger in place. */
export function generatePatterns(ledger: Ledger, rng: SeededRng): void {
  generateRent(ledger, rng);
  generatePayroll(ledger, rng);
  generateSubscriptions(ledger, rng);
  generateUtilities(ledger, rng);
  generateSuspenseDrift(ledger, rng);
}

/** Keep the ACCOUNTS import referenced for account-code validation in tests. */
export function assertAccountsExist(codes: string[]): void {
  const known = new Set(ACCOUNTS.map((a) => a.code));
  for (const code of codes) {
    if (!known.has(code)) throw new Error(`Unknown account code: ${code}`);
  }
}
