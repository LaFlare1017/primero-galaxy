/**
 * Rebuild agent chat history from the event log so multi-turn conversations
 * carry context. Alternating prompt_sent / agent_response events become
 * ChatMessage[]; the current user message is appended by the caller.
 */

import { EventLog } from "./events";
import type { ChatMessage } from "./agent";

export function readThreadFromEvents(runId: string): ChatMessage[] {
  const log = new EventLog();
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
