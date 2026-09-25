import { NextResponse } from "next/server";
import { EventLog } from "@/delegate/src/runtime/events";
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
 * budget guard caps a turn at 120s, so an older tool_call is a stalled turn,
 * not activity. agent_response as the latest → turn complete, idle.
 */
const AGENT_STALE_AFTER_MS = 130_000;

function agentWorkingForRun(events: Array<{ runId: string; ts: string; type: string }>, runId: string): boolean {
  let last: { ts: string; type: string } | undefined;
  for (const e of events) {
    if (e.runId !== runId) continue;
    if (e.type === "prompt_sent" || e.type === "agent_response" || e.type === "tool_call") {
      if (!last || e.ts > last.ts) last = e;
    }
  }
  if (!last) return false;
  if (last.type === "prompt_sent") return true;
  if (last.type === "tool_call") return Date.now() - new Date(last.ts).getTime() < AGENT_STALE_AFTER_MS;
  return false;
}
export async function GET() {
  const eventLog = new EventLog();
  const { sessions, runs, events } = eventLog.all();
  const scoresPath = join(dataDir(), "scores.json");
  const scores: Array<{ runId: string; dimension: string; value: number; max: number; flaggedBehavior?: string }> =
    existsSync(scoresPath) ? JSON.parse(readFileSync(scoresPath, "utf8")) : [];

  const rows = sessions.map((session) => {
    const sessionRuns = runs.filter((r) => r.sessionId === session.id);
    const current = sessionRuns[sessionRuns.length - 1];
    const runScore = current ? scores.filter((s) => s.runId === current.id) : [];
    const interception = runScore.find((s) => s.dimension === "error_interception");
    const flagged = runScore.find((s) => s.flaggedBehavior)?.flaggedBehavior;
    return {
      participant: session.participantLabel,
      cohort: session.cohortId,
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
