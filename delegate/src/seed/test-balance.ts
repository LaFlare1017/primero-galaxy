/**
 * Gate test (handoff §1, §3.3): run the full balance gate against the clean
 * base AND verify determinism — two builds from the same seed must produce
 * identical ledgers. Exits non-zero on any failure.
 *
 * Run: node dist/seed/test-balance.js
 */

import { buildCleanBase } from "./generators";
import { runAllChecks, gateSummary } from "./balance";
import { MASTER_SEED } from "./profile";

function stableHash(input: string): string {
  // FNV-1a 32-bit — sufficient for change detection of the serialized ledger.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function serializeLedger(ledger: ReturnType<typeof buildCleanBase>): string {
  return JSON.stringify({
    je: ledger.journalEntries,
    inv: ledger.invoices,
    bank: ledger.bankLines,
  });
}

function main(): number {
  const ledger = buildCleanBase(MASTER_SEED);
  const checks = runAllChecks(ledger);
  const summary = gateSummary(checks);
  for (const line of summary.lines) console.log(line);

  // Determinism: two independent builds must serialize identically.
  const first = stableHash(serializeLedger(ledger));
  const second = stableHash(serializeLedger(buildCleanBase(MASTER_SEED)));
  const deterministic = first === second;
  console.log(`${deterministic ? "PASS" : "FAIL"}  Determinism — seed ${MASTER_SEED} hashes ${first} / ${second}`);

  // A different seed must produce a different company (sanity that the seed
  // is actually load-bearing).
  const other = stableHash(serializeLedger(buildCleanBase(MASTER_SEED + 1)));
  const seedSensitive = other !== first;
  console.log(`${seedSensitive ? "PASS" : "FAIL"}  Seed sensitivity — different seed differs (${other} vs ${first})`);

  const passed = summary.passed && deterministic && seedSensitive;
  console.log(passed ? "GATE: PASS" : "GATE: FAIL");
  return passed ? 0 : 1;
}

process.exit(main());
