/**
 * Rebuild agent chat history from the event log so multi-turn conversations
 * carry context. Alternating prompt_sent / agent_response events become
 * ChatMessage[]; the current user message is appended by the caller.
 *
 * `threadFromEvents` is the pure form, over rows the caller already holds, and
 * it exists because of a race the two call sites could otherwise not see. Both
 * the chat route and the state route were reading the event log TWICE per
 * request: once through their own `EventLog.open()` and once more inside here,
 * each read landing at a different moment. A request that straddles a flush
 * then builds its transcript from the newer read and filters its tool calls
 * against the older one — so the participant sees the reply with its tool calls
 * silently missing, which is the pane's "2 tool calls" summary never rendering.
 * One snapshot cannot disagree with itself, so both call sites pass the log
 * they opened and neither reads the store twice.
 *
 * Each message also carries the ID of the event it was rebuilt from, and that
 * is not bookkeeping. `ts` has millisecond resolution and several events in a
 * turn routinely land inside the same millisecond, so a window drawn on
 * timestamps puts a boundary through the middle of a turn's tool calls — the
 * transcript then renders the reply with the first tool call missing, and which
 * side of the boundary a given event falls on changes from run to run with
 * nothing about the code changing. Ids are what the append-only log actually
 * orders by, so the same window drawn on ids is exact.
 */

import { EventLog, type DelegateEvent } from "./events";
import type { ChatMessage } from "./agent";
import type { Store } from "../store/store";

/** The transcript of one run, from event rows the caller has already read. */
export function threadFromEvents(events: DelegateEvent[], runId: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const e of events) {
    if (e.type === "prompt_sent") {
      messages.push({ role: "user", content: String(e.payload.text ?? ""), ts: e.ts, eventId: e.id });
    } else if (e.type === "agent_response") {
      messages.push({ role: "assistant", content: String(e.payload.text ?? ""), ts: e.ts, eventId: e.id });
    }
  }
  // Drop the trailing prompt_sent — the caller sends it as the new message.
  if (messages.length > 0 && messages[messages.length - 1]?.role === "user") {
    messages.pop();
  }
  return messages;
}

/**
 * The tool calls one turn made: the `tool_call` events between the message
 * before it and its own event.
 *
 * The bound is drawn on event IDS. `ts` is millisecond-resolution and a turn
 * routinely logs its prompt and a tool call inside the same millisecond, so a
 * timestamp window puts its lower bound exactly on a tool call and drops it —
 * the transcript then renders the reply with one call where the agent made
 * two, on some runs and not others, which is a bug whose cause is where the
 * clock happened to tick. Ids are what the append-only log orders by.
 *
 * Scoped to one run, because the events table holds every run's rows and the
 * previous timestamp form compared them all against one run's window.
 */
export function toolCallsForTurn(
  events: DelegateEvent[],
  runId: string,
  lowerId: number,
  upperId: number,
): Array<{ tool: string; args?: Record<string, unknown>; summary?: string }> {
  return events
    .filter((e) => e.runId === runId && e.type === "tool_call" && e.id > lowerId && e.id <= upperId)
    .map((e) => ({
      tool: String(e.payload.tool ?? ""),
      args: e.payload.args as Record<string, unknown> | undefined,
      summary: typeof e.payload.summary === "string" ? e.payload.summary : undefined,
    }));
}

/**
 * Whether the agent still owes this run a turn, read off the LAST event in
 * append order.
 *
 * Lives here rather than in the facilitator route because it is the same
 * question `toolCallsForTurn` answers — "which events belong to this turn?" —
 * and it had the same answer for a while: lastness by `ts`. `ts` has
 * millisecond resolution and a fast turn logs its prompt, its tool calls and
 * its response inside one millisecond. A strict `e.ts > last.ts` therefore
 * keeps the FIRST of the tied events, so a turn that finished reads as
 * `prompt_sent` and the facilitator's grid reports a participant whose agent
 * already answered as still working.
 *
 * Ids are what the append-only log orders by, and `events` arrives in id order,
 * so the last matching event in the array IS the last one written.
 *
 * The staleness question inside is a real wall-clock one — how long since the
 * agent last did anything — so that stays on `ts`, which is what it should be.
 */
const AGENT_TURN_EVENTS = new Set(["prompt_sent", "agent_response", "tool_call"]);

/** A turn older than this is stalled, not working: the budget guard caps 120s. */
export const AGENT_STALE_AFTER_MS = 130_000;

export function agentWorkingForRun(
  events: Array<{ id: number; runId: string; ts: string; type: string }>,
  runId: string,
): boolean {
  let last: { ts: string; type: string } | undefined;
  for (const e of events) {
    if (e.runId !== runId) continue;
    if (AGENT_TURN_EVENTS.has(e.type)) last = e;
  }
  if (!last) return false;
  if (last.type === "prompt_sent") return true;
  if (last.type === "tool_call") return Date.now() - new Date(last.ts).getTime() < AGENT_STALE_AFTER_MS;
  return false;
}

/**
 * Open a log and read the thread from it.
 *
 * Async since the log is: reading the store is a round trip, and this opens its
 * own log rather than being handed the caller's — a chat turn's history is
 * read before the turn is logged, so sharing would only hide a read behind a
 * write. Callers that HAVE a log should pass `log.eventsForRun(runId)` to
 * `threadFromEvents` instead; this is for the ones that do not.
 */
export async function readThreadFromEvents(runId: string, store?: Store): Promise<ChatMessage[]> {
  const log = await EventLog.open(store);
  return threadFromEvents(log.eventsForRun(runId), runId);
}
