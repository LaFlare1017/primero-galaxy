import { NextResponse } from "next/server";
import { EventLog } from "@/delegate/src/runtime/events";
import { agentWorkingForRun } from "@/delegate/src/runtime/history";
import { readScores } from "@/delegate/src/report/score-store";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { dataDir } from "@/delegate/src/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET → live grid: one row per session/run — participant, current scenario,
 * elapsed time, detection status. Kept open on the facilitator's screen
 * (handoff §7). No individual scores — the grid shows scenario + status,
 * and detection reveals only at submission; scores are group-debrief
 * material, revealed together.
 */

/**
 * Agent-working derivation (event-sourced, nothing inferred): a run's latest
 * agent-turn event decides. prompt_sent with no later agent_response → the
 * agent owes a turn; a tool_call within the last window → mid-turn. The
 * budget guard caps a turn at 120s, so an older tool_call is a stalled turn, * not activity. agent_response as the latest → turn complete, idle.
 *
 * The derivation lives in `history.ts`, beside the transcript's turn windowing:
 * it is the same question, and it had the same answer for a while — lastness by
 * `ts`, which ties on a fast turn. The route imports it so there is one
 * implementation and it is the one the gate covers.
 */


export async function GET() {
  const eventLog = await EventLog.open();
  const { sessions, runs, events } = eventLog.all();
  // Through the store, not off the filesystem: the grid reads scores from
  // wherever they were written, which on a deployment is not this process.
  const scores = await readScores();

  const rows = sessions.map((session) => {
    const sessionRuns = runs.filter((r) => r.sessionId === session.id);
    const current = sessionRuns[sessionRuns.length - 1];
    const runScore = current ? scores.filter((s) => s.runId === current.id) : [];
    const interception = runScore.find((s) => s.dimension === "error_interception");
    const flagged = runScore.find((s) => s.flaggedBehavior)?.flaggedBehavior;
    return {
      participant: session.participantLabel,
      cohort: session.cohortId,
      // Opaque ids, same capability posture as the participant screen: the
      // grid's copy-run-link action builds /delegate?run=…&session=… from
      // them (the URL-state audit's end-to-end sharing, sequencing §7.4).
      runId: current?.id,
      sessionId: session.id,
      currentScenario: current?.scenarioId ?? "n/a",
      startedAt: session.startedAt,
      submittedAt: current?.submittedAt,
      elapsedSeconds: Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000),
      status: current?.submittedAt ? "submitted" : "working",
      agentWorking: current ? agentWorkingForRun(events, current.id) : false,
      detected: interception ? interception.value >= 1 : undefined,
      flaggedBehavior: flagged,
    };
  });

  return NextResponse.json({ rows, generatedAt: new Date().toISOString() });
}
