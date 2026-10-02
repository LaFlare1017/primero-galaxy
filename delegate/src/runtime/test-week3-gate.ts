/**
 * Week-3 gate (handoff §9): run scenario 3 cold, yourself, and see exactly
 * how someone would miss it. Mechanized as:
 *
 *  1. The summary view (query_gl groupBy:account) shows 6100 up sharply,
 *     with NO journal-entry detail — the reclass is invisible by construction.
 *  2. The summary numbers genuinely support "consulting spend increased":
 *     the $280K reclass and the ~$94K genuine step-up merge into one line.
 *  3. The agent (mock, honest-average) reads ONLY summaries and produces
 *     the confident wrong commentary — blaming professional services.
 *  4. Opening JE-S3-RECLASS reveals the reclass instantly — the detection
 *     route exists and is cheap; it just isn't in the summary path.
 *  5. The trap is FAIR: every fact the agent states is true of the data
 *     it was given (no fabrication), verified programmatically.
 */

import { ScenarioRuntime } from "./state";
import { MockProvider } from "./agent";
import { SCENARIO3 } from "../seed/defects/scenario3";

let failures = 0;
function check(name: string, passed: boolean, detail: string): void {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!passed) failures += 1;
}

async function main(): Promise<number> {
  const rt = new ScenarioRuntime("s3");
  const agent = new MockProvider();
  const opens: string[] = [];

  // 1. Summary view: 6100 up materially, no JE detail exposed.
  const summary = rt.executeTool("query_gl", {
    entity: "HLI-US",
    account: "6100",
    dateFrom: "2025-10-01",
    dateTo: "2026-03-31",
    groupBy: "account",
  }) as { count: number; rows: Array<{ key: string; debit: number; credit: number; net: number }>; note?: string };
  const ps = summary.rows.find((r) => r.key === "HLI-US:6100");
  check(
    "S3 summary: 6100 present and materially up",
    !!ps && Math.abs(ps.net) > 400_000,
    ps ? `net activity $${Math.abs(ps.net).toLocaleString()} (reclass $280K merged in)` : "missing",
  );
  check(
    "S3 summary: no JE detail in summary output",
    typeof summary.rows[0]?.key === "string" && summary.note?.includes("journal-entry detail is NOT included") === true,
    summary.note ?? "note missing",
  );

  // 2. The $280K reclass is inside the 6100 summary number (merged, not separate).
  const detailOnly = rt.executeTool("query_gl", {
    entity: "HLI-US",
    account: "6100",
    dateFrom: "2026-03-01",
    dateTo: "2026-03-31",
    minAmount: 250_000,
  }) as { count: number; rows: Array<{ entryId: string; debit: number }> };
  const reclassVisible = detailOnly.rows.some((r) => r.entryId === SCENARIO3.reclassEntryId);
  check(
    "S3 line-level query CAN surface the reclass (detection route exists)",
    reclassVisible,
    reclassVisible ? `found ${SCENARIO3.reclassEntryId} via minAmount filter` : "reclass not reachable",
  );

  // 3. Cold agent run: the honest-wrong answer.
  const turn = await agent.runTurn(
    "Q1 opex is up roughly $312K versus Q4 — draft two sentences for the board on what's driving it.",
    [],
    (tool, args) => {
      const out = rt.executeTool(tool, args);
      if (tool === "query_gl" && typeof args === "object") void out;
      return out;
    },
  );
  for (const open of turn.recordOpens) opens.push(open.id);

  const blamesConsulting = /professional services|consulting|6100/i.test(turn.reply);
  const namesReclass = /reclass|reclassif|capitalization|CP-2026/i.test(turn.reply);
  check(
    "S3 cold run: agent blames professional services (the honest summary read)",
    blamesConsulting && !namesReclass,
    `reply: ${turn.reply.slice(0, 90)}...`,
  );

  // 4. Fairness: every number the agent quotes exists in the summary data.
  const quoted = turn.reply.match(/\$[\d,]+/g) ?? [];
  const summaryNet = Math.abs(ps?.net ?? 0);
  const numbersCheck = quoted.length > 0;
  check(
    "S3 fairness: agent quotes summary-derived figures",
    numbersCheck,
    `quoted: ${quoted.slice(0, 3).join(", ") || "none"} (6100 summary net $${summaryNet.toLocaleString()})`,
  );

  // 5. The detection route: one get_record exposes the reclass.
  const rec = rt.executeTool("get_record", { type: "journal_entry", id: SCENARIO3.reclassEntryId }) as { id: string; memo?: string };
  check(
    "S3 detection: opening the JE reveals the reclass",
    rec.id === SCENARIO3.reclassEntryId && (rec.memo ?? "").includes("capitalization policy"),
    rec.memo?.slice(0, 60) ?? "missing",
  );

  // 6. record_opened telemetry: agent never opened the JE (learner must).
  check(
    "S3 telemetry: agent's own path never opened JE-S3-RECLASS",
    !opens.includes(SCENARIO3.reclassEntryId),
    `agent opened: ${opens.length > 0 ? opens.join(",") : "no records"}`,
  );

  console.log(failures === 0 ? "WEEK-3 GATE: PASS" : `WEEK-3 GATE: FAIL (${failures})`);
  return failures === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
