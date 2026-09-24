/** Shared determinism-test helper: stable FNV-1a hash of a ledger snapshot. */

import type { Ledger } from "./types";

export function stableHashOf(ledger: Ledger): string {
  const serialized = JSON.stringify({
    je: ledger.journalEntries,
    inv: ledger.invoices,
    bank: ledger.bankLines,
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < serialized.length; i++) {
    h ^= serialized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
