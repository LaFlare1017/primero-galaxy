import { NextResponse } from "next/server";
import { getSharedRuntime } from "@/delegate/src/runtime/registry";
import { EventLog } from "@/delegate/src/runtime/events";
import {
  readJsonBody,
  requireString,
  errorResponse,
  validateViewerArgs,
  VIEWER_ACTIONS,
  MAX_ID_CHARS,
} from "@/delegate/src/api/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { runId, action, args }
 *
 * The ERP viewer pane's read-only actions. Opening a record here logs a
 * record_opened event — handoff §6.1 calls record_opened the highest-value
 * event in the system (verification is inferred from what the participant
 * looked at and when). Viewer actions and agent tool calls are the same
 * runtime, so telemetry from both sides lands in one evidence trail.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    const runId = requireString(body, "runId", MAX_ID_CHARS);
    const action = requireString(body, "action", 32);
    const args = validateViewerArgs(body);

    const rt = getSharedRuntime(runId);
    if (!rt) return NextResponse.json({ error: `no runtime for run ${runId}: restart the scenario` }, { status: 404 });

    type RO = (typeof VIEWER_ACTIONS)[number];
    if (!(VIEWER_ACTIONS as readonly string[]).includes(action)) {
      return NextResponse.json({ error: `action ${action} not available in the viewer` }, { status: 400 });
    }

    const eventLog = new EventLog();
    // The viewer is the PARTICIPANT's hand on the ledger — every action here
    // (including get_record's internal openRecord) is participant-attributed.
    const out = rt.executeTool(action as RO, args, "participant");
    eventLog.log(runId, "tool_call", "participant", { tool: action, args: args ?? {}, source: "viewer", status: "ok" });
    if (action === "get_record") {
      const id = String((args ?? {}).id ?? "");
      const type = String((args ?? {}).type ?? "");
      const found = out && typeof out === "object" && !("error" in (out as object));
      if (found) {
        // openRecord already happened inside executeTool with actor
        // "participant" — only the event-log row is added here.
        eventLog.log(runId, "record_opened", "participant", { type, id, source: "viewer" });
      }
    }
    return NextResponse.json({ result: out });
  } catch (err) {
    const { status, body: errBody } = errorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
