import { NextResponse } from "next/server";
import { EventLog } from "@/delegate/src/runtime/events";
import { ScenarioRuntime } from "@/delegate/src/runtime/state";
import { loadManifest, slugForId } from "@/delegate/src/scoring/scenario-loader";
import {
  readJsonBody,
  optionalString,
  requireString,
  requireScenarioId,
  errorResponse,
  ValidationError,
  MAX_LABEL_CHARS,
  MAX_COHORT_CHARS,
} from "@/delegate/src/api/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { participantLabel, cohortId?, scenarioId, sessionId? }
 * → { sessionId, runId, manifest, availableTools, resumed? }
 *
 * Session/run state lives in JSON files under delegate/data/ (v1 single-
 * machine workshop tool). A process restart mid-session would orphan
 * sessions; acceptable for the facilitated, in-person v1.
 *
 * sessionId support: a participant runs MULTIPLE scenarios under ONE
 * session (s1 then s3 in the alpha) — the facilitator grid is one row per
 * participant, so scenario transitions must not spawn a new session row.
 */
export async function POST(req: Request) {
  // Declared out here so the finally below can flush a run that was started and
  // then failed on: the store is opened lazily, so a request that fails
  // validation never pays for a connection.
  let eventLog: EventLog | null = null;
  try {
    const body = await readJsonBody(req);
    const participantLabel = requireString(body, "participantLabel", MAX_LABEL_CHARS);
    const cohortId =
      optionalString(body, "cohortId", MAX_COHORT_CHARS) ||
      process.env.DELEGATE_COHORT_ID?.trim() ||
      "workshop-1";
    const scenarioId = requireScenarioId(body);

    eventLog = await EventLog.open();
    // Cohort identity: request body > DELEGATE_COHORT_ID (set on the server
    // process for a workshop/alpha) > default. The alpha run-of-show names
    // its cohort (alpha-w6) via this env var so the readout groups correctly.
    // Resume when a sessionId is supplied and still exists — one participant,
    // one session row, many scenario runs. Ownership check: the supplied
    // label must match the session's stored label, otherwise a participant
    // quoting ANOTHER participant's session id (overheard, guessed) would
    // silently append their runs to the victim's facilitator row. On a
    // mismatch, start a fresh session — benign for the honest case (typo,
    // stale localStorage), and the facilitator sees the split immediately.
    let claimed: ReturnType<EventLog["getSession"]> = undefined;
    if (body.sessionId !== undefined) {
      if (typeof body.sessionId !== "string" || body.sessionId.length === 0 || body.sessionId.length > 64) {
        throw new ValidationError(400, "field 'sessionId' must be a string of 1–64 characters");
      }
      claimed = eventLog.getSession(body.sessionId);
    }
    const existing = claimed && claimed.participantLabel === participantLabel ? claimed : undefined;
    const resumed = !!existing;
    const session = existing ?? eventLog.startSession(participantLabel, cohortId);
    const run = eventLog.startRun(session.id, scenarioId);

    // Create the runtime eagerly and register it so chat turns share state.
    const rt = new ScenarioRuntime(scenarioId);
    getRuntimeStore().set(run.id, rt);

    const manifest = loadManifest(slugForId(scenarioId));
    return NextResponse.json({
      sessionId: session.id,
      runId: run.id,
      manifest,
      availableTools: rt.availableToolNames(),
      resumed,
    });
  } catch (err) {
    const { status, body: errBody } = errorResponse(err);
    return NextResponse.json(errBody, { status });
  } finally {
    // What this request started is durable whether or not the request
    // succeeded — a participant who got a 500 still has a run row, so the
    // facilitator grid is not silently missing them.
    await eventLog?.flush();
  }
}

// Tiny per-process registry so chat/submit hit the same runtime instance.
// v1 single machine: in-memory is correct. (Restart mid-scenario orphans
// the runtime — documented v1 limitation.)
import { globalRegistry } from "@/delegate/src/runtime/registry";
function getRuntimeStore() {
  return globalRegistry;
}
