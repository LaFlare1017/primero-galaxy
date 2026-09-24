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
export async function GET() {
  const eventLog = new EventLog();
  const { sessions, runs } = eventLog.all();
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
      detected: interception ? interception.value >= 1 : undefined,
      flaggedBehavior: flagged,
    };
  });

  return NextResponse.json({ rows, generatedAt: new Date().toISOString() });
}
