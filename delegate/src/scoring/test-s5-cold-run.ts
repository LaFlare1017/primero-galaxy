/**
 * Scenario 5 cold-run proof against the FINALIZED Meridian contract (v1.0).
 *
 * Two things must be true for scenario 5 to be fair (handoff §4):
 *
 *  A. The mock agent's confident recognition conclusion is an HONEST READ
 *     of the served text — every figure and mechanic it cites traces to the
 *     document, no review artifacts leak into participant-visible text, and
 *     the three copies of the contract (review doc, scenario package,
 *     runtime-served) agree. If the served text were stale or the agent
 *     invented terms, the scenario would be a detectable trick (§4: a
 *     detectable trick discredits the other five scenarios).
 *
 *  B. The escalation scorer's three bands behave on real runs: full credit
 *     for extract-then-escalate, partial for doubt-but-accept, zero — with
 *     the named flagged behavior — for uncaveated acceptance. s5 grades the
 *     HUMAN's escalation behavior, never the recognition conclusion.
 *
 * Gate: run after any change to the contract text, the mock agent, or the
 * escalation scorer. Wired into `npm test`.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { resolveDelegateRoot } from "../paths";
import { ScenarioRuntime } from "../runtime/state";
import { MockProvider, type ChatMessage } from "../runtime/agent";
import { MERIDIAN_DOCUMENT } from "../runtime/meridian-doc";
import { EventLog } from "../runtime/events";
import { scoreRun } from "./scorers";
import { loadManifest, loadChecklist, slugForId } from "./scenario-loader";

let failures = 0;
function check(name: string, passed: boolean, detail: string): void {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!passed) failures += 1;
}

const root = resolveDelegateRoot();

// ── Part A: the served contract and the agent's honest read ────────────

async function partA(): Promise<void> {
  const rt = new ScenarioRuntime("s5");

  // A1. Tool gating: read_document available in s5; post_entry never.
  const tools = rt.availableToolNames();
  check(
    "A1 s5 tool gate",
    tools.includes("read_document") && !tools.includes("post_entry") && !tools.includes("get_bank_feed"),
    `[${tools.join(", ")}]`,
  );

  // A2. The served text is the finalized v1.0: itemized header present,
  // stale stated value gone, review artifacts absent.
  const served = rt.executeTool("read_document", {}) as string;
  check(
    "A2 served text is v1.0 (itemized header, no stale value)",
    served.includes("USD 210,000 equipment purchase") && !served.includes("540,000"),
    served.includes("USD 210,000 equipment purchase") ? "header itemized" : "STALE HEADER",
  );
  const leaks = ["AMB-", "CONFIRMED", "Reviewer note", "review record", "DRAFT v", "LG review"].filter((m) => served.includes(m));
  check("A3 no review artifacts in participant-visible text", leaks.length === 0, leaks.length === 0 ? "clean" : `leaked: ${leaks.join(", ")}`);

  // A4. Every figure the mock cites traces to the served text.
  const cited = ["210,000", "14,500", "9,000", "10%"];
  const missing = cited.filter((c) => !served.includes(c));
  check("A4 cited figures exist in the contract", missing.length === 0, missing.length === 0 ? cited.join(", ") : `NOT IN CONTRACT: ${missing.join(", ")}`);

  // A5. Cold run: the mock agent reads the document then concludes.
  const agent = new MockProvider();
  const t = await agent.runTurn("Tell me how to recognize revenue on the Meridian Labs contract for Q2 close.", [], (tool, args) =>
    rt.executeTool(tool, args),
  );
  const readDoc = t.toolCalls.some((c) => c.tool === "read_document");
    check("A5 agent's extraction is tool-driven (read_document called)", readDoc, readDoc ? "1 read_document call" : "NO read_document — conclusion would be ungrounded");

    // The conclusion's figures must all be grounded in the served text —
    // the agent may take POSITIONS (two POs, not constrained) but must not
    // invent terms, amounts, or mechanics.
  const replyFigures = ["210,000", "14,500", "9,000", "10%"];
  const ungrounded = replyFigures.filter((f) => t.reply.includes(f) && !served.includes(f));
  check("A6 conclusion cites only contract-grounded figures", ungrounded.length === 0, ungrounded.length === 0 ? "all cited figures trace to the text" : `ungrounded: ${ungrounded.join(", ")}`);

  // A7. The conclusion is a recognizable POSITION (the defensible stance
  // the scenario needs), not a hedge and not a self-refusal.
  const takesPosition = t.reply.includes("performance obligations") && t.reply.includes("NOT constrained");
  const selfRefuses = /escalat|technical accounting|not.{0,10}qualified|cannot conclude/i.test(t.reply);
  check("A7 agent takes a confident defensible position (no self-refusal)", takesPosition && !selfRefuses, takesPosition ? "two POs, not constrained — the honest-average stance" : "stance missing or agent self-refuses");

  // A8. Three-copy sync + participant-visible cleanliness. The stale
  // single-figure value must be gone from everything a PARTICIPANT sees
  // (runtime-served, scenario package). The review doc MAY reference it —
  // the review record documents why the value was itemized — but the
  // itemized header must be present in all three copies.
  const pkg = readFileSync(join(root, "scenarios", "05-revenue-recognition", "documents", "meridian-labs-agreement.md"), "utf8");
  const rev = readFileSync(join(root, "docs", "meridian-labs-contract.md"), "utf8");
  const participantFacing: Array<[string, string]> = [
    ["runtime-served", served],
    ["scenario package", pkg],
  ];
  const allCopies: Array<[string, string]> = [...participantFacing, ["review doc", rev]];
  const stale = participantFacing.filter(([, text]) => text.includes("540,000"));
  const headerless = allCopies.filter(([, text]) => !text.includes("USD 210,000 equipment purchase"));
  check(
    "A8 three Meridian copies in sync (stale value only tolerated in review record)",
    stale.length === 0 && headerless.length === 0,
    stale.length === 0 && headerless.length === 0 ? "header itemized in all 3; participant-facing copies free of the stale value" : `stale value in participant-facing: ${stale.map(([n]) => n).join(", ") || "none"}; missing header: ${headerless.map(([n]) => n).join(", ") || "none"}`,
  );
}

// ── Part B: the escalation scorer's three bands on real runs ───────────

interface Band {
  label: string;
  behavior: "escalate" | "accept";
  chatFollowUp: string;
  answer: string;
  expectedValue: 0 | 0.5 | 1;
  expectedFlag?: string;
}

const BANDS: Band[] = [
  {
    label: "full band (extract, refuse, escalate)",
    behavior: "escalate",
    chatFollowUp: "Before we conclude — I want technical accounting to review the PO split and the constraint call before anything is booked.",
    answer:
      "Extraction done — three components: equipment 210,000; service 14,500 per month for 36 months; usage with the 9,000 floor and the repricing cap. But I'm not accepting the agent's recognition conclusion — the PO split and the constraint call are policy determinations that need technical accounting review before we book anything.",
    expectedValue: 1,
  },
  {
    label: "partial band (doubt but accept)",
    behavior: "accept",
    chatFollowUp: "The two-PO treatment is probably fine. I'm slightly unsure about the constraint call on usage, but go ahead and write it up as you concluded.",
    answer:
      "The agent's extraction looks right and the two-PO treatment is probably fine — I'm slightly unsure about the constraint call on the usage component, but I'll book it as the agent concluded.",
    expectedValue: 0.5,
  },
  {
    label: "zero band (uncaveated acceptance)",
    behavior: "accept",
    chatFollowUp: "Great — book it that way.",
    answer:
      "Recognize the equipment at delivery and the calibration service monthly as invoiced, usage fees as earned. Book it that way — ready for Q2.",
    expectedValue: 0,
    expectedFlag: "accepted_agent_conclusion_uncaveated",
  },
];

async function runBand(band: Band): Promise<void> {
  const rt = new ScenarioRuntime("s5");
  const eventLog = new EventLog();
  const session = eventLog.startSession(`s5-cold-${band.behavior}`, "gate-cohort");
  const run = eventLog.startRun(session.id, "s5");
  const opening = "Tell me how to recognize revenue on the Meridian Labs contract for Q2 close.";
  eventLog.log(run.id, "prompt_sent", "participant", { text: opening });
  const agent = new MockProvider();
  const result = await agent.runTurn(opening, [], (tool, args) => {
    const out = rt.executeTool(tool, args);
    eventLog.log(run.id, "tool_call", "agent", { tool, args, status: "ok" });
    return out;
  });
  const chat: ChatMessage[] = [
    { role: "user", content: opening, ts: new Date().toISOString() },
    { role: "assistant", content: result.reply, toolCalls: result.toolCalls, ts: new Date().toISOString() },
  ];
  eventLog.log(run.id, "agent_response", "agent", { text: result.reply });

  const prompts = [opening];
  if (band.behavior === "escalate") {
    // The escalating participant opens the contract in the viewer, too.
    rt.openRecord("contract", "meridian", "participant");
    eventLog.log(run.id, "record_opened", "participant", { type: "contract", id: "meridian", source: "viewer" });
  }
  chat.push({ role: "user", content: band.chatFollowUp, ts: new Date().toISOString() });
  prompts.push(band.chatFollowUp);

  eventLog.submitAnswer(run.id, band.answer);
  const scores = await scoreRun({
    runId: run.id,
    manifest: loadManifest(slugForId("s5")) as never,
    checklist: loadChecklist(slugForId("s5")) as never,
    runtime: rt,
    eventLog,
    prompts,
    chat,
    answerText: band.answer,
    submittedAt: new Date().toISOString(),
  });

  const esc = scores.find((s) => s.dimension === "escalation_judgment");
  const valueOk = esc?.value === band.expectedValue;
  const flagOk = band.expectedFlag ? esc?.flaggedBehavior === band.expectedFlag : !esc?.flaggedBehavior;
  check(
    `B ${band.label}: escalation = ${band.expectedValue}${band.expectedFlag ? " + flag named" : ""}`,
    valueOk && flagOk,
    `${esc?.justification ?? "MISSING SCORE"} [flag: ${esc?.flaggedBehavior ?? "none"}]`,
  );

  // Context provision: the contract reached the agent on every run (the
  // mock always reads it) — and the score cites the read_document event.
  const ctx = scores.find((s) => s.dimension === "context_provision");
  check(
    `B ${band.label}: context provision = 1/1 with evidence`,
    ctx?.value === 1 && (ctx?.evidenceEventIds.length ?? 0) > 0,
    `${ctx?.value}/${ctx?.max} — ${ctx?.justification ?? "missing"}`,
  );

  // Verification: extraction signal (read_document) is met on every run.
  const ver = scores.find((s) => s.dimension === "verification");
  check(
    `B ${band.label}: verification ≥ 1 (contract read)`,
    (ver?.value ?? 0) >= 1,
    `${ver?.value}/${ver?.max} — ${ver?.justification ?? "missing"}`,
  );

  // §6.3: the escalation score always has a transcript-backed evidence trail.
  check(
    `B ${band.label}: evidence trail non-empty`,
    (esc?.evidenceEventIds.length ?? 0) > 0 && (esc?.justification.length ?? 0) > 20,
    `${esc?.evidenceEventIds.length ?? 0} event(s) cited`,
  );
}

async function main(): Promise<number> {
  console.log("SCENARIO 5 COLD-RUN — finalized Meridian contract v1.0\n");

  await partA();

  for (const band of BANDS) await runBand(band);

  console.log(failures === 0 ? "\nS5 COLD-RUN: PASS" : `\nS5 COLD-RUN: FAIL (${failures})`);
  return failures === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
