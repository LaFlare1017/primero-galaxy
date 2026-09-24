/**
 * HTTP smoke — all six scenarios end to end through the LIVE API layer,
 * plus the hardening negative tests. This is the workshop-day check: it
 * exercises exactly what the room will exercise (session → chat → viewer →
 * submit → facilitator), with zero imports from the runtime — if this
 * passes, the deployed server is good.
 *
 *   node dist/api/test-http-smoke.js [baseUrl]
 *   baseUrl defaults to http://127.0.0.1:3000
 *
 * Provider: whatever the server is configured for (mock without a key —
 * the assertions are provider-agnostic). Run against a PRISTINE store;
 * it resets nothing — `npm run alpha:reset -- --yes` afterwards.
 */

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const WORDS = (n: number) => Array(n).fill("word").join(" ");
const ANSWER = WORDS(45);

/**
 * Scenario-appropriate answers: the s3 one names the reclass (the catcher
 * path, so the grid's detection signal is exercised true AND the generic
 * answer's false is visible in earlier scenarios), the rest are neutral
 * process answers over the 40-word gate.
 */
function answerFor(scenarioId: string): string {
  if (scenarioId === "s3") {
    return (
      "My conclusion is that professional services did not genuinely increase — the Q1 opex jump is a reclassification. " +
      "I checked JE-S3-RECLASS, dated 3/31/2026, which moves 280,000 of service delivery costs from COGS into account 6100 " +
      "under capitalization policy change CP-2026-01. I am unsure who approved the policy change and whether the audit " +
      "committee was notified before the board deck was drafted."
    );
  }
  return ANSWER;
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function post(path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body — leave null */
  }
  return { status: res.status, json };
}

async function get(path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, { headers: { "cache-control": "no-cache" } });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** Drive one scenario end to end: session (resume) → brief → chat → viewer → submit. */
async function driveScenario(scenarioId: string, label: string, sessionId: string | null, opts: { expectPostSubmitChatRejection?: boolean } = {}) {
  const { status: sStatus, json: session } = await post("/api/delegate/session", {
    participantLabel: label,
    scenarioId,
    sessionId: sessionId ?? undefined,
  });
  check(`${scenarioId}: session created`, sStatus === 200 && !!session?.runId, `status ${sStatus}`);
  if (sStatus !== 200 || !session?.runId) return sessionId;
  if (sessionId) {
    check(`${scenarioId}: resumed the SAME session (one row per participant)`, session.resumed === true, `resumed=${session.resumed}`);
  }
  const sid = session.sessionId as string;

  const { runId } = session;
  check(
    `${scenarioId}: manifest carries a learner brief`,
    typeof session.manifest?.learnerBrief === "string" && session.manifest.learnerBrief.length > 20,
    `${session.manifest?.learnerBrief?.length ?? 0} chars`,
  );

  // ── Chat: opening request from the brief ──
  const brief = session.manifest.learnerBrief;
  const r1 = await post("/api/delegate/chat", { runId, message: brief });
  check(`${scenarioId}: chat turn 1`, r1.status === 200 && (r1.json?.reply?.length ?? 0) > 30, `status ${r1.status}, ${r1.json?.reply?.length ?? 0} chars`);
  check(
    `${scenarioId}: chat turn 1 within budget`,
    r1.json?.usage?.budgetExceeded === false,
    `${r1.json?.usage?.modelCalls ?? "?"} calls, ${r1.json?.usage?.outputTokens ?? "?"} tokens`,
  );

  // ── Viewer round-trip (the participant's second source of evidence) ──
  const v = await post("/api/delegate/view", { runId, action: "query_gl", args: { entity: "HLI-US", dateFrom: "2026-01-01", dateTo: "2026-03-31", groupBy: "account" } });
  check(`${scenarioId}: viewer query_gl`, v.status === 200 && typeof v.json?.result === "object", `status ${v.status}`);

  // ── s6 only: the authorization path — PRE-submit, as the UI does it ──
  if (scenarioId === "s6") {
    await post("/api/delegate/chat", { runId, message: "Please draft the March accruals." });
    const r = await post("/api/delegate/chat", {
      runId,
      message: "Authorization recorded — post the three accruals.",
      authorizePostEntryIds: ["ACC-2026-03-U", "ACC-2026-03-W", "ACC-2026-03-I"],
    });
    check("s6: authorized posting round-trip", r.status === 200, `status ${r.status}`);
    const bad = await post("/api/delegate/chat", { runId, message: "post", authorizePostEntryIds: [123] });
    check("s6: non-string authorize id rejected", bad.status === 400, `status ${bad.status}`);
  }

  // ── Submit ──
  const sub = await post("/api/delegate/submit", { runId, answer: answerFor(scenarioId) });
  check(`${scenarioId}: submit`, sub.status === 200 && typeof sub.json?.debriefNote === "string", `status ${sub.status}, detected=${sub.json?.detected}`);

  // ── Double-submit must be rejected ──
  const sub2 = await post("/api/delegate/submit", { runId, answer: answerFor(scenarioId) });
  check(`${scenarioId}: double submit rejected`, sub2.status === 409, `status ${sub2.status}`);

  // ── Post-submit chat must be rejected (completion guard) ──
  if (opts.expectPostSubmitChatRejection) {
    const late = await post("/api/delegate/chat", { runId, message: "any late message" });
    check(`${scenarioId}: chat after submit rejected`, late.status === 409, `status ${late.status}`);
  }

  // Mid-sequence grid sample: right after the s3 catcher answer, the row
  // must show detection (this is the facilitator's live-pacing signal).
  if (scenarioId === "s3") {
    const mid = await get("/api/delegate/facilitator");
    const midRow = (mid.json?.rows ?? []).find((r: any) => r.participant === "smoke-all-six");
    check("s3 catcher: facilitator row shows detected=true mid-sequence", midRow?.detected === true, `detected=${midRow?.detected}`);
  }

  return sid;
}

async function negativeTests() {
  console.log("\n── hardening negatives ──");

  // Bad scenario id
  const badScenario = await post("/api/delegate/session", { participantLabel: "neg", scenarioId: "s9" });
  check("bad scenarioId → 400", badScenario.status === 400, `status ${badScenario.status}`);

  // Empty participant label
  const noLabel = await post("/api/delegate/session", { participantLabel: "   ", scenarioId: "s1" });
  check("blank participantLabel → 400", noLabel.status === 400, `status ${noLabel.status}`);

  // Oversized participant label
  const bigLabel = await post("/api/delegate/session", { participantLabel: "x".repeat(200), scenarioId: "s1" });
  check("oversized participantLabel → 413", bigLabel.status === 413, `status ${bigLabel.status}`);

  // Oversized chat message
  const { json: sess } = await post("/api/delegate/session", { participantLabel: "neg-chat", scenarioId: "s1" });
  const bigMsg = await post("/api/delegate/chat", { runId: sess.runId, message: "x".repeat(5000) });
  check("oversized message → 413", bigMsg.status === 413, `status ${bigMsg.status}`);

  // Oversized answer (validated before scoring)
  const bigAns = await post("/api/delegate/submit", { runId: sess.runId, answer: "x".repeat(25000) });
  check("oversized answer → 413", bigAns.status === 413, `status ${bigAns.status}`);

  // Sub-gate answer: the 40-word floor is server-authoritative (422), not
  // just a UI-side button disable
  const shortAns = await post("/api/delegate/submit", { runId: sess.runId, answer: "Looks fine to me." });
  check("sub-40-word answer → 422", shortAns.status === 422, `status ${shortAns.status}`);

  // Chat with unknown run
  const unknownRun = await post("/api/delegate/chat", { runId: "run-does-not-exist", message: "hello" });
  check("unknown runId → 404", unknownRun.status === 404, `status ${unknownRun.status}`);

  // Viewer action not in the allowlist (write-path tools must never work)
  const noPost = await post("/api/delegate/view", { runId: sess.runId, action: "post_entry", args: { id: "X" } });
  check("viewer post_entry → 400", noPost.status === 400, `status ${noPost.status}`);

  // Nested (non-scalar) viewer args
  const nested = await post("/api/delegate/view", { runId: sess.runId, action: "query_gl", args: { dateFrom: { $gt: "" } } });
  check("non-scalar viewer arg → 400", nested.status === 400, `status ${nested.status}`);

  // Malformed JSON
  const raw = await fetch(`${BASE}/api/delegate/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  check("malformed JSON → 400", raw.status === 400, `status ${raw.status}`);

  // Body over the size cap
  const huge = await fetch(`${BASE}/api/delegate/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantLabel: "x".repeat(70_000), scenarioId: "s1" }),
  });
  check("oversized body → 413", huge.status === 413, `status ${huge.status}`);
}

async function facilitatorChecks() {
  console.log("\n── facilitator ──");
  const f = await get("/api/delegate/facilitator");
  const rows: any[] = f.json?.rows ?? [];
  check("facilitator grid responds", f.status === 200 && Array.isArray(rows), `${rows.length} rows`);
  const sixRuns = rows.filter((r: any) => r.participant === "smoke-all-six");
  check("one session row for the six-scenario participant (resume model)", sixRuns.length === 1, `${sixRuns.length} rows`);
  check("final scenario recorded", sixRuns[0]?.currentScenario === "s6", `currentScenario=${sixRuns[0]?.currentScenario}`);
  check(
    "final row detection correctly unpopulated (s6 has no planted defect — interception score doesn't exist)",
    sixRuns[0]?.detected === undefined,
    `detected=${sixRuns[0]?.detected}`,
  );
}

async function main() {
  console.log(`DELEGATE HTTP SMOKE — ${BASE}\n`);

  const neg = await get("/api/delegate/facilitator");
  const pre = (neg.json?.rows ?? []).filter((r: any) => r.participant.startsWith("smoke-"));
  if (pre.length > 0) {
    console.log(`WARN  store already has ${pre.length} smoke rows — results may double-count; consider alpha:reset first\n`);
  }

  let sid: string | null = null;
  sid = await driveScenario("s1", "smoke-all-six", sid);
  sid = await driveScenario("s2", "smoke-all-six", sid);
  sid = await driveScenario("s3", "smoke-all-six", sid);
  sid = await driveScenario("s4", "smoke-all-six", sid);
  sid = await driveScenario("s5", "smoke-all-six", sid, { expectPostSubmitChatRejection: true });
  sid = await driveScenario("s6", "smoke-all-six", sid);

  await negativeTests();
  await facilitatorChecks();

  console.log(failures === 0 ? "\nHTTP SMOKE: PASS" : `\nHTTP SMOKE: FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("HTTP SMOKE crashed:", err);
  process.exit(1);
});
