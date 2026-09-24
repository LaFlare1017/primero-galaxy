import { NextResponse } from "next/server";
import { getSharedRuntime } from "@/delegate/src/runtime/registry";
import { makeProvider, DEFAULT_BUDGET } from "@/delegate/src/runtime/agent";
import { EventLog } from "@/delegate/src/runtime/events";
import {
  readJsonBody,
  requireString,
  validateAuthorizeIds,
  errorResponse,
  MAX_MESSAGE_CHARS,
  MAX_ID_CHARS,
} from "@/delegate/src/api/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { runId, message, authorizePostEntryIds? }
 * → { reply, toolCalls: [{tool, args, summary}], ts, provider, usage }
 *
 * Runs one agentic turn (multiple model hops within the turn), logging
 * prompt_sent / tool_call / agent_response / agent_usage events, plus
 * budget_exceeded when the per-turn guard trips (graceful: a partial reply
 * is returned, never a 500).
 *
 * The provider receives the SCENARIO-GATED tool list from the runtime —
 * the model can only ever see the tools its scenario allows.
 *
 * authorizePostEntryIds is the learner's explicit control decision (s6):
 * the UI button records authorization, then the agent's post_entry call can
 * succeed. The agent can NEVER post without this — the runtime refuses.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    const runId = requireString(body, "runId", MAX_ID_CHARS);
    const message = requireString(body, "message", MAX_MESSAGE_CHARS);
    const authorizePostEntryIds = validateAuthorizeIds(body);

    let rt = getSharedRuntime(runId);
    if (!rt) {
      // Process restarted mid-run: rebuild the runtime from the run record.
      // (Open-record telemetry accumulated before the restart is lost; the
      // event log survives and scoring still works. Documented v1 limitation.)
      const eventLog0 = new EventLog();
      const run = eventLog0.all().runs.find((r) => r.id === runId);
      if (!run) return NextResponse.json({ error: `unknown run ${runId}` }, { status: 404 });
      const { ScenarioRuntime } = await import("@/delegate/src/runtime/state");
      const { globalRegistry } = await import("@/delegate/src/runtime/registry");
      rt = new ScenarioRuntime(run.scenarioId as never);
      globalRegistry.set(runId, rt);
    }

    const eventLog = new EventLog();
    // Completion guard: a submitted run's transcript is the scored artifact —
    // late messages (UI is blocked, but the API is not) would pollute the
    // evidence trail the debrief and rubric rewrite read. The UI already
    // disables the input after submit; this enforces it server-side.
    if (eventLog.all().runs.find((r) => r.id === runId)?.submittedAt) {
      return NextResponse.json({ error: "already submitted: this scenario is complete" }, { status: 409 });
    }
    if (authorizePostEntryIds?.length) {
      for (const id of authorizePostEntryIds) {
        rt.authorizePost(id);
        eventLog.log(runId, "post_authorized", "participant", { entryId: id });
      }
    }
    eventLog.log(runId, "prompt_sent", "participant", { text: message, authorizedPost: authorizePostEntryIds?.length ?? 0 });

    const provider = makeProvider(process.env.DELEGATE_AGENT ?? "auto");
    const history = await loadHistory(runId);

    const turn = await provider.runTurn(
      message,
      history,
      (tool, args) => {
        const out = rt.executeTool(tool, args);
        const status =
          tool === "post_entry" && out && typeof out === "object"
            ? String((out as { status?: string }).status ?? "ok")
            : "ok";
        eventLog.log(runId, "tool_call", "agent", { tool, args, status });
        return out;
      },
      // The scenario gate IS the tool list the model sees — availability is
      // data, and the runtime is the single source of that data.
      { tools: rt.availableToolNames(), budget: DEFAULT_BUDGET },
    );

    for (const open of turn.recordOpens) {
      rt.openRecord(open.type as never, open.id, "agent");
      eventLog.log(runId, "record_opened", "agent", { type: open.type, id: open.id });
    }
    eventLog.log(runId, "agent_response", "agent", { text: turn.reply });
    eventLog.log(runId, "agent_usage", "agent", {
      provider: provider.name,
      model: process.env.DELEGATE_MODEL ?? "claude-sonnet-4-5",
      modelCalls: turn.usage.modelCalls,
      outputTokens: turn.usage.outputTokens,
      elapsedMs: turn.usage.elapsedMs,
      budgetExceeded: turn.usage.budgetExceeded,
    });
    if (turn.usage.budgetExceeded) {
      eventLog.log(runId, "budget_exceeded", "agent", {
        modelCalls: turn.usage.modelCalls,
        outputTokens: turn.usage.outputTokens,
        elapsedMs: turn.usage.elapsedMs,
      });
    }

    return NextResponse.json({
      reply: turn.reply,
      toolCalls: turn.toolCalls,
      ts: new Date().toISOString(),
      provider: provider.name,
      usage: turn.usage,
    });
  } catch (err) {
    const { status, body: errBody } = errorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}

// History: rebuild prior turns from the event log (prompt_sent/agent_response pairs).
import { readThreadFromEvents } from "@/delegate/src/runtime/history";
async function loadHistory(runId: string) {
  return readThreadFromEvents(runId);
}
