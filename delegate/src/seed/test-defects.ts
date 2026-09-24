/**
 * Defect-mode test: apply the defect pass on top of the clean base and verify
 * (a) the ledger remains internally consistent (the defects are timing/
 * classification traps, not balance breakers), (b) each defect is present
 * and structurally detectable, (c) determinism holds with defects applied.
 *
 * Run: node dist/seed/test-defects.js
 */

import { buildCleanBase } from "./generators";
import {
  applyDefects,
  SCENARIO1,
  SCENARIO2,
  SCENARIO3,
  SCENARIO4,
  SCENARIO4_CREDIT_MEMOS,
  SCENARIO6,
} from "./defects";
import {
  checkTrialBalance,
  checkEntryBalance,
  checkIntercompany,
  checkArTieOut,
  checkBankReconciliation,
} from "./balance";
import { MASTER_SEED } from "./profile";
import type { Ledger } from "./types";

let failures = 0;

function check(name: string, passed: boolean, detail: string): void {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!passed) failures += 1;
}

function defectLedger(seed: number): Ledger {
  // Note: defects need their own RNG stream so the clean base's RNG draws
  // are untouched — otherwise applying defects would shift every subsequent
  // draw and break comparability. buildCleanBase() is called normally; the
  // defect rng is a fresh SeededRng.
  const ledger = buildCleanBase(seed);
  const { SeededRng } = require("./rng") as typeof import("./rng");
  applyDefects(ledger, new SeededRng(0xdefec7));
  return ledger;
}

function main(): number {
  const clean = buildCleanBase(MASTER_SEED);
  const dirty = defectLedger(MASTER_SEED);

  // 1. Structural balance survives the defect pass. The scenario-2 FX-timing
  //    variance is tolerated by pair (a timing difference, not a break).
  const tb = checkTrialBalance(dirty);
  const eb = checkEntryBalance(dirty);
  const ic = checkIntercompany(dirty, true);
  for (const c of [...tb, eb, ...ic]) {
    check(c.name, c.passed, c.detail);
  }

  // 2. Scenario 1: the duplicate bank line exists, has no in-window GL match,
  //    and the two coincidental invoices both exist and are open in March.
  const dup = dirty.bankLines.find((b) => b.id === SCENARIO1.defectiveBankLineId);
  check(
    "S1: duplicate bank line present (3/14, $18,450)",
    !!dup && dup.date === SCENARIO1.resubmitDate && dup.amount === SCENARIO1.amount,
    dup ? `found ${dup.id} on ${dup.date}` : "missing",
  );
  check(
    "S1: duplicate has no GL cash match inside the window",
    !!dup && !dup.matchedEntryId,
    dup?.matchedEntryId ? `unexpectedly matched ${dup.matchedEntryId}` : "unmatched in-window",
  );
  const s1Invoices = dirty.invoices.filter(
    (i) => i.id === "INV-S1-A" || i.id === "INV-S1-B",
  );
  check(
    "S1: two coincidental $18,450 invoices exist",
    s1Invoices.length === 2 && s1Invoices.every((i) => i.amount === SCENARIO1.amount),
    `${s1Invoices.length} invoices at $${SCENARIO1.amount}`,
  );

  // 3. Scenario 1 ground truth: bank feed shows the deposit twice, GL once.
  const marchBank = dirty.bankLines.filter(
    (b) => b.entity === "HLI-US" && b.direction === "in" && b.amount === SCENARIO1.amount && b.date.startsWith("2026-03"),
  );
  check(
    "S1: bank feed shows $18,450 twice in March",
    marchBank.length === 2,
    `${marchBank.length} bank lines`,
  );
  const marchGlCash = dirty.journalEntries.filter(
    (je) =>
      je.entity === "HLI-US" &&
      je.date.startsWith("2026-03") &&
      je.lines.some((l) => l.accountId === "1010" && l.credit === 0 && l.debit === SCENARIO1.amount),
  );
  check(
    "S1: GL cash received $18,450 only once in March",
    marchGlCash.length === 1,
    `${marchGlCash.length} GL receipts`,
  );

  // 3b. Scenario 2: the FX-timing IC variance exists exactly as engineered.
  const caSide = dirty.journalEntries.find((j) => j.id === SCENARIO2.entryCaId);
  const usSide = dirty.journalEntries.find((j) => j.id === SCENARIO2.entryUsId);
  check(
    "S2: FX-timing IC entries present (3/15 CA / 3/31 US)",
    !!caSide &&
      !!usSide &&
      caSide.date === SCENARIO2.txDate &&
      usSide.date === SCENARIO2.usBookDate,
    caSide && usSide ? `CA ${caSide.date} / US ${usSide.date}` : "missing",
  );
  check(
    "S2: variance is exactly $4,182.00",
    SCENARIO2.variance === 4182,
    `USD ${SCENARIO2.usdAtTxRate.toFixed(2)} @ 0.769 vs USD ${SCENARIO2.usdAtMonthEnd.toFixed(2)} @ 0.739 → Δ $${SCENARIO2.variance.toFixed(2)}`,
  );

  // 3c. Scenario 2 bookkeeping: both entries individually balanced, both
  //     defensible — different rates is the whole mechanic.
  check(
    "S2: consolidated IC differs by exactly the FX variance (no more)",
    (() => {
      const raw = checkIntercompany(dirty, false);
      const consolidated = raw.find((r) => r.name.includes("consolidated"));
      const tol = SCENARIO2.variance;
      if (!consolidated) return false;
      const m = consolidated.detail.match(/receivables ([\d.]+) vs total payables ([\d.]+)/);
      if (!m) return false;
      const diff = Math.abs(Number(m[1]) - Number(m[2]));
      return Math.abs(diff - tol) < 0.005;
    })(),
    `consolidated Δ == $${SCENARIO2.variance.toFixed(2)} (tight tolerance)`,
  );

  // 4. Scenario 3: the reclass entry exists and moves 5020 → 6100.
  const reclass = dirty.journalEntries.find((j) => j.id === SCENARIO3.reclassEntryId);
  check(
    "S3: reclass JE present (3/31, $280K, 5020→6100)",
    !!reclass &&
      reclass.date === SCENARIO3.reclassDate &&
      reclass.lines.some((l) => l.accountId === SCENARIO3.toAccount && l.debit === SCENARIO3.reclassAmount) &&
      reclass.lines.some((l) => l.accountId === SCENARIO3.fromAccount && l.credit === SCENARIO3.reclassAmount),
    reclass ? reclass.memo ?? "" : "missing",
  );

  // 5. The reclass is summary-invisible by construction: it moves expense
  //    dollars between accounts with no cash/bank/AP/AR footprint.
  check(
    "S3: reclass has no cash/bank/AP/AR footprint",
    !!reclass &&
      reclass.lines.every((l) => ["5020", "6100"].includes(l.accountId)),
    reclass ? reclass.lines.map((l) => l.accountId).join(",") : "missing",
  );

  // 5b. Scenario 4: three open credit memos, $67,000 total, correct customers.
  const cmTotal = SCENARIO4_CREDIT_MEMOS.reduce((s, cm) => s + cm.amount, 0);
  check(
    "S4: credit memos present, total exactly $67,000",
    dirty.creditMemos.length === 3 && Math.round(cmTotal * 100) / 100 === SCENARIO4.totalCreditAmount,
    `${dirty.creditMemos.length} memos totaling $${cmTotal.toFixed(2)}`,
  );
  check(
    "S4: two customers falsely delinquent under invoice-only aging",
    SCENARIO4.falselyDelinquentCustomers.length === 2,
    SCENARIO4.falselyDelinquentCustomers.join(", "),
  );
  const arTie = checkArTieOut(dirty);
  for (const c of arTie) {
    check(c.name, c.passed, c.detail);
  }
  const bankTie = checkBankReconciliation(dirty);
  for (const c of bankTie) {
    check(c.name, c.passed, c.detail);
  }

  // 5c. Scenario 6: accrual drafts sum to the expected total.
  const accTotal = SCENARIO6.entries.reduce((s, e) => s + e.amount, 0);
  check(
    "S6: accrual drafts defined (three entries)",
    SCENARIO6.entries.length === 3 && accTotal > 0,
    `$${accTotal.toFixed(2)} across ${SCENARIO6.entries.length} drafts`,
  );

  // 6. Determinism with defects: two builds hash identically.
  const { stableHashOf } = require("./test-balance-helpers") as typeof import("./test-balance-helpers");
  const h1 = stableHashOf(defectLedger(MASTER_SEED));
  const h2 = stableHashOf(defectLedger(MASTER_SEED));
  check("Defect determinism — two builds identical", h1 === h2, `${h1} / ${h2}`);

  // 7. The defect pass does not disturb the clean base's own hash stream.
  const cleanAgain = buildCleanBase(MASTER_SEED);
  const { stableHashOf: _sh, ..._rest } = require("./test-balance-helpers") as typeof import("./test-balance-helpers");
  const cleanHash1 = stableHashOf(clean);
  const cleanHash2 = stableHashOf(cleanAgain);
  check("Clean base untouched by defect pass", cleanHash1 === cleanHash2, `${cleanHash1} / ${cleanHash2}`);

  console.log(failures === 0 ? "DEFECT TESTS: PASS" : `DEFECT TESTS: FAIL (${failures})`);
  return failures === 0 ? 0 : 1;
}

process.exit(main());
