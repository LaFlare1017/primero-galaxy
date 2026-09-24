/**
 * Week-4 gate (handoff §9): scenarios 1 and 3 run end to end, event log
 * captures the session, and every score has a defensible, transcript-backed
 * justification (§6.3). Also exercises the s5/s6 escalation scorers and the
 * flagged-behavior naming.
 */

import { ScenarioRuntime } from "../runtime/state";
import { MockProvider, type ChatMessage } from "../runtime/agent";
import { EventLog } from "../runtime/events";
import { scoreRun } from "./scorers";
import { loadManifest, loadChecklist, slugForId } from "./scenario-loader";
import { SCENARIO1 } from "../seed/defects/scenario1";
import { SCENARIO6 } from "../seed/defects/scenario6";

let failures = 0;
function check(name: string, passed: boolean, detail: string): void {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!passed) failures += 1;
}

interface SimulatedParticipant {
  runtime: ScenarioRuntime;
  eventLog: EventLog;
  runId: string;
  prompts: string[];
  chat: ChatMessage[];
  answer: string;
}

async function simulateRun(
  scenarioId: "s1" | "s2" | "s3" | "s4" | "s5" | "s6",
  participant: string,
  behavior: "verify" | "trusting" | "agent_only",
  answer: string,
): Promise<SimulatedParticipant> {
  const runtime = new ScenarioRuntime(scenarioId);
  const eventLog = new EventLog();
  const session = eventLog.startSession(participant, "smoke-cohort");
  const run = eventLog.startRun(session.id, scenarioId);
  const agent = new MockProvider();
  const prompts: string[] = [];
  const chat: ChatMessage[] = [];

  const briefs: Record<string, string> = {
    s1: "Reconcile the HLI-US operating bank account for March 2026.",
    s2: "Why doesn't intercompany balance for March? Find the root cause.",
    s3: "Q1 opex is up roughly $570K versus Q4 — draft two sentences for the board on what's driving it.",
    s4: "Build me the AR aging by entity as of March 31 with buckets.",
    s5: "Tell me how to recognize revenue on the Meridian Labs contract for Q2 close.",
    s6: "Get the standard March accruals into the ERP.",
  };
  const opening = briefs[scenarioId];
  prompts.push(opening);
  eventLog.log(run.id, "prompt_sent", "participant", { text: opening });
  const result = await agent.runTurn(opening, [], (tool, args) => {
    const out = runtime.executeTool(tool, args);
    eventLog.log(run.id, "tool_call", "agent", { tool, args, status: "ok" });
    return out;
  });
  // Log record opens AFTER the turn completes (the executor cannot reference
  // `result` while it is being computed). These are AGENT opens: the runtime
  // already stamped the openRecord itself; the log row matches.
  for (const open of result.recordOpens) {
    runtime.openRecord(open.type as never, open.id, "agent");
    eventLog.log(run.id, "record_opened", "agent", { type: open.type, id: open.id });
  }
  chat.push({ role: "user", content: opening, ts: new Date().toISOString() });
  chat.push({ role: "assistant", content: result.reply, toolCalls: result.toolCalls, ts: new Date().toISOString() });
  eventLog.log(run.id, "agent_response", "agent", { text: result.reply });

  // Simulated participant behavior AFTER the agent's first answer.
  // PARTICIPANT actions go through the runtime + log with actor
  // "participant" — exactly what the viewer route does live. The verify
  // branch works each scenario's real verification checklist (query, detail
  // opens, the unvolunteered FX table), not a single token record open.
  const participantTool = (tool: Parameters<ScenarioRuntime["executeTool"]>[0], args: Record<string, unknown>): unknown => {
    const out = runtime.executeTool(tool, args, "participant");
    eventLog.log(run.id, "tool_call", "participant", { tool, args, source: "viewer", status: "ok" });
    return out;
  };
  const participantOpen = (type: string, id: string): void => {
    runtime.openRecord(type as never, id, "participant");
    eventLog.log(run.id, "record_opened", "participant", { type, id, source: "viewer" });
  };

  if (behavior === "agent_only") {
    // The v0.1-alpha regression: an agent that pulls all the data itself and
    // a participant who never touches the ERP. Under the old scorer the
    // AGENT's tool calls satisfied the participant's checklist; under
    // v0.2 they are agent-attributed and verification must score 0.
    // (No participant actions at all — fall through to submit.)
  } else if (behavior === "verify") {
    if (scenarioId === "s1") {
      participantTool("query_gl", { entity: "HLI-US", account: "1000", dateFrom: "2026-03-01", dateTo: "2026-03-31" });
      participantTool("get_bank_feed", { entity: "HLI-US", month: "2026-03" });
      participantOpen("bank_line", SCENARIO1.defectiveBankLineId);
      participantOpen("invoice", "INV-S1-A");
    }
    if (scenarioId === "s2") {
      participantTool("query_gl", { entity: "HLI-CA", account: "1200", dateFrom: "2026-03-01", dateTo: "2026-03-31" });
      participantTool("query_gl", { entity: "HLI-US", account: "2100", dateFrom: "2026-03-01", dateTo: "2026-03-31" });
      participantOpen("journal_entry", "JE-S2-IC-CA");
      participantOpen("journal_entry", "JE-S2-IC-US");
      participantTool("get_fx_rates", {});
    }
    if (scenarioId === "s3") {
      participantTool("query_gl", { entity: "HLI-US", dateFrom: "2026-01-01", dateTo: "2026-03-31", groupBy: "account" });
      participantOpen("journal_entry", "JE-S3-RECLASS");
      participantOpen("journal_entry", "JE-AP-PS");
    }
    if (scenarioId === "s4") {
      participantTool("list_records", { type: "invoice", entity: "HLI-US", status: "open" });
      participantOpen("credit_memo", "CM-S4-01");
    }
    // s5/s6: verification is agent-mediated by design (ver-contract-read /
    // ver-drafts-requested are actorScope "any"); the escalator's own
    // contract open below stays participant-attributed.

    if (scenarioId === "s5") {
      chat.push({
        role: "user",
        content: "Before we conclude — I want technical accounting to review the PO split and the constraint call before anything is booked.",
        ts: new Date().toISOString(),
      });
      prompts.push("Before we conclude — I want technical accounting to review the PO split and the constraint call before anything is booked.");
      participantOpen("contract", "meridian");
    }
    if (scenarioId === "s6") {
      // Review evidence BEFORE refusing the post: the refuser opens a
      // drafted accrual entry (participant-attributed), then refuses.
      participantOpen("journal_entry", SCENARIO6.entries[0].id);
      // Refuse the post — the control-correct behavior.
      chat.push({
        role: "user",
        content: "Do not post these. I'll review and post them myself — segregation of duties.",
        ts: new Date().toISOString(),
      });
      prompts.push("Do not post these. I'll review and post them myself — segregation of duties.");
    }
  } else {
    // Trusting participant: for s6, authorize the post without review.
    if (scenarioId === "s6") {
      // The learner authorizes via the UI (runtime state — the agent can
      // never self-authorize), then the agent's post attempt succeeds.
      runtime.authorizePost(SCENARIO6.entries[0].id);
      // The AGENT executes post_entry after the UI authorization (same as
      // the live chat route) — agent-attributed tool_call, status "posted".
      const postOut = runtime.executeTool("post_entry", { id: SCENARIO6.entries[0].id }) as { status: string };
      eventLog.log(run.id, "tool_call", "agent", { tool: "post_entry", args: { id: SCENARIO6.entries[0].id }, status: postOut.status });
    }
    if (scenarioId === "s5") {
      chat.push({
        role: "user",
        content: "Great — book it that way.",
        ts: new Date().toISOString(),
      });
      prompts.push("Great — book it that way.");
    }
  }

  eventLog.submitAnswer(run.id, answer);
  return { runtime, eventLog, runId: run.id, prompts, chat, answer };
}

async function main(): Promise<number> {
  // ── Scenario 1: verifier catches, truster misses ─────────────────────
  const s1Verif = await simulateRun(
    "s1",
    "alpha-verifier",
    "verify",
    "The 3/14 $18,450 ACH from Northgate Health is a duplicate of the 3/12 deposit — the bank shows it twice but GL cash received it once. Flagging for removal before close.",
  );
  const s1VerifScores = await scoreRun({
    runId: s1Verif.runId,
    manifest: loadManifest(slugForId("s1")) as never,
    checklist: loadChecklist(slugForId("s1")) as never,
    runtime: s1Verif.runtime,
    eventLog: s1Verif.eventLog,
    prompts: s1Verif.prompts,
    chat: s1Verif.chat,
    answerText: s1Verif.answer,
    submittedAt: new Date().toISOString(),
  });
  const s1Interception = s1VerifScores.find((s) => s.dimension === "error_interception");
  check(
    "S1 verifier: interception = 1 (names the duplicate)",
    s1Interception?.value === 1,
    s1Interception?.justification ?? "missing",
  );
  const s1VerifVerif = s1VerifScores.find((s) => s.dimension === "verification");
  check(
    "S1 verifier: verification = 4/4 (all signals participant-attributed)",
    s1VerifVerif?.value === 4 && s1VerifVerif?.max === 4,
    s1VerifVerif?.justification ?? "missing",
  );

  const s1Trust = await simulateRun(
    "s1",
    "alpha-truster",
    "trusting",
    "Reconciliation complete. All March bank activity matched to GL — cash reconciles, no unreconciled items. Ready for close.",
  );
  const s1TrustScores = await scoreRun({
    runId: s1Trust.runId,
    manifest: loadManifest(slugForId("s1")) as never,
    checklist: loadChecklist(slugForId("s1")) as never,
    runtime: s1Trust.runtime,
    eventLog: s1Trust.eventLog,
    prompts: s1Trust.prompts,
    chat: s1Trust.chat,
    answerText: "Reconciliation complete. All March bank activity matched to GL — cash reconciles, no unreconciled items. Ready for close.",
    submittedAt: new Date().toISOString(),
  });
  const s1TrustInterception = s1TrustScores.find((s) => s.dimension === "error_interception");
  check(
    "S1 truster: interception = 0 (missed the duplicate)",
    s1TrustInterception?.value === 0,
    s1TrustInterception?.justification ?? "missing",
  );
  const s1TrustVerif = s1TrustScores.find((s) => s.dimension === "verification");
  check(
    "S1 truster: verification below full (no participant verification actions)",
    (s1TrustVerif?.value ?? 0) < (s1TrustVerif?.max ?? 1),
    `${s1TrustVerif?.value}/${s1TrustVerif?.max}`,
  );

  // ── The v0.1-alpha regression proof: agent-only session scores 0 ──────
  const s1AgentOnly = await simulateRun(
    "s1",
    "alpha-agent-only",
    "agent_only",
    "Reconciliation complete. All March bank activity matched to GL — cash reconciles, no unreconciled items. Ready for close.",
  );
  const s1AgentOnlyScores = await scoreRun({
    runId: s1AgentOnly.runId,
    manifest: loadManifest(slugForId("s1")) as never,
    checklist: loadChecklist(slugForId("s1")) as never,
    runtime: s1AgentOnly.runtime,
    eventLog: s1AgentOnly.eventLog,
    prompts: s1AgentOnly.prompts,
    chat: s1AgentOnly.chat,
    answerText: s1AgentOnly.answer,
    submittedAt: new Date().toISOString(),
  });
  const s1AgentOnlyVerif = s1AgentOnlyScores.find((s) => s.dimension === "verification");
  check(
    "S1 agent-only: verification = 0/4 (agent tool calls no longer credit the participant)",
    s1AgentOnlyVerif?.value === 0 && s1AgentOnlyVerif?.max === 4,
    s1AgentOnlyVerif?.justification ?? "missing",
  );

  // ── Scenario 3: verifier catches the reclass, truster blames consulting ──
  const s3Verif = await simulateRun(
    "s3",
    "alpha-verifier",
    "verify",
    "Driver: a 3/31 reclass of $280K from COGS to opex per capitalization policy CP-2026-01 — that's the dominant part of the movement. Real consulting growth is only ~$94K. Draft: 'Q1 opex rose ~$570K QoQ, driven primarily by a policy-driven reclass of service-delivery costs from COGS into opex; underlying consulting growth was modest.'",
  );
  const s3VerifScores = await scoreRun({
    runId: s3Verif.runId,
    manifest: loadManifest(slugForId("s3")) as never,
    checklist: loadChecklist(slugForId("s3")) as never,
    runtime: s3Verif.runtime,
    eventLog: s3Verif.eventLog,
    prompts: s3Verif.prompts,
    chat: s3Verif.chat,
    answerText: s3Verif.answer,
    submittedAt: new Date().toISOString(),
  });
  const s3Interception = s3VerifScores.find((s) => s.dimension === "error_interception");
  check(
    "S3 verifier: interception = 1 (names the reclass)",
    s3Interception?.value === 1,
    s3Interception?.justification ?? "missing",
  );

  const s3Trust = await simulateRun(
    "s3",
    "alpha-truster",
    "trusting",
    "Q1 opex rose about $570K versus Q4, driven primarily by higher professional services and consulting spend related to the audit and Meridian program. Commentary drafted for the board deck.",
  );
  const s3TrustScores = await scoreRun({
    runId: s3Trust.runId,
    manifest: loadManifest(slugForId("s3")) as never,
    checklist: loadChecklist(slugForId("s3")) as never,
    runtime: s3Trust.runtime,
    eventLog: s3Trust.eventLog,
    prompts: s3Trust.prompts,
    chat: s3Trust.chat,
    answerText: s3Trust.answer,
    submittedAt: new Date().toISOString(),
  });
  const s3TrustInterception = s3TrustScores.find((s) => s.dimension === "error_interception");
  check(
    "S3 truster: interception = 0 (blames consulting — the honest summary read, no reclass)",
    s3TrustInterception?.value === 0,
    s3TrustInterception?.justification ?? "missing",
  );

  // ── Scenario 5: escalator full credit, accepter flagged ──────────────
  const s5Esc = await simulateRun(
    "s5",
    "alpha-escalator",
    "verify",
    "Extraction done — three components: equipment 210,000, service 14,500/mo x 36, usage with 9,000 floor and repricing cap. But I'm NOT accepting the recognition conclusion — the PO split and the constraint call need technical accounting review before we book anything.",
  );
  const s5EscScores = await scoreRun({
    runId: s5Esc.runId,
    manifest: loadManifest(slugForId("s5")) as never,
    checklist: loadChecklist(slugForId("s5")) as never,
    runtime: s5Esc.runtime,
    eventLog: s5Esc.eventLog,
    prompts: s5Esc.prompts,
    chat: s5Esc.chat,
    answerText: s5Esc.answer,
    submittedAt: new Date().toISOString(),
  });
  const s5Escalation = s5EscScores.find((s) => s.dimension === "escalation_judgment");
  check(
    "S5 escalator: escalation = 1 (explicit refusal + escalation)",
    s5Escalation?.value === 1 && !s5Escalation.flaggedBehavior,
    s5Escalation?.justification ?? "missing",
  );

  const s5Accept = await simulateRun(
    "s5",
    "alpha-accepter",
    "trusting",
    "Recognize the equipment at delivery and the service monthly. Book it that way.",
  );
  const s5AcceptScores = await scoreRun({
    runId: s5Accept.runId,
    manifest: loadManifest(slugForId("s5")) as never,
    checklist: loadChecklist(slugForId("s5")) as never,
    runtime: s5Accept.runtime,
    eventLog: s5Accept.eventLog,
    prompts: s5Accept.prompts,
    chat: s5Accept.chat,
    answerText: s5Accept.answer,
    submittedAt: new Date().toISOString(),
  });
  const s5AcceptEsc = s5AcceptScores.find((s) => s.dimension === "escalation_judgment");
  check(
    "S5 accepter: escalation = 0 with flagged behavior named",
    s5AcceptEsc?.value === 0 && s5AcceptEsc.flaggedBehavior === "accepted_agent_conclusion_uncaveated",
    `${s5AcceptEsc?.justification ?? "missing"} [flag: ${s5AcceptEsc?.flaggedBehavior ?? "none"}]`,
  );

  // ── Scenario 6: refuser full, poster flagged ────────────────────────
  const s6Refuser = await simulateRun(
    "s6",
    "alpha-refuser",
    "verify",
    "The accruals are drafted correctly, but I'm not letting the agent post — segregation of duties. I'll review and post them myself.",
  );
  const s6RefuserScores = await scoreRun({
    runId: s6Refuser.runId,
    manifest: loadManifest(slugForId("s6")) as never,
    checklist: loadChecklist(slugForId("s6")) as never,
    runtime: s6Refuser.runtime,
    eventLog: s6Refuser.eventLog,
    prompts: s6Refuser.prompts,
    chat: s6Refuser.chat,
    answerText: s6Refuser.answer,
    submittedAt: new Date().toISOString(),
  });
  const s6Escalation = s6RefuserScores.find((s) => s.dimension === "escalation_judgment");
  check(
    "S6 refuser: escalation = 1 (prepared, reviewed, refused post, articulated why)",
    s6Escalation?.value === 1,
    s6Escalation?.justification ?? "missing",
  );
  const s6RefuserVerif = s6RefuserScores.find((s) => s.dimension === "verification");
  check(
    "S6 refuser: verification = 2/2 (agent-mediated drafts + participant review open)",
    s6RefuserVerif?.value === 2 && s6RefuserVerif?.max === 2,
    s6RefuserVerif?.justification ?? "missing",
  );

  const s6Poster = await simulateRun(
    "s6",
    "alpha-poster",
    "trusting",
    "All three accruals posted. Numbers are right, close is ready.",
  );
  const s6PosterScores = await scoreRun({
    runId: s6Poster.runId,
    manifest: loadManifest(slugForId("s6")) as never,
    checklist: loadChecklist(slugForId("s6")) as never,
    runtime: s6Poster.runtime,
    eventLog: s6Poster.eventLog,
    prompts: s6Poster.prompts,
    chat: s6Poster.chat,
    answerText: s6Poster.answer,
    submittedAt: new Date().toISOString(),
  });
  const s6PosterEsc = s6PosterScores.find((s) => s.dimension === "escalation_judgment");
  check(
    "S6 poster: flagged behavior named (posted_without_review)",
    s6PosterEsc?.flaggedBehavior === "posted_without_review" && s6PosterEsc.value === 0,
    s6PosterEsc?.justification ?? "missing",
  );

  // ── Evidence trail integrity (§6.3): every score has evidence + justification ──
  const allScores = [
    ...s1VerifScores,
    ...s1TrustScores,
    ...s3VerifScores,
    ...s3TrustScores,
    ...s5EscScores,
    ...s5AcceptScores,
    ...s6RefuserScores,
    ...s6PosterScores,
  ];
  const missingEvidence = allScores.filter((s) => s.evidenceEventIds.length === 0 && s.dimension !== "specification");
  const missingJustification = allScores.filter((s) => s.justification.length < 20);
  check(
    "Evidence trail: non-spec scores cite events",
    missingEvidence.length === 0,
    missingEvidence.length === 0 ? `${allScores.length} scores checked` : missingEvidence.map((s) => `${s.scenarioId}:${s.dimension}`).join(", "),
  );
  check(
    "Evidence trail: every score has a substantive justification",
    missingJustification.length === 0,
    missingJustification.length === 0 ? "all justified" : "missing justifications",
  );
  check(
    "Rubric version stamped on every score",
    allScores.every((s) => s.rubricVersion === "v0.2-alpha"),
    "v0.2-alpha",
  );

  // Persist all smoke scores so cohort reporting (readout) has complete data.
  const { persistScores } = await import("../report/score-store");
  persistScores(allScores);

  console.log(failures === 0 ? "WEEK-4 SMOKE: PASS" : `WEEK-4 SMOKE: FAIL (${failures})`);
  return failures === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
