import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { EventLog } from "@/delegate/src/runtime/events";
import { threadFromEvents, toolCallsForTurn } from "@/delegate/src/runtime/history";
import { loadManifest, loadDebrief, slugForId } from "@/delegate/src/scoring/scenario-loader";
import { errorResponse, MAX_ID_CHARS } from "@/delegate/src/api/validate";
import { dataDir } from "@/delegate/src/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/delegate/run/[runId]/state
 * → { sessionId, scenarioId, startedAt, submittedAt?, detected?, verdict?,
 *     debriefNote?, manifest, messages: [{role, content, toolCalls?, ts, eventId?}] }
 *
 * The read side of `?run=` restore (the URL-state audit's opportunities 1+2):
 * the participant screen carries the open run in the URL, and on refresh or
 * remount this endpoint rebuilds everything the UI forgot — run identity and
 * live elapsed clock, the agent thread (already durable as prompt_sent /
 * agent_response event pairs; the chat route rebuilds the exact same thread
 * for provider context), and the submitted state for a completed run.
 *
 * Read-only and scoped by run id: possession of the run id is the same
 * capability the chat/submit APIs already trust, so this changes nothing
 * about the v1 posture. It never exposes scores — detection + debrief note
 * only, the same post-submit surface as /api/delegate/submit (handoff §7).
 *
 * toolCalls are rebuilt for parity with live turns: the chat UI collapses
 * each turn's tool rows, and a restored thread should look exactly like one
 * that never left the screen. Events are ordered (append-only log), so each
 * assistant turn collects the tool_call events between the previous turn
 * boundary and this response's timestamp.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    if (typeof runId !== "string" || runId.length === 0 || runId.length > MAX_ID_CHARS) {
      return NextResponse.json({ error: "invalid run id" }, { status: 400 });
    }

    const eventLog = await EventLog.open();
    const { runs, events } = eventLog.all();
    const run = runs.find((r) => r.id === runId);
    if (!run) return NextResponse.json({ error: `unknown run ${runId}` }, { status: 404 });

    const slug = slugForId(run.scenarioId);
    const manifest = loadManifest(slug);

    // Submitted restore: detection + debrief note from the same artifacts
    // the submit route returned to the live panel (scores stay debrief-only).
    let detected: boolean | undefined;
    // The grid's own rule, exposed honestly: `null` when the scenario
    // planted no interception defect (s5/s6), so a consumer never has to
    // invent a verdict — or wait for a slower poll to tell it one. Note
    // this is NOT the same as `detected` above, which stays the eager
    // boolean the participant panel has always been shown.
    let verdict: boolean | null = null;
    let debriefNote: string | undefined;
    if (run.submittedAt) {
      const scoresPath = join(dataDir(), "scores.json");
      const scores: Array<{ runId: string; dimension: string; value: number }> = existsSync(
        scoresPath,
      )
        ? JSON.parse(readFileSync(scoresPath, "utf8"))
        : [];
      const interception = scores.find((s) => s.runId === runId && s.dimension === "error_interception");
      // s5/s6 have no planted defect: no interception row means "nothing to detect".
      detected = interception ? interception.value >= 1 : true;
      verdict = interception ? interception.value >= 1 : null;
      const debrief = loadDebrief(slug);
      debriefNote =
        debrief.split("## What was planted")[1]?.split("##")[0]?.trim().slice(0, 1200) ?? "";
    }

    // The SAME log as `events` above, deliberately. Rebuilding the thread
    // through readThreadFromEvents would open a second log and read the events
    // table a second time, and the two reads land at different moments: a
    // request that straddles a participant's turn flush would then show the
    // reply (from the newer read) with its tool calls filtered against the
    // older one — a transcript that silently loses the turn's evidence. One
    // snapshot cannot disagree with itself, and on Postgres it is one round
    // trip instead of two.
    const thread = threadFromEvents(eventLog.eventsForRun(runId), runId);
    const messages = thread.map((message, index) => {
      let toolCalls: Array<{ tool: string; args?: Record<string, unknown>; summary?: string }> | undefined;
      if (message.role === "assistant") {
        // The events this turn produced, between the prompt that started it
        // and its own response — bounded by ID, and scoped to this run. See
        // `toolCallsForTurn`, which is where the bound is explained and gated.
        const lower = index > 0 ? (thread[index - 1].eventId ?? 0) : 0;
        const upper = message.eventId ?? Number.MAX_SAFE_INTEGER;
        toolCalls = toolCallsForTurn(events, runId, lower, upper);
      }
      return {
        role: message.role,
        content: message.content,
        ts: message.ts,
        // Carried through for the same reason the window above uses it: a
        // consumer rebuilding the transcript needs the same boundary this
        // route drew, and it cannot recover one from a millisecond timestamp.
        eventId: message.eventId,
        toolCalls,
      };
    });

    return NextResponse.json({
      sessionId: run.sessionId,
      // Restoring must reclaim the session's OWN label: the session API
      // only resumes a session for a matching participantLabel, and a
      // hardcoded name would fork a new session on the next scenario.
      participantLabel: eventLog.getSession(run.sessionId)?.participantLabel ?? "Participant",
      scenarioId: run.scenarioId,
      startedAt: run.startedAt,
      submittedAt: run.submittedAt,
      detected,
      verdict,
      debriefNote,
      manifest,
      messages,
    });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}
