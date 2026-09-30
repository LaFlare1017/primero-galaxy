import { NextResponse } from "next/server";
import { resolveRuntime } from "@/delegate/src/runtime/registry";
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
 * The turn is agentic — several model hops with gated tools — so it is a long
 * request by nature. This is the Hobby plan's ceiling, which is the one number
 * that is safe on every plan: a higher value is a deploy-time error on the plans
 * that do not allow it, and the per-turn budget guard (`DEFAULT_BUDGET` in the
 * agent) is the limit that actually applies. Set here rather than left implicit
 * because the default is 10s, and 10s of a multi-hop turn is a 504.
 */
export const maxDuration = 60;

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
  // Hoisted for the finally: a turn that trips the budget guard, or fails
  // halfway through its tool loop, has still sent a prompt and made tool
  // calls — and the scorers read those events, so losing them would score a
  // participant for work the log says they did not do.
  let eventLog: EventLog | null = null;
  try {
    const body = await readJsonBody(req);
    const runId = requireString(body, "runId", MAX_ID_CHARS);
    const message = requireString(body, "message", MAX_MESSAGE_CHARS);
    const authorizePostEntryIds = validateAuthorizeIds(body);

    // One log for the whole turn: the run row that decides whether this process
    // has seen the run before, and the events the turn is about to add. Opening
    // a second one to answer a lookup question is a second read of the same
    // table, and on Postgres a second round trip.
    eventLog = await EventLog.open();
    // Resolves from this process's map, or rebuilds from the run row — which is
    // what a cold invocation gets, and is the normal case on a deployment where
    // this request and the participant's last one are different processes.
    const rt = resolveRuntime(runId, eventLog);
    if (!rt) return NextResponse.json({ error: `unknown run ${runId}` }, { status: 404 });
    // A local alias, because the tool callback below closes over it and the
    // hoisted `eventLog` is nullable until this line — a closure that could
    // see null would be a log that silently dropped a tool call.
    const log = eventLog;
    // Completion guard: a submitted run's transcript is the scored artifact —
    // late messages (UI is blocked, but the API is not) would pollute the
    // evidence trail the debrief and rubric rewrite read. The UI already
    // disables the input after submit; this enforces it server-side.
    if (log.all().runs.find((r) => r.id === runId)?.submittedAt) {
      return NextResponse.json({ error: "already submitted: this scenario is complete" }, { status: 409 });
    }
    if (authorizePostEntryIds?.length) {
      for (const id of authorizePostEntryIds) {
        rt.authorizePost(id);
        log.log(runId, "post_authorized", "participant", { entryId: id });
      }
    }
    log.log(runId, "prompt_sent", "participant", { text: message, authorizedPost: authorizePostEntryIds?.length ?? 0 });

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
        log.log(runId, "tool_call", "agent", { tool, args, status });
        return out;
      },
      // The scenario gate IS the tool list the model sees — availability is
      // data, and the runtime is the single source of that data.
      { tools: rt.availableToolNames(), budget: DEFAULT_BUDGET },
    );

    for (const open of turn.recordOpens) {
      rt.openRecord(open.type as never, open.id, "agent");
      log.log(runId, "record_opened", "agent", { type: open.type, id: open.id });
    }
    log.log(runId, "agent_response", "agent", { text: turn.reply });
    log.log(runId, "agent_usage", "agent", {
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
  } finally {
    await eventLog?.flush();
  }
}

// History: rebuild prior turns from the event log (prompt_sent/agent_response pairs).
import { readThreadFromEvents } from "@/delegate/src/runtime/history";
async function loadHistory(runId: string) {
  return readThreadFromEvents(runId);
}
