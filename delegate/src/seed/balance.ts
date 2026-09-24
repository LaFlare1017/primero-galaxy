/**
 * Balance gate (handoff §1 — the hard technical gate).
 *
 * Every check returns a precise failure reason. The gate must fail loudly
 * and early: nothing downstream (defects, agent, UI, scoring) is trustworthy
 * if the clean base doesn't balance.
 */

import { ACCOUNTS, ENTITY_IDS } from "./profile";
import { SCENARIO2 } from "./defects/scenario2";
import type { EntityId, Ledger } from "./types";
import { round2 } from "./types";

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

const EPS = 0.005; // half a cent — rounding tolerance

function accountType(code: string): string | undefined {
  return ACCOUNTS.find((a) => a.code === code)?.type;
}

/** Debits minus credits per account, per entity. */
export function balancesByAccount(ledger: Ledger): Map<string, number> {
  const balances = new Map<string, number>();
  for (const je of ledger.journalEntries) {
    for (const line of je.lines) {
      const key = `${line.entity}:${line.accountId}`;
      const delta = line.debit - line.credit;
      balances.set(key, (balances.get(key) ?? 0) + delta);
    }
  }
  return balances;
}

/** 1. Trial balance: per entity, total debits == total credits. */
export function checkTrialBalance(ledger: Ledger): CheckResult[] {
  return ENTITY_IDS.map((entity) => {
    let debits = 0;
    let credits = 0;
    for (const je of ledger.journalEntries) {
      if (je.entity !== entity) continue;
      for (const line of je.lines) {
        if (line.entity !== entity) {
          return {
            name: `Trial balance — ${entity}`,
            passed: false,
            detail: `Entry ${je.id} has a line for wrong entity ${line.entity}`,
          } satisfies CheckResult;
        }
        debits += line.debit;
        credits += line.credit;
      }
    }
    const diff = round2(debits - credits);
    return {
      name: `Trial balance — ${entity}`,
      passed: Math.abs(diff) < EPS,
      detail: `debits ${round2(debits)} vs credits ${round2(credits)} (Δ ${diff})`,
    } satisfies CheckResult;
  });
}

/**
 * 2. Every journal entry is internally balanced (debit == credit per entry).
 * Stricter than the entity-level trial balance; catches generator bugs early.
 */
export function checkEntryBalance(ledger: Ledger): CheckResult {
  const bad = ledger.journalEntries.filter((je) => {
    const sum = je.lines.reduce((acc, l) => acc + l.debit - l.credit, 0);
    return Math.abs(sum) >= EPS;
  });
  return {
    name: "Journal entries internally balanced",
    passed: bad.length === 0,
    detail:
      bad.length === 0
        ? `all ${ledger.journalEntries.length} entries balanced`
        : `unbalanced: ${bad.slice(0, 5).map((j) => j.id).join(", ")}${bad.length > 5 ? ` (+${bad.length - 5} more)` : ""}`,
  };
}

/**
 * 3. Intercompany nets to zero (consolidated mirror): every IC dollar is
 * booked once as a receivable and once as a payable, so total 125x receivables
 * across all entities must equal total 225x payables. A per-entity recv==pay
 * check would be wrong — an entity may legitimately be a net receivor.
 * Also verifies the three explicit pair mappings used by the generator.
 */
export function checkIntercompany(
  ledger: Ledger,
  allowScenario2Variance = false,
): CheckResult[] {
  const results: CheckResult[] = [];
  const RECV_CODES = new Set(["1250", "1255", "1260"]);
  const PAY_CODES = new Set(["2250", "2255", "2260"]);

  let totalRecv = 0;
  let totalPay = 0;
  const nets = new Map<string, number>(); // `${entity}:${code}` net balance
  for (const je of ledger.journalEntries) {
    for (const line of je.lines) {
      const key = `${line.entity}:${line.accountId}`;
      if (RECV_CODES.has(line.accountId)) {
        const delta = line.debit - line.credit;
        nets.set(key, (nets.get(key) ?? 0) + delta);
        totalRecv += delta;
      }
      if (PAY_CODES.has(line.accountId)) {
        const delta = line.credit - line.debit;
        nets.set(key, (nets.get(key) ?? 0) + delta);
        totalPay += delta;
      }
    }
  }

  const tol = round2(SCENARIO2.variance);
  const rawDiff = round2(totalRecv - totalPay);
  const tolerated = allowScenario2Variance && Math.abs(rawDiff - tol) < EPS;
  const ok = tolerated || (!allowScenario2Variance && Math.abs(rawDiff) < EPS);

  results.push({
    name: "IC nets to zero — consolidated",
    passed: ok,
    detail: ok
      ? `total receivables ${round2(totalRecv)} vs total payables ${round2(totalPay)}${tolerated ? ` (S2 FX timing $${tol} tolerated by design)` : ""}`
      : `total receivables ${round2(totalRecv)} vs total payables ${round2(totalPay)} (Δ ${round2(totalRecv - totalPay)}; expected tolerance $${tol} only)`,
  });

  // Generator pair mappings: (US:1255 ↔ CA:2250), (US:1260 ↔ LLC:2250),
  // (LLC:1250 ↔ US:2260). If generator pairings change, update here.
  // The scenario-2 variance does NOT touch these pairs — it books on
  // HLI-CA:1250 vs HLI-US:2255, which this consolidated check (with the
  // tolerated-by-design variance above) is what surfaces.
  const pairs: Array<[string, string, string]> = [
    ["HLI-US:1255", "HLI-CA:2250", "US ↔ CA"],
    ["HLI-US:1260", "HLS-LLC:2250", "US ↔ LLC (shared services)"],
    ["HLS-LLC:1250", "HLI-US:2260", "LLC ↔ US (contract services)"],
  ];
  for (const [a, b, label] of pairs) {
    const va = round2(nets.get(a) ?? 0);
    const vb = round2(nets.get(b) ?? 0);
    results.push({
      name: `IC pair mirror — ${label}`,
      passed: Math.abs(va - vb) < EPS,
      detail: `${a} ${va} vs ${b} ${vb}`,
    });
  }
  return results;
}

/**
 * 4. Bank reconciles to zero: per entity, bank lines marked settled
 * (matchedEntryId) must exactly equal the cash-side of the matching GL
 * entries. Unmatched (outstanding) items are reported, not failed — they
 * are legitimate timing texture.
 */
const CASH_ACCOUNTS = new Set(["1010", "1020", "1030"]);

export function checkBankReconciliation(ledger: Ledger): CheckResult[] {
  return ENTITY_IDS.map((entity) => {
    let mismatch = 0;
    const matched = ledger.bankLines.filter(
      (b) => b.entity === entity && b.matchedEntryId,
    );
    const jeById = new Map(ledger.journalEntries.map((j) => [j.id, j]));
    for (const line of matched) {
      const je = line.matchedEntryId ? jeById.get(line.matchedEntryId) : undefined;
      if (!je) {
        mismatch += 1;
        continue;
      }
      // The cash side of the entry must equal the bank line amount+direction.
      const cashLine = je.lines.find((l) => CASH_ACCOUNTS.has(l.accountId));
      if (!cashLine) {
        mismatch += 1;
        continue;
      }
      const glDelta = round2(cashLine.debit - cashLine.credit);
      const bankDelta = line.direction === "in" ? line.amount : -line.amount;
      if (Math.abs(glDelta - bankDelta) >= EPS) {
        mismatch += 1;
      }
    }
    const outstanding = ledger.bankLines.filter(
      (b) => b.entity === entity && !b.matchedEntryId,
    ).length;
    return {
      name: `Bank reconciliation — ${entity}`,
      passed: mismatch === 0,
      detail:
        mismatch === 0
          ? `${matched.length} settled lines tie to GL; ${outstanding} outstanding items`
          : `${mismatch} of ${matched.length} settled lines do not tie to GL`,
    } satisfies CheckResult;
  });
}

/**
 * 4b. AP tie-out: book AP (2010) equals unpaid bills per entity.
 * Per-entry balance is already covered; this checks the subledger.
 */
export function checkApTieOut(ledger: Ledger): CheckResult[] {
  return ENTITY_IDS.map((entity) => {
    let apCredits = 0;
    let apDebits = 0;
    for (const je of ledger.journalEntries) {
      if (je.entity !== entity) continue;
      for (const line of je.lines) {
        if (line.accountId !== "2010") continue;
        apCredits += line.credit;
        apDebits += line.debit;
      }
    }
    const bookAp = round2(apCredits - apDebits);
    const openBills = round2(
      ledger.bills
        .filter((b) => b.entity === entity && !b.paidOn)
        .reduce((s, b) => s + b.amount, 0),
    );
    const diff = round2(bookAp - openBills);
    return {
      name: `AP tie-out — ${entity}`,
      passed: Math.abs(diff) < EPS,
      detail: `book AP ${bookAp} vs open bills ${openBills}`,
    } satisfies CheckResult;
  });
}

/**
 * 4c. Inventory coherence: relief via COGS and stock build via purchases
 * must keep 1200/1210 balances non-negative per entity.
 */
export function checkInventoryNonNegative(ledger: Ledger): CheckResult[] {
  const codes = ["1200", "1210"];
  return ENTITY_IDS.flatMap((entity) =>
    codes.map((code) => {
      let bal = 0;
      for (const je of ledger.journalEntries) {
        if (je.entity !== entity) continue;
        for (const line of je.lines) {
          if (line.accountId !== code) continue;
          bal += line.debit - line.credit;
        }
      }
      const balance = round2(bal);
      return {
        name: `Inventory non-negative — ${entity}:${code}`,
        passed: balance >= -EPS,
        detail: `balance ${balance}`,
      } satisfies CheckResult;
    }),
  );
}

/**
 * 5. AR tie-out: sum of open invoices NET OF OPEN CREDIT MEMOS equals the
 * AR balance on the books, per entity. Credits are part of the AR
 * subledger — an aging that ignores them overstates receivables (the
 * scenario-4 defect is exactly that query).
 */
export function checkArTieOut(ledger: Ledger): CheckResult[] {
  const AS_OF = "2026-03-31"; // close date — late-settling texture books after
  return ENTITY_IDS.map((entity) => {
    // Subledger as of close: invoices opened on/before close, net of credit
    // memos, less receipts settled by close (paidOn within the window).
    const openedByClose = ledger.invoices.filter(
      (inv) => inv.entity === entity && inv.date <= AS_OF,
    );
    const openInvoices = openedByClose
      .filter((inv) => !(inv.paidOn && inv.paidOn <= AS_OF))
      .reduce((s, inv) => s + inv.amount, 0);
    const openCredits = ledger.creditMemos
      .filter((cm) => cm.entity === entity && cm.date <= AS_OF)
      .reduce((s, cm) => s + cm.amount, 0);
    // AR book balance = AR debits - AR credits - receipts applied.
    // Because receipts credit AR and the invoice debits AR, book AR should
    // equal open invoices when every receipt matches a seeded invoice.
    let arDebits = 0;
    let arCredits = 0;
    for ( const je of ledger.journalEntries) {
      if (je.entity !== entity || je.date > AS_OF) continue;
      for (const line of je.lines) {
        if (line.accountId !== "1100") continue;
        arDebits += line.debit;
        arCredits += line.credit;
        void je;
      }
    }
    const bookAr = round2(arDebits - arCredits);
    const open = round2(openInvoices - openCredits);
    // The tie-out must be exact: unapplied customer cash is booked to
    // Customer Deposits (2090) or suspense (1999), never as an AR credit,
    // so book AR equals open invoices by construction.
    const diff = round2(bookAr - open);
    return {
      name: `AR tie-out — ${entity}`,
      passed: Math.abs(diff) < EPS,
      detail: `book AR ${bookAr} vs open invoices ${open}`,
    } satisfies CheckResult;
  });
}

/**
 * 6. Revenue plausibility: per-entity bands anchored to the ~$41M TTM
 * company profile across the 13-month seed window (handoff §3.1).
 */
const REVENUE_BANDS: Record<EntityId, [number, number]> = {
  "HLI-US": [18_000_000, 36_000_000],
  "HLI-CA": [4_000_000, 10_000_000],
  "HLS-LLC": [2_500_000, 8_000_000],
};

export function checkRevenuePositive(ledger: Ledger): CheckResult[] {
  return ENTITY_IDS.map((entity) => {
    let revenue = 0;
    for (const je of ledger.journalEntries) {
      if (je.entity !== entity) continue;
      for (const line of je.lines) {
        const t = accountType(line.accountId);
        if (t === "Revenue") revenue += line.credit - line.debit;
      }
    }
    const rev = round2(revenue);
    const [lo, hi] = REVENUE_BANDS[entity];
    const plausible = rev > lo && rev < hi;
    return {
      name: `Revenue plausibility — ${entity}`,
      passed: plausible,
      detail: `total seeded revenue ${rev} (band ${lo}–${hi})`,
    } satisfies CheckResult;
  });
}

export function runAllChecks(
  ledger: Ledger,
  opts: { allowScenario2Variance?: boolean } = {},
): CheckResult[] {
  return [
    ...checkTrialBalance(ledger),
    checkEntryBalance(ledger),
    ...checkIntercompany(ledger, opts.allowScenario2Variance ?? false),
    ...checkBankReconciliation(ledger),
    ...checkArTieOut(ledger),
    ...checkApTieOut(ledger),
    ...checkInventoryNonNegative(ledger),
    ...checkRevenuePositive(ledger),
  ];
}

export function gateSummary(checks: CheckResult[]): { passed: boolean; lines: string[] } {
  const lines = checks.map(
    (c) => `${c.passed ? "PASS" : "FAIL"}  ${c.name} — ${c.detail}`,
  );
  return { passed: checks.every((c) => c.passed), lines };
}
