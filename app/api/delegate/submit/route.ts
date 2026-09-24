import { NextResponse } from "next/server";
import { EventLog } from "@/delegate/src/runtime/events";
import { getSharedRuntime, globalRegistry } from "@/delegate/src/runtime/registry";
import { scoreRun } from "@/delegate/src/scoring/scorers";
import { loadManifest, loadChecklist, slugForId } from "@/delegate/src/scoring/scenario-loader";
import type { ChatMessage } from "@/delegate/src/runtime/agent";
import { readThreadFromEvents } from "@/delegate/src/runtime/history";
import { readJsonBody, requireString, errorResponse, MAX_ANSWER_CHARS, MAX_ID_CHARS, MIN_ANSWER_WORDS } from "@/delegate/src/api/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { runId, answer }
 * → { detected: boolean, debriefNote: string }
 *
 * Per handoff §7: post-submit shows ONLY whether the defect was detected
 * plus the debrief note — never the numeric score (scores are revealed
 * together in the facilitator-led debrief). The full scored record is
 * persisted for the facilitator.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    const runId = requireString(body, "runId", MAX_ID_CHARS);
    const answer = requireString(body, "answer", MAX_ANSWER_CHARS);

    const eventLog = new EventLog();
    // Idempotency FIRST: a run may be scored exactly once. A double-submit
    // (double click, client retry) would otherwise persist DUPLICATE score
    // rows and double-count the participant in the cohort readout. This check
    // must precede the runtime lookup — scoring frees the runtime, so any
    // post-submit attempt finds no runtime and would 404 confusingly before
    // a late check could ever fire.
    const existing = eventLog.all().runs.find((r) => r.id === runId);
    if (existing?.submittedAt) {
      return NextResponse.json({ error: "already submitted: this scenario is complete" }, { status: 409 });
    }

    // Server-side word gate: mirrors the UI's 40-word minimum. The UI
    // disables the button below the threshold, but the API is the
    // authority; without this, an API caller bypasses the gate the
    // checklist treats as real ("the ~40-word gate blocks it").
    if (answer.split(/\s+/).filter(Boolean).length < MIN_ANSWER_WORDS) {
      return NextResponse.json(
        { error: `answer is below the ${MIN_ANSWER_WORDS}-word minimum: write your conclusion, what you checked, and what you are unsure of` },
        { status: 422 },
      );
    }

    const rt = getSharedRuntime(runId);
    if (!rt) return NextResponse.json({ error: `no runtime for run ${runId}` }, { status: 404 });
    const scenarioId = rt.scenarioId;

    const run = eventLog.submitAnswer(runId, answer);
    if (!run) return NextResponse.json({ error: `unknown run ${runId}` }, { status: 404 });

    const slug = slugForId(scenarioId);
    const manifest = loadManifest(slug) as never;
    const checklist = loadChecklist(slug) as never;
    const chat = readThreadFromEvents(runId);

    const prompts = chat.filter((m) => m.role === "user").map((m) => m.content);
    const scores = await scoreRun({
      runId,
      manifest,
      checklist,
      runtime: rt,
      eventLog,
      prompts,
      chat,
      answerText: answer,
      submittedAt: run.submittedAt ?? new Date().toISOString(),
    });

    // Persist scores (evidence trail survives restarts).
    const { persistScores } = await import("@/delegate/src/report/score-store");
    persistScores(scores);
    globalRegistry.delete(runId); // free the runtime; the run is complete

    // Post-submit feedback: detection status only (never numeric scores).
    const interception = scores.find((s) => s.dimension === "error_interception");
    const detected = interception ? interception.value >= 1 : true; // s5/s6: no defect to detect
    const { loadDebrief } = await import("@/delegate/src/scoring/scenario-loader");
    const debrief = loadDebrief(slug);
    const debriefNote = debrief.split("## What was planted")[1]?.split("##")[0]?.trim().slice(0, 1200) ?? "";

    return NextResponse.json({ detected, debriefNote, scored: scores.length });
  } catch (err) {
    const { status, body: errBody } = errorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
