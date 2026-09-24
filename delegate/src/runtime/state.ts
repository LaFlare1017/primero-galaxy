/**
 * ScenarioRuntime — a read-only window onto the defect-mode ledger for one
 * scenario run, with scenario-gated tool availability.
 *
 * The tool set is a per-scenario gate (handoff §5): get_bank_feed only in
 * s1, get_fx_rates only in s2, read_document only in s5, propose/post_entry
 * only in s6. Tool availability is data, not code paths.
 *
 * record_opened tracking: every `openRecord` call is the raw material for
 * the verification scorer — handoff §6.1 calls record_opened the
 * highest-value event in the system. The runtime records what was opened
 * and WHEN, which is what makes "verified before submitting" measurable.
 */

import { buildCleanBase } from "../seed/generators";
import { applyDefects } from "../seed/defects";
import { SeededRng } from "../seed/rng";

/**
 * One deterministic defect-mode ledger per process, built lazily and shared
 * across all ScenarioRuntime instances (~60ms and ~15MB saved per run).
 * The runtime treats it as read-only except for agent-initiated post_entry,
 * which is per-run state in proposedEntries — the ledger's own arrays are
 * never mutated after the defect pass.
 */
let sharedLedger: Ledger | undefined;
function getSharedLedger(seed: number): Ledger {
  if (!sharedLedger) {
    const ledger = buildCleanBase(seed);
    applyDefects(ledger, new SeededRng(0xdefec7));
    sharedLedger = ledger;
  }
  return sharedLedger;
}
import { MASTER_SEED, FX_CAD_USD, FX_CAD_USD_MID_MARCH, FX_CAD_USD_MARCH_END, SCENARIO2_IC_CAD_AMOUNT, ENTITIES, ACCOUNTS, CUSTOMERS, VENDORS } from "../seed/profile";
import { SCENARIO6 } from "../seed/defects/scenario6";
import type { Ledger } from "../seed/types";
import { round2 } from "../seed/types";
import { MERIDIAN_DOCUMENT } from "./meridian-doc";
import type { EventActor } from "./events";

export type ScenarioId = "s1" | "s2" | "s3" | "s4" | "s5" | "s6";

export type RecordType =
  | "journal_entry"
  | "invoice"
  | "bill"
  | "bank_line"
  | "credit_memo"
  | "account"
  | "contract";

export type ToolName =
  | "query_gl"
  | "get_record"
  | "list_records"
  | "get_bank_feed"
  | "get_fx_rates"
  | "read_document"
  | "propose_entry"
  | "post_entry";

const TOOLS_BY_SCENARIO: Record<ScenarioId, ToolName[]> = {
  s1: ["query_gl", "get_record", "list_records", "get_bank_feed"],
  s2: ["query_gl", "get_record", "list_records", "get_fx_rates"],
  s3: ["query_gl", "get_record", "list_records"],
  s4: ["query_gl", "get_record", "list_records"],
  s5: ["query_gl", "get_record", "list_records", "read_document"],
  s6: ["query_gl", "get_record", "list_records", "propose_entry", "post_entry"],
};

export interface OpenRecord {
  type: RecordType;
  id: string;
  ts: string;
  /** Who opened it — verification credit belongs to the participant only. */
  actor: EventActor;
}

export interface ProposedEntry {
  id: string;
  date: string;
  entity: string;
  lines: Array<{ accountId: string; debit: number; credit: number; memo?: string }>;
  memo?: string;
  /** Set when the LEARNER (not the agent) authorizes posting. */
  postedByAgent: boolean;
}

export interface LedgerWindow {
  accounts: Array<{ code: string; name: string; type: string; entity: string }>;
  journalEntries: Ledger["journalEntries"];
  invoices: Ledger["invoices"];
  bills: Ledger["bills"];
  bankLines: Ledger["bankLines"];
  creditMemos: Ledger["creditMemos"];
}

export class ScenarioRuntime {
  readonly ledger: Ledger;
  readonly scenarioId: ScenarioId;
  readonly openRecords: OpenRecord[] = [];
  readonly toolCalls: Array<{ tool: ToolName; args: unknown; ts: string; resultSummary: string; actor: EventActor }> = [];
  readonly proposedEntries: ProposedEntry[] = [];
  private readonly availableTools: Set<ToolName>;

  constructor(scenarioId: ScenarioId, opts: { seed?: number; withDefects?: boolean } = {}) {
    this.scenarioId = scenarioId;
    // Every participant sees the same defect-mode ledger — the defect is in
    // the DATA, so all agents face the same trap. The defect-mode ledger is
    // deterministic, so it is built once per process and shared (deep-frozen
    // at the window boundary; per-run mutations live in the runtime's own
    // proposedEntries).
    this.ledger = getSharedLedger(opts.seed ?? MASTER_SEED);
    this.availableTools = new Set(TOOLS_BY_SCENARIO[scenarioId]);
  }

  /** Tools the agent may call in this scenario. Availability is the gate. */
  availableToolNames(): ToolName[] {
    return [...this.availableTools];
  }

  hasTool(tool: ToolName): boolean {
    return this.availableTools.has(tool);
  }

  // ── Record opening (verification telemetry) ────────────────────────

  /**
   * actor defaults to "agent" for the runtime's internal executeTool path
   * (get_record called by the agent logs an agent-attributed open) — the
   * scorer reads participant opens from the EVENT LOG, not this array, so
   * the default here only affects agent-path bookkeeping. Every other call
   * site (viewer route, harnesses) passes its actor explicitly.
   */
  openRecord(type: RecordType, id: string, actor: EventActor = "agent", ts: string = new Date().toISOString()): void {
    this.openRecords.push({ type, id, ts, actor });
  }

  /** Whether the PARTICIPANT opened any of these ids (agent opens never count). */
  hasOpenedRecord(ids: string[]): boolean {
    return ids.some((id) => this.openRecords.some((r) => r.id === id && r.actor === "participant"));
  }

  // ── Tool execution ─────────────────────────────────────────────────

  /**
   * Execute a tool call. Throws if the tool is not available in this
   * scenario (the gate is enforced here, once).
   *
   * actor attributes WHO executed the call (agent by default; the viewer
   * route and harnesses pass "participant") — it flows into both the
   * toolCalls telemetry and any record opens the tool itself performs, so
   * one execution records exactly one correctly-attributed open.
   */
  executeTool(tool: ToolName, args: Record<string, unknown>, actor: EventActor = "agent"): unknown {
    if (!this.hasTool(tool)) {
      throw new Error(`Tool ${tool} is not available in scenario ${this.scenarioId}`);
    }
    const ts = new Date().toISOString();
    let result: unknown;
    switch (tool) {
      case "query_gl":
        result = this.queryGl(args);
        break;
      case "get_record":
        result = this.getRecord(args, ts, actor);
        break;
      case "list_records":
        result = this.listRecords(args);
        break;
      case "get_bank_feed":
        result = this.getBankFeed(args);
        break;
      case "get_fx_rates":
        result = this.getFxRates();
        break;
      case "read_document":
        result = this.readDocument(args);
        break;
      case "propose_entry":
        result = this.proposeEntry(args);
        break;
      case "post_entry":
        result = this.postEntry(args);
        break;
      default:
        throw new Error(`Unknown tool: ${tool as string}`);
    }
    const resultSummary =
      typeof result === "string"
        ? result.slice(0, 120)
        : `records:${(result as { count?: number })?.count ?? "n/a"}`;
    this.toolCalls.push({ tool, args, ts, resultSummary, actor });
    return result;
  }

  /** SQL-like (structured) query over the ledger. Deliberately not SQL — a fixed, safe query shape. */
  private queryGl(args: Record<string, unknown>): { count: number; rows: unknown[]; note?: string } {
    const entity = typeof args.entity === "string" ? args.entity : undefined;
    const account = typeof args.account === "string" ? args.account : undefined;
    const dateFrom = typeof args.dateFrom === "string" ? args.dateFrom : undefined;
    const dateTo = typeof args.dateTo === "string" ? args.dateTo : undefined;
    const minAmount = typeof args.minAmount === "number" ? args.minAmount : undefined;
    const groupBy = args.groupBy === "account" || args.groupBy === "month" ? args.groupBy : undefined;
    const limit = typeof args.limit === "number" ? Math.min(args.limit, 200) : 50;

    let rows = this.ledger.journalEntries.flatMap((je) =>
      je.lines.map((l) => ({
        entryId: je.id,
        date: je.date,
        entity: l.entity,
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        memo: l.memo ?? je.memo ?? "",
      })),
    );

    if (entity) rows = rows.filter((r) => r.entity === entity);
    if (account) rows = rows.filter((r) => r.accountId === account);
    if (dateFrom) rows = rows.filter((r) => r.date >= dateFrom);
    if (dateTo) rows = rows.filter((r) => r.date <= dateTo);
    if (minAmount !== undefined) {
      rows = rows.filter((r) => Math.max(r.debit, r.credit) >= minAmount);
    }

    if (groupBy === "account") {
      const byAcct = new Map<string, { debit: number; credit: number }>();
      for (const r of rows) {
        const cur = byAcct.get(`${r.entity}:${r.accountId}`) ?? { debit: 0, credit: 0 };
        cur.debit += r.debit;
        cur.credit += r.credit;
        byAcct.set(`${r.entity}:${r.accountId}`, cur);
      }
      return {
        count: byAcct.size,
        rows: [...byAcct.entries()].map(([k, v]) => ({
          key: k,
          debit: round2(v.debit),
          credit: round2(v.credit),
          net: round2(v.debit - v.credit),
        })),
        note: "grouped by account (summary view — journal-entry detail is NOT included)",
      };
    }
    if (groupBy === "month") {
      const byMonth = new Map<string, { debit: number; credit: number }>();
      for (const r of rows) {
        const k = r.date.slice(0, 7);
        const cur = byMonth.get(k) ?? { debit: 0, credit: 0 };
        cur.debit += r.debit;
        cur.credit += r.credit;
        byMonth.set(k, cur);
      }
      return {
        count: byMonth.size,
        rows: [...byMonth.entries()].map(([k, v]) => ({ month: k, ...v, net: round2(v.debit - v.credit) })),
        note: "grouped by month (summary view — journal-entry detail is NOT included)",
      };
    }

    rows = rows.slice(0, limit);
    return { count: rows.length, rows, note: limit < 200 ? `limited to ${limit} rows` : undefined };
  }

  private getRecord(args: Record<string, unknown>, tsOf: string = new Date().toISOString(), actor: EventActor = "agent"): unknown {
    const type = String(args.type ?? "");
    const id = String(args.id ?? "");
    const result = (() => {
      switch (type) {
        case "journal_entry":
          return this.ledger.journalEntries.find((j) => j.id === id);
        case "invoice":
          return this.ledger.invoices.find((i) => i.id === id);
        case "bill":
          return this.ledger.bills.find((b) => b.id === id);
        case "bank_line":
          return this.ledger.bankLines.find((b) => b.id === id);
        case "credit_memo":
          return this.ledger.creditMemos.find((c) => c.id === id);
        case "account": {
          const code = id;
          return ACCOUNTS.filter((a) => a.code === code).map((a) => ({
            code: a.code,
            name: a.name,
            type: a.type,
            entity: a.entityId,
          }));
        }
        case "contract":
          return MERIDIAN_DOCUMENT;
        default:
          return undefined;
      }
    })();
    if (result) this.openRecord(type as RecordType, id, actor, tsOf);
    return result ?? { error: `Record ${type} ${id} not found` };
  }

  private listRecords(args: Record<string, unknown>): { count: number; records: Array<{ id: string; type: string }> } {
    const type = String(args.type ?? "invoice");
    const entity = typeof args.entity === "string" ? args.entity : undefined;
    const dateFrom = typeof args.dateFrom === "string" ? args.dateFrom : undefined;
    const dateTo = typeof args.dateTo === "string" ? args.dateTo : undefined;
    const customer = typeof args.customer === "string" ? args.customer : undefined;
    const status = typeof args.status === "string" ? args.status : undefined;
    const limit = typeof args.limit === "number" ? Math.min(args.limit, 200) : 50;

    let ids: Array<{ id: string; date?: string; entity?: string; customer?: string; paidOn?: string }> = [];
    if (type === "invoice") ids = this.ledger.invoices;
    else if (type === "bill") ids = this.ledger.bills;
    else if (type === "credit_memo") ids = this.ledger.creditMemos;
    else if (type === "journal_entry") ids = this.ledger.journalEntries.map((j) => ({ id: j.id, date: j.date, entity: j.entity }));

    let filtered = ids.map((r) => ({ ...r, type }));
    if (entity) filtered = filtered.filter((r) => !r.entity || r.entity === entity);
    if (dateFrom) filtered = filtered.filter((r) => !r.date || r.date >= dateFrom);
    if (dateTo) filtered = filtered.filter((r) => !r.date || r.date <= dateTo);
    if (customer) filtered = filtered.filter((r) => !r.customer || r.customer === customer);
    if (status === "open") filtered = filtered.filter((r) => !r.paidOn);
    else if (status === "paid") filtered = filtered.filter((r) => !!r.paidOn);

    filtered = filtered.slice(0, limit);
    return {
      count: filtered.length,
      records: filtered.map((r) => ({ id: r.id, type })),
    };
  }

  private getBankFeed(args: Record<string, unknown>): { count: number; lines: Ledger["bankLines"] } {
    const entity = typeof args.entity === "string" ? args.entity : "HLI-US";
    const month = typeof args.month === "string" ? args.month : "2026-03";
    const lines = this.ledger.bankLines.filter(
      (b) => b.entity === entity && b.date.startsWith(month),
    );
    return { count: lines.length, lines };
  }

  private getFxRates(): { months: string[]; cadUsd: number[]; note: string } {
    const months: string[] = [];
    for (let y = 2025; y <= 2026; y++) {
      for (let m = y === 2025 ? 3 : 1; m <= (y === 2026 ? 3 : 12); m++) {
        if (months.length < 13) months.push(`${y}-${String(m).padStart(2, "0")}`);
      }
    }
    return {
      months,
      cadUsd: FX_CAD_USD,
      note: "Month-end CAD/USD rates. Mid-March 2026 (3/15) transaction-date rate is published separately by treasury.",
    };
  }

  private readDocument(args: Record<string, unknown>): string {
    void args;
    return MERIDIAN_DOCUMENT;
  }

  private proposeEntry(args: Record<string, unknown>): { id: string; status: string } {
    const id = String(args.id ?? `ACC-${this.proposedEntries.length + 1}`);
    const lines = Array.isArray(args.lines)
      ? (args.lines as ProposedEntry["lines"])
      : [];
    const entry: ProposedEntry = {
      id,
      date: String(args.date ?? SCENARIO6.accrualDate),
      entity: String(args.entity ?? "HLI-US"),
      lines,
      memo: typeof args.memo === "string" ? args.memo : undefined,
      postedByAgent: false,
    };
    this.proposedEntries.push(entry);
    return { id, status: "drafted (not posted)" };
  }

  /**
   * post_entry — gated behind learner authorization recorded in RUNTIME
   * STATE (via authorizePost, from the UI), never in agent-supplied args:
   * the agent must not be able to authorize itself. Without authorization
   * the runtime refuses and the refusal status is what the s6 behavioral
   * scorer reads.
   */
  private postEntry(args: Record<string, unknown>): { id: string; status: string } {
    const id = String(args.id ?? "");
    const entry = this.proposedEntries.find((e) => e.id === id);
    if (!entry?.postedByAgent) {
      return {
        id,
        status: "REFUSED: posting requires explicit learner authorization in the UI",
      };
    }
    return { id, status: "posted" };
  }

  /**
   * Learner-side authorization from the UI (records the control decision).
   * If the agent never drafted the entry (learner authorized without a
   * prepare step), create it from the deterministic SCENARIO6 spec — the
   * drafts are scenario data, and authorization must never silently no-op.
   */
  authorizePost(entryId: string): void {
    let entry = this.proposedEntries.find((e) => e.id === entryId);
    if (!entry) {
      const spec = SCENARIO6.entries.find((e) => e.id === entryId);
      if (spec) {
        entry = {
          id: spec.id,
          date: SCENARIO6.accrualDate,
          entity: "HLI-US",
          lines: [
            { accountId: spec.accountDebit, debit: spec.amount, credit: 0, memo: spec.memo },
            { accountId: spec.accountCredit, debit: 0, credit: spec.amount },
          ],
          memo: spec.memo,
          postedByAgent: false,
        };
        this.proposedEntries.push(entry);
      }
    }
    if (entry) entry.postedByAgent = true;
  }

  /** The Q1-vs-Q4 flux summary the agent's summary tools naturally produce. */
  fluxSummaryQ1vsQ4(entity: string): { opexQ4: number; opexQ1: number; delta: number; byAccount: Array<{ account: string; q4: number; q1: number; delta: number }> } {
    const q4Months = ["2025-10", "2025-11", "2025-12"];
    const q1Months = ["2026-01", "2026-02", "2026-03"];
    const opexTypes = new Set(["Expense"]);
    const inQuarter = (date: string, months: string[]) => months.some((m) => date.startsWith(m));

    const buckets = new Map<string, { q4: number; q1: number }>();
    let opexQ4 = 0;
    let opexQ1 = 0;
    for (const je of this.ledger.journalEntries) {
      if (je.entity !== entity) continue;
      for (const l of je.lines) {
        if (!opexTypes.has(ACCOUNTS.find((a) => a.code === l.accountId)?.type ?? "")) continue;
        const bucket = buckets.get(l.accountId) ?? { q4: 0, q1: 0 };
        const amt = l.debit - l.credit;
        if (inQuarter(je.date, q4Months)) {
          bucket.q4 += amt;
          opexQ4 += amt;
        }
        if (inQuarter(je.date, q1Months)) {
          bucket.q1 += amt;
          opexQ1 += amt;
        }
        buckets.set(l.accountId, bucket);
      }
    }
    const byAccount = [...buckets.entries()]
      .map(([account, v]) => ({ account, q4: round2(v.q4), q1: round2(v.q1), delta: round2(v.q1 - v.q4) }))
      .filter((r) => Math.abs(r.delta) > 1)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return { opexQ4: round2(opexQ4), opexQ1: round2(opexQ1), delta: round2(opexQ1 - opexQ4), byAccount };
  }

  /** Company directory data for chat flavor (read-only). */
  companyInfo() {
    return {
      entities: Object.values(ENTITIES).map((e) => ({ id: e.id, name: e.name, functionalCurrency: e.functionalCurrency })),
      customerCount: CUSTOMERS.length,
      vendorCount: VENDORS.length,
      coaCount: ACCOUNTS.length,
    };
  }
}

export { FX_CAD_USD_MID_MARCH, FX_CAD_USD_MARCH_END, SCENARIO2_IC_CAD_AMOUNT };
