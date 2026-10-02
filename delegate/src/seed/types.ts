/**
 * Core ledger primitives for the Harbor Lane Instruments seed.
 *
 * These types are the substrate contract: generators produce them, the
 * balance gate consumes them, and (later) emit.ts serializes them into
 * ERPNext via REST. Keeping them framework-free lets the gate run in-process
 * before ERPNext emission exists (README "Deviations").
 */

export type EntityId = "HLI-US" | "HLI-CA" | "HLS-LLC";
export type Currency = "USD" | "CAD";

export interface Entity {
  id: EntityId;
  name: string;
  functionalCurrency: Currency;
  isParent: boolean;
}

/** An account in the ~220-account chart of accounts. */
export interface Account {
  code: string;
  name: string;
  type: "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";
  entityId: EntityId;
  /** Parent-company account this maps to for consolidated reporting, if any. */
  mapsTo?: string;
}

/** One side of a journal entry. Amounts are functional-currency minor units? No —
 * major units with 2dp, stored as numbers. Determinism comes from generation
 * order, not from decimal libraries; every generator rounds via round2(). */
export interface JournalLine {
  accountId: string;
  entity: EntityId;
  debit: number;
  credit: number;
  memo?: string;
}

export interface JournalEntry {
  id: string;
  date: string; // ISO yyyy-mm-dd
  entity: EntityId;
  lines: JournalLine[];
  source:
    | "revenue"
    | "ap"
    | "payroll"
    | "patterns"
    | "intercompany"
    | "fx"
    | "bank";
  memo?: string;
}

export interface ArInvoice {
  id: string;
  entity: EntityId;
  customer: string;
  date: string;
  dueDate: string;
  amount: number;
  currency: Currency;
  /** Set once payment is received; open invoices have none. */
  paidOn?: string;
  lines: Array<{ description: string; amount: number }>;
}

export interface ApBill {
  id: string;
  entity: EntityId;
  vendor: string;
  date: string;
  dueDate: string;
  amount: number;
  currency: Currency;
  paidOn?: string;
  threeWayMatched: boolean;
}

export interface BankLine {
  id: string;
  entity: EntityId;
  date: string;
  direction: "in" | "out";
  amount: number;
  description: string;
  /** GL journal id this line settled, when reconciled. */
  matchedEntryId?: string;
}

/** A customer credit memo — distinct document type from invoices (scenario 4). */
export interface CreditMemo {
  id: string;
  entity: EntityId;
  customer: string;
  date: string;
  amount: number;
  reason: string;
  appliedToInvoiceId: string;
}

/** The full clean-base company state produced by the generator. */
export interface Ledger {
  accounts: Account[];
  journalEntries: JournalEntry[];
  invoices: ArInvoice[];
  bills: ApBill[];
  bankLines: BankLine[];
  /** Populated by the defect pass (scenario 4); empty in the clean base. */
  creditMemos: CreditMemo[];
}

/** Round to 2dp, half-up — the single rounding rule for the whole pipeline. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Last day of the ISO month containing `iso`. */
export function endOfMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}
