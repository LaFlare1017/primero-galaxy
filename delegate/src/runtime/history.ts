/**
 * Rebuild agent chat history from the event log so multi-turn conversations
 * carry context. Alternating prompt_sent / agent_response events become
 * ChatMessage[]; the current user message is appended by the caller.
 *
 * Async since the log is: reading the store is a round trip, and this opens its
 * own log rather than being handed the caller's — a chat turn's history is
 * read before the turn is logged, so sharing would only hide a read behind a
 * write. The store is a parameter anyway, which is how the tests give it one.
 */

import { EventLog } from "./events";
import type { ChatMessage } from "./agent";
import type { Store } from "../store/store";

export async function readThreadFromEvents(runId: string, store?: Store): Promise<ChatMessage[]> {
  const log = await EventLog.open(store);
  const events = log.eventsForRun(runId);
  const messages: ChatMessage[] = [];
  for (const e of events) {
    if (e.type === "prompt_sent") {
      messages.push({ role: "user", content: String(e.payload.text ?? ""), ts: e.ts });
    } else if (e.type === "agent_response") {
      messages.push({ role: "assistant", content: String(e.payload.text ?? ""), ts: e.ts });
    }
  }
  // Drop the trailing prompt_sent — the caller sends it as the new message.
  if (messages.length > 0 && messages[messages.length - 1]?.role === "user") {
    messages.pop();
  }
  return messages;
}
