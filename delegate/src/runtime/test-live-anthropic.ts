/**
 * Live-runs harness (handoff §9 smoke): scenarios 1, 3, and 5 end-to-end through
 * the real Anthropic provider path — run creation → agent turns (gated tools
 * + budget) → event log → record opens → scoring → persisted scores.
 *
 * Two modes:
 *  - LIVE:  set ANTHROPIC_API_KEY (+ optional DELEGATE_MODEL). Real calls,
 *           real spend, verified end to end.
 *  - REPLAY: leave the key unset — a tiny HTTP fixture server mimicking
 *           /v1/messages serves a recorded transcript (or a built-in
 *           fallback), exercising the IDENTICAL provider code path with
 *           zero cost and zero key. Proves request shape, tool gating,
 *           budget counters, usage plumbing, scoring, persistence.
 *
 * CLI:
 *  node dist/runtime/test-live-anthropic.js                  → replay mode
 *  ANTHROPIC_API_KEY=sk-ant-... node dist/runtime/test-live-anthropic.js → live
 *  ... RECORD_FIXTURE=1                                      → also rewrite the fixture
 *
 * Data isolation: DELEGATE_DATA_DIR points at a temp dir; the workshop's
 * real store is never touched.
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { ScenarioRuntime } from "./state";
import { AnthropicProvider, DEFAULT_BUDGET } from "./agent";
import { EventLog } from "./events";
import { scoreRun } from "../scoring/scorers";
import { persistScores } from "../report/score-store";
import { loadManifest, loadChecklist } from "../scoring/scenario-loader";
import { SCENARIO1, SCENARIO3 } from "../seed/defects";

const FIXTURE_PATH = join(__dirname, "anthropic-fixtures.json");
const DATA_DIR = join(tmpdir(), `delegate-live-${Date.now()}`);
const UNION_GATE = new Set(["query_gl", "get_record", "list_records", "get_bank_feed", "read_document"]);
/** Tools that must NEVER be offered to the model anywhere in this harness. */
const NEVER_SENT = ["propose_entry", "post_entry", "get_fx_rates"];

let failures = 0;
function check(name: string, passed: boolean, detail: string): void {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!passed) failures += 1;
}

/** Expectations that differ between live and replay modes. */
const LIVE = () => Boolean(process.env.ANTHROPIC_API_KEY);

function extractJson(text: string): Record<string, unknown> | undefined {
  const m = text.match(/\{[\s\S]*?\}/);
  if (!m) return undefined;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

interface TurnSpec {
  prompt: string;
  expectJson: boolean;
  verify: (json: Record<string, unknown> | undefined, reply: string, toolCalls: string[], turnNo: number) => void;
}

/** The runtime of the scenario currently being run (verifier access). */
let currentScenarioRuntime: ScenarioRuntime | undefined;

// ── Fallback fixtures (used only when nothing has been recorded yet) ────
// Shape mirrors the real /v1/messages response. Order matters: the budget
// probe consumes the first response, then s1 (3 + 1), then s3 (3 + 1).

function fallbackFixtures(): Array<{ response: Record<string, unknown> }> {
  const toolUse = (name: string, input: Record<string, unknown>, id: string): Record<string, unknown> => ({
    id: `msg_fx_${id}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5",
    content: [
      { type: "text", text: "On it — pulling the data now." },
      { type: "tool_use", id: `toolu_${id}`, name, input },
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: 900, output_tokens: 88 },
  });
  const text = (t: string, id: string): Record<string, unknown> => ({
    id: `msg_fx_${id}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5",
    content: [{ type: "text", text: t }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1200, output_tokens: 210 },
  });
  return [
    // 0 — budget probe: a tool_use reply so the second hop trips the guard.
    { response: toolUse("query_gl", { entity: "HLI-US", account: "1010", dateFrom: "2026-03-01", dateTo: "2026-03-31" }, "00") },
    // 1–3 — scenario 1: bank feed, GL, then the (wrong-on-purpose) prose recon.
    { response: toolUse("get_bank_feed", { entity: "HLI-US", month: "2026-03" }, "01") },
    { response: toolUse("query_gl", { entity: "HLI-US", account: "1010", dateFrom: "2026-03-01", dateTo: "2026-03-31" }, "02") },
    {
      response: text(
        "I reconciled the March operating account. The bank feed and GL activity tie out: the reconciled cash balance is $412,881.90 with no unreconciled items. Both $18,450 customer deposits match open invoices of the same amount, so nothing is outstanding. The account is ready for close.",
        "03",
      ),
    },
    // 4 — scenario 1 verdict turn (fixture says ready; the LIVE model is expected to say blocker).
    { response: text('{"status":"ready"}', "04") },
    // 5–7 — scenario 3: two GL summary pulls, then the honest-wrong commentary.
    { response: toolUse("query_gl", { entity: "HLI-US", dateFrom: "2025-10-01", dateTo: "2025-12-31", groupBy: "account" }, "05") },
    { response: toolUse("query_gl", { entity: "HLI-US", dateFrom: "2026-01-01", dateTo: "2026-03-31", groupBy: "account" }, "06") },
    {
      response: text(
        "Q1 opex is up roughly $570K versus Q4, driven primarily by professional services (account 6100 moved sharply). Suggest noting elevated consulting for the audit and the Meridian program in the board deck.",
        "07",
      ),
    },
    // 8 — scenario 3 JE verdict turn.
    { response: text('{"found":true,"description":"Reclass per capitalization policy change CP-2026-01"}', "08") },
    // 9 — scenario 5: read the Meridian contract, then the (defensible but
    // contestable) recognition conclusion — the honest-average stance s5 needs.
    { response: toolUse("read_document", {}, "09") },
    {
      response: text(
        "I reviewed the Meridian agreement. Conclusion: recognize it as two performance obligations: the equipment at delivery (210,000, 50/50 payment terms) and the 36-month calibration service at 14,500/month as invoiced. The usage component with the 9,000 monthly floor is variable consideration; with the 10% repricing cap and the termination-for-objection mechanic I'd assess it as NOT constrained, since the floor guarantees collection and the cap bounds the upside. That's a clean Q2 treatment, and I'd book it that way.",
        "10",
      ),
    },
    // 11 — scenario 5 extraction verdict turn (numbers must tie to the contract).
    {
      response: text(
        '{"equipment":210000,"monthlyService":14500,"monthlyUsageFloor":9000,"termMonths":36,"repricingCapPct":10}',
        "11",
      ),
    },
  ];
}

// ── Fixture server (replay mode) ────────────────────────────────────────

const FIXTURE_SERVER = `const http = require("http");
const fixtures = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url.startsWith("/v1/messages")) {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const fx = fixtures.shift();
      if (!fx) { res.writeHead(500); res.end(JSON.stringify({ error: "fixture exhausted" })); process.exit(1); }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(fx.response));
    });
  } else { res.writeHead(404); res.end(); }
});
server.listen(0, "127.0.0.1", () => console.log("PORT:" + server.address().port));
`;

async function startFixtureServer(
  fixtures: Array<{ response: Record<string, unknown> }>,
): Promise<{ url: string; close: () => Promise<void> }> {
  const scriptPath = join(DATA_DIR, "fixture-server.cjs");
  const fxPath = join(DATA_DIR, "fixtures.json");
  writeFileSync(scriptPath, FIXTURE_SERVER);
  writeFileSync(fxPath, JSON.stringify(fixtures));
  const p = spawn(process.execPath, [scriptPath, fxPath], { stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("fixture server did not start")), 5000);
    p.stdout!.on("data", (d: Buffer) => {
      const m = d.toString().match(/PORT:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    });
    p.on("exit", (code) => reject(new Error(`fixture server exited early (${code})`)));
  });
  return { url, close: () => new Promise((r) => { p.once("exit", r); p.kill(); }) };
}

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  mkdirSync(DATA_DIR, { recursive: true });
  process.env.DELEGATE_DATA_DIR = DATA_DIR;

  const LIVE = Boolean(process.env.ANTHROPIC_API_KEY);
  const RECORD = LIVE && process.env.RECORD_FIXTURE === "1";

  // No-key guard: the provider must fail fast, never silently no-op.
  try {
    new AnthropicProvider("");
    check("Guard: provider refuses to run keyless", false, "empty key accepted");
  } catch {
    check("Guard: provider refuses to run keyless", true, "throws without a key");
  }

  let provider: AnthropicProvider;
  let closeFixture: (() => Promise<void>) | undefined;

  if (LIVE) {
    provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY);
    check("Mode: LIVE", true, `model=${process.env.DELEGATE_MODEL ?? "claude-sonnet-4-5"} — real API calls, real spend`);
  } else {
    const stored = existsSync(FIXTURE_PATH)
      ? (JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { responses?: Array<{ response: Record<string, unknown> }> })
      : null;
    const fallback = fallbackFixtures();
    let fixtures = fallback;
    if (stored?.responses?.length) {
      if (stored.responses.length >= fallback.length) fixtures = stored.responses;
      else
        console.log(
          `INFO  stored fixture (${stored.responses.length}) is shorter than the ${fallback.length} this script needs — using the built-in fallback (re-record with RECORD_FIXTURE=1)`,
        );
    }
    const server = await startFixtureServer(fixtures);
    provider = new AnthropicProvider("test-key", undefined, server.url);
    closeFixture = server.close;
    check("Mode: REPLAY (fixture server)", true, `${fixtures.length} canned responses through the real provider path`);
  }

  try {
    // ── Budget guard probe: 1-call budget + a tool-use reply ⇒ the second
    // hop must trip, returning a graceful partial (never a hang or throw). ──
    const bRt = new ScenarioRuntime("s1");
    const bTurn = await provider.runTurn(
      "Call query_gl on account 1010 for March 2026 and report the balance.",
      [],
      (tool, args) => bRt.executeTool(tool, args),
      { tools: bRt.availableToolNames(), budget: { maxTurnMs: 60_000, maxModelCalls: 1, maxOutputTokens: 8_000 } },
    );
    check(
      "Budget guard: trips on model-call cap",
      bTurn.usage.budgetExceeded === true && bTurn.usage.modelCalls === 1,
      `modelCalls=${bTurn.usage.modelCalls}, exceeded=${bTurn.usage.budgetExceeded}`,
    );
    check("Budget guard: graceful partial reply", bTurn.reply.length > 0, bTurn.reply.slice(0, 70));

    // ── Scenario flows ──
    const s1Reqs = await runScenario("s1", "01-bank-reconciliation", provider, s1Turns(), [
      "specification",
      "context_provision",
      "verification",
      "error_interception",
    ]);
    const s3Reqs = await runScenario("s3", "03-q1-flux-commentary", provider, s3Turns(), [
      "specification",
      "context_provision",
      "verification",
      "error_interception",
    ]);
    const s5Reqs = await runScenario("s5", "05-revenue-recognition", provider, s5Turns(), [
      "specification",
      "context_provision",
      "verification",
      "escalation_judgment",
    ]);

    // ── Tool-gating proof AFTER all flows: inspect every literal request body
    // the provider sent (probe + s1 + s3 + s5, all turns and hops), per window.
    // The budget probe is request 0; each scenario owns a contiguous window after. ──
    const sentToolSets = provider.capturedRequests.map((r) => ((r.tools as Array<{ name: string }>) ?? []).map((t) => t.name));
    const win = (from: number, to: number) => sentToolSets.slice(from, to);
    const s1Win = win(1, 1 + s1Reqs);
    const s3Win = win(1 + s1Reqs, 1 + s1Reqs + s3Reqs);
    const s5Win = win(1 + s1Reqs + s3Reqs, 1 + s1Reqs + s3Reqs + s5Reqs);

    const forbidden = sentToolSets.flatMap((names) => NEVER_SENT.filter((n) => names.includes(n)));
    check(
      "Tool gating: propose_entry/post_entry/get_fx_rates never sent in any window",
      forbidden.length === 0,
      forbidden.length === 0 ? `${sentToolSets.length} requests inspected, zero forbidden tools` : `LEAKED: ${[...new Set(forbidden)].join(",")}`,
    );
    const leaked = sentToolSets.flatMap((names) => names.filter((n) => !UNION_GATE.has(n)));
    check(
      "Tool gating: every request carried only scenario-gated tools (union gate)",
      sentToolSets.length > 0 && leaked.length === 0,
      leaked.length === 0 ? "no leaks across probe + s1 + s3 + s5" : `LEAKED: ${[...new Set(leaked)].join(",")}`,
    );
    check(
      "Tool gating: s1/s3 windows never offered read_document; s5 window always did",
      [...s1Win, ...s3Win].every((names) => !names.includes("read_document")) && s5Win.length > 0 && s5Win.every((names) => names.includes("read_document")),
      `s1(${s1Win.length}) + s3(${s3Win.length}) read_document-free; s5(${s5Win.length}) offers it on every hop`,
    );
    check(
      "Tool gating: s3 window never carried get_bank_feed (per-scenario gate, not just the union)",
      s3Win.every((names) => !names.includes("get_bank_feed")),
      `s3 window: ${s3Win.length} requests`,
    );

    if (RECORD) {
      writeFileSync(
        FIXTURE_PATH,
        JSON.stringify(
          { recordedAt: new Date().toISOString(), responses: provider.capturedResponses.map((r) => ({ response: r })) },
          null,
          2,
        ),
      );
      console.log(`\nFixture recorded: ${FIXTURE_PATH} (${provider.capturedResponses.length} responses)`);
    }
  } finally {
    await closeFixture?.();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nLIVE-RUN HARNESS: PASS" : `\nLIVE-RUN HARNESS: FAIL (${failures})`);
  return failures === 0 ? 0 : 1;
}

// ── One scenario end to end ─────────────────────────────────────────────

const SCENARIO_ANSWERS: Record<"s1" | "s3" | "s5", string> = {
  s1: "Reconciliation complete. All March bank activity matched to GL — cash reconciles, no unreconciled items. Ready for close.",
  s3: "Q1 opex is up roughly $570K versus Q4, driven primarily by professional services (account 6100). Suggest noting elevated consulting for the audit and the Meridian program in the board deck.",
  // The scripted learner forwards the agent's conclusion uncaveated — exactly
  // the behavior s5's escalation scorer exists to catch. The harness asserts
  // dimension presence and evidence, never the (correctly damning) value.
  s5: "The Meridian agreement recognizes as two performance obligations — equipment at delivery, calibration service monthly as invoiced, usage fees as earned. Booked per the agent's conclusion; ready for Q2.",
};

async function runScenario(
  id: "s1" | "s3" | "s5",
  slug: "01-bank-reconciliation" | "03-q1-flux-commentary" | "05-revenue-recognition",
  provider: AnthropicProvider,
  turns: TurnSpec[],
  expectedDims: string[],
): Promise<number> {
  console.log(`\n── ${id.toUpperCase()} · ${slug} ──`);
  const firstRequestIndex = provider.capturedRequests.length;
  const runtime = new ScenarioRuntime(id);
  currentScenarioRuntime = runtime;
  const eventLog = new EventLog();
  const session = eventLog.startSession("live-harness", "live-harness");
  const run = eventLog.startRun(session.id, id);

  const chat: Array<{ role: "user" | "assistant"; content: string; ts: string }> = [];
  const prompts: string[] = [];
  let totalTokens = 0;
  let totalCalls = 0;

  for (let ti = 0; ti < turns.length; ti++) {
    const spec = turns[ti];
    eventLog.log(run.id, "prompt_sent", "participant", { text: spec.prompt });
    const turn = await provider.runTurn(
      spec.prompt,
      chat,
      (tool, args) => {
        const out = runtime.executeTool(tool, args);
        eventLog.log(run.id, "tool_call", "agent", { tool, args, status: "ok" });
        return out;
      },
      { tools: runtime.availableToolNames(), budget: DEFAULT_BUDGET },
    );

    for (const open of turn.recordOpens) {
      runtime.openRecord(open.type as never, open.id, "agent");
      eventLog.log(run.id, "record_opened", "agent", { type: open.type, id: open.id });
    }
    eventLog.log(run.id, "agent_response", "agent", { text: turn.reply });
    eventLog.log(run.id, "agent_usage", "agent", {
      provider: provider.name,
      model: process.env.DELEGATE_MODEL ?? "claude-sonnet-4-5",
      modelCalls: turn.usage.modelCalls,
      outputTokens: turn.usage.outputTokens,
      elapsedMs: turn.usage.elapsedMs,
      budgetExceeded: turn.usage.budgetExceeded,
    });

    check(
      `${id} turn${ti + 1}: within budget`,
      turn.usage.budgetExceeded === false,
      `${turn.usage.modelCalls} calls, ${turn.usage.outputTokens} out tokens, ${(turn.usage.elapsedMs / 1000).toFixed(1)}s`,
    );
    totalTokens += turn.usage.outputTokens;
    totalCalls += turn.usage.modelCalls;

    chat.push({ role: "user", content: spec.prompt, ts: new Date().toISOString() });
    chat.push({ role: "assistant", content: turn.reply, ts: new Date().toISOString() });
    prompts.push(spec.prompt);

    const toolNames = turn.toolCalls.map((c) => c.tool);
    check(
      `${id} turn${ti + 1}: tool path stayed inside the scenario gate`,
      turn.toolCalls.every((c) => runtime.hasTool(c.tool)),
      toolNames.join(", ") || "no tools used",
    );
    const json = spec.expectJson ? extractJson(turn.reply) : undefined;
    spec.verify(json, turn.reply, toolNames, ti + 1);
  }

  // ── Scoring tail: the same path the workshop submit route uses. ──
  const answer = SCENARIO_ANSWERS[id];
  eventLog.submitAnswer(run.id, answer);
  const scores = await scoreRun({
    runId: run.id,
    manifest: loadManifest(slug) as never,
    checklist: loadChecklist(slug) as never,
    runtime,
    eventLog,
    prompts,
    chat,
    answerText: answer,
    submittedAt: new Date().toISOString(),
  });
  check(
    `${id}: scored exactly the scenario's dimensions (${expectedDims.join("/")}), every score carries evidence`,
    scores.length === expectedDims.length &&
      expectedDims.every((d) => scores.some((s) => s.dimension === d)) &&
      scores.every((s) => s.evidenceEventIds.length > 0),
    scores.map((s) => `${s.dimension}=${s.value}/${s.max} ev:${s.evidenceEventIds.length}`).join(", "),
  );
  persistScores(scores);
  console.log(`  usage: ${totalCalls} model calls, ${totalTokens} output tokens → scores persisted`);
  return provider.capturedRequests.length - firstRequestIndex;
}

// ── Per-scenario turn scripts ───────────────────────────────────────────

function s1Turns(): TurnSpec[] {
  return [
    {
      prompt: "Reconcile the HLI-US operating bank account for March 2026.",
      expectJson: false,
      verify: (_json, reply, tools) => {
        check("s1 turn1: agent pulled real data", tools.includes("query_gl") || tools.includes("get_bank_feed"), `tools: ${tools.join(", ") || "none"}`);
        check("s1 turn1: substantive reply", reply.length > 100, `${reply.length} chars`);
        check(
          "s1 turn1: defect ledger carries the duplicated bank line (trap armed)",
          currentScenarioRuntime?.ledger.bankLines.some((l) => l.id === SCENARIO1.defectiveBankLineId) === true,
          SCENARIO1.defectiveBankLineId,
        );
      },
    },
    {
      prompt:
        'Based on your reconciliation, answer in ONE line as strict JSON: {"status":"ready"} if the account is ready for close with no open items, or {"status":"blocker","reason":"..."} if something blocks close.',
      expectJson: true,
      verify: (json) => {
        check(
          "s1 turn2: JSON verdict received",
          json !== undefined && (json.status === "ready" || json.status === "blocker"),
          json ? `status=${String(json.status)}` : "no JSON found in reply",
        );
        if (json?.status === "blocker") {
          check("s1 turn2: verdict vs ground truth (dup deposit exists → blocker expected)", true, `reason: ${String(json.reason).slice(0, 100)}`);
        } else if (LIVE()) {
          check("s1 turn2: verdict vs ground truth (dup deposit exists → blocker expected)", false, `got ${String(json?.status)} — live model MISSED the duplicate`);
        } else {
          console.log(`INFO  s1 turn2: replay fixture returns the trap answer ("${String(json?.status)}") — wrong-on-purpose; ground truth is graded only in LIVE mode`);
        }
      },
    },
  ];
}

function s5Turns(): TurnSpec[] {
  return [
    {
      prompt: String(loadManifest("05-revenue-recognition").learnerBrief),
      expectJson: false,
      verify: (_json, reply, tools) => {
        check("s5 turn1: agent read the contract (read_document)", tools.includes("read_document"), `tools: ${tools.join(", ") || "none"}`);
        check("s5 turn1: substantive reply", reply.length > 100, `${reply.length} chars`);
        check(
          "s5 turn1: agent takes a confident position, no self-refusal (the honest-average property s5 depends on)",
          /performance obligation|recognize|constrained/i.test(reply) && !/escalat|technical accounting|not qualified to|cannot conclude/i.test(reply),
          reply.slice(0, 90),
        );
        check(
          "s5 turn1: cited figures trace to the served contract (no invented terms)",
          ["210,000", "14,500", "9,000"].every((f) => !reply.includes(f) || servedContract().includes(f)),
          "all cited figures grounded" ,
        );
      },
    },
    {
      prompt:
        'From the contract, answer in ONE line as strict JSON: {"equipment":number,"monthlyService":number,"monthlyUsageFloor":number,"termMonths":number,"repricingCapPct":number}.',
      expectJson: true,
      verify: (json) => {
        const ok =
          json?.equipment === 210000 && json?.monthlyService === 14500 && json?.monthlyUsageFloor === 9000 && json?.termMonths === 36 && json?.repricingCapPct === 10;
        check(
          "s5 turn2: extraction ties to the contract (210000/14500/9000/36/10%)",
          ok,
          ok ? "all five figures exact" : `got ${JSON.stringify(json)} — live model misread the contract`,
        );
      },
    },
  ];
}

/** The contract text as the runtime serves it (read once per call — cheap). */
function servedContract(): string {
  // The s5 runtime read_document returns MERIDIAN_DOCUMENT; extract it from
  // the runtime module without importing the runtime twice.
  return currentScenarioRuntime?.executeTool("read_document", {}) as string ?? "";
}

function s3Turns(): TurnSpec[] {
  return [
    {
      prompt: String(loadManifest("03-q1-flux-commentary").learnerBrief),
      expectJson: false,
      verify: (_json, reply, tools) => {
        check("s3 turn1: agent used query_gl", tools.includes("query_gl"), `tools: ${tools.join(", ") || "none"}`);
        check("s3 turn1: substantive reply", reply.length > 100, `${reply.length} chars`);
        check(
          "s3 turn1: honest summary read (blames professional services, no reclass mention)",
          /professional services|consulting|6100/i.test(reply) && !/reclass|capitalization|cp-2026/i.test(reply),
          reply.slice(0, 90),
        );
        check(
          "s3 turn1: reclass JE exists in the ledger (trap armed)",
          currentScenarioRuntime?.ledger.journalEntries.some((j) => j.id === SCENARIO3.reclassEntryId) === true,
          SCENARIO3.reclassEntryId,
        );
      },
    },
    {
      prompt:
        'Read journal entry JE-S3-RECLASS and answer in ONE line as strict JSON: {"found":true,"description":"..."} if it exists, or {"found":false} if not.',
      expectJson: true,
      verify: (json) => {
        check("s3 turn2: JE fetched and described", json?.found === true, json ? JSON.stringify(json).slice(0, 120) : "no JSON found");
      },
    },
  ];
}

main().then((code) => process.exit(code));
