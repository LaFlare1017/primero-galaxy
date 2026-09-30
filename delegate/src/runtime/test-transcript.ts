/**
 * The transcript gate: what a rebuilt conversation attributes to a turn.
 *
 * The participant's restored thread and the facilitator's watch pane are both
 * rebuilt from the event log, and both draw each turn's tool calls as a window
 * of events between the prompt that started the turn and the turn's own
 * response. This file is about where that window's edges are drawn, because
 * getting them wrong costs evidence without ever looking like an error.
 *
 * The bug it exists for: the window used to be drawn on `ts`, which has
 * millisecond resolution. A turn routinely logs its prompt and its tool calls
 * inside the same millisecond — the event log from a real run of this suite
 * holds `prompt_sent 17:40:12.219`, `tool_call 17:40:12.219`,
 * `tool_call 17:40:12.224`, `agent_response 17:40:12.224` — so the `>` bound
 * landed exactly on the first tool call's timestamp and excluded it, while the
 * `<=` bound cut the second because the response shared the prompt's
 * millisecond. The transcript then rendered the reply with no tool calls at
 * all, and which side of the boundary an event fell on changed from run to run
 * with nothing about the code changing. That is what a Playwright timeout with
 * a moving set of failures looks like from the inside.
 *
 * The window is drawn on event IDS now, which the append-only log actually
 * orders by, and it is scoped to one run. Both are cheap; the reason to pin
 * them is that neither is load-bearing on its face — a reader would happily
 * swap the bound back to `ts` and see no reason not to.
 *
 * Pure functions over planted rows, so this runs in the hermetic `delegate`
 * CI job on Linux as well as on a laptop. Wired into `npm test`.
 */

import { threadFromEvents, toolCallsForTurn } from "./history";
import type { DelegateEvent, EventType, EventActor } from "./events";
import { ignoreClosedPipe } from "../print";

ignoreClosedPipe();

let failures = 0;
function check(name: string, passed: boolean, detail: string): void {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!passed) failures += 1;
}

let seq = 0;
/** An event row, with a timestamp the caller controls — the whole point. */
function ev(
  runId: string,
  type: EventType,
  ts: string,
  payload: Record<string, unknown> = {},
  actor: EventActor = "agent",
): DelegateEvent {
  seq += 1;
  return { id: seq, runId, type, actor, ts, payload };
}

/** A two-call turn whose prompt, first call and response share milliseconds. */
function collidingTurn(runId: string, at: string): DelegateEvent[] {
  const nextMs = new Date(Date.parse(at) + 1).toISOString();
  return [
    ev(runId, "prompt_sent", at, { text: "Please reconcile the bank account." }, "participant"),
    ev(runId, "tool_call", at, { tool: "get_bank_feed", args: { id: "BK-1" } }),
    ev(runId, "tool_call", nextMs, { tool: "query_gl", args: { account: "cash" } }),
    ev(runId, "agent_response", at, { text: "I reconciled the March operating account." }),
  ];
}

/** The window a rebuilt transcript draws around the assistant message at `index`. */
function windowFor(events: DelegateEvent[], runId: string, index: number) {
  const thread = threadFromEvents(
    events.filter((e) => e.runId === runId),
    runId,
  );
  const message = thread[index];
  const lower = index > 0 ? (thread[index - 1].eventId ?? 0) : 0;
  return { calls: toolCallsForTurn(events, runId, lower, message?.eventId ?? Number.MAX_SAFE_INTEGER), thread };
}

function main(): number {
  const at = "2026-09-30T17:40:12.219Z";

  // 1. The control: a turn whose events are comfortably spread apart.
  const spread = [
    ev("run-a", "prompt_sent", at, { text: "go" }, "participant"),
    ev("run-a", "tool_call", "2026-09-30T17:40:12.219Z", { tool: "get_bank_feed" }),
    ev("run-a", "tool_call", "2026-09-30T17:40:13.004Z", { tool: "query_gl" }),
    ev("run-a", "agent_response", "2026-09-30T17:40:13.311Z", { text: "done" }),
  ];
  const ok = windowFor(spread, "run-a", 1);
  check(
    "a turn with distinct timestamps attributes both of its tool calls",
    ok.calls.length === 2,
    `${ok.calls.length} call(s): ${JSON.stringify(ok.calls.map((c) => c.tool))}`,
  );

  // 2. The regression: prompt and first tool call inside the SAME millisecond.
  //    A `ts` window drops that call; an id window cannot.
  const collided = collidingTurn("run-b", at);
  const sameMs = collided.filter((e) => e.ts === at).length;
  const hit = windowFor(collided, "run-b", 1);
  check(
    "a tool call in the same millisecond as its prompt is still the turn's",
    sameMs >= 3 && hit.calls.length === 2,
    `${sameMs} events share ${at}, ${hit.calls.length} call(s) attributed: ${JSON.stringify(hit.calls.map((c) => c.tool))}`,
  );

  // 3. The old bound, run against the same rows, must LOSE them — so this file
  //    asserts the wrong answer too, and cannot be satisfied by any bound that
  //    drops calls. It loses BOTH: the first call sits on the prompt's
  //    timestamp and the `>` bound excludes it, and the response shares the
  //    prompt's millisecond so the `<=` bound cuts the second. The UI then
  //    rendered the reply with no tool-call summary at all, which is the
  //    `element(s) not found` a watch-pane spec reports as a timeout.
  const byTs = (() => {
    const thread = threadFromEvents(collided, "run-b");
    const message = thread[1];
    const lower = thread[0]?.ts ?? "";
    return collided.filter((e) => e.type === "tool_call" && e.ts <= message.ts && (!lower || e.ts > lower)).length;
  })();
  check(
    "…and the timestamp window it replaced loses every call, which is the bug",
    byTs === 0 && hit.calls.length === 2,
    `ts window attributes ${byTs}, id window ${hit.calls.length} — the difference this gate exists for`,
  );

  // 4. The window stops at its own turn.
  const two = [...collidingTurn("run-c", at)];
  const second = collidingTurn("run-c", "2026-09-30T17:41:00.500Z");
  for (const e of second) seq = Math.max(seq, e.id);
  const firstOnly = windowFor([...two, ...second], "run-c", 1);
  check(
    "a later turn's tool calls are not added to the first turn's",
    firstOnly.calls.length === 2,
    `${firstOnly.calls.length} call(s) on turn one`,
  );

  // 5. Scoped to the run: the events table holds every run's rows.
  const mixed = [...collidingTurn("run-d", at), ...collidingTurn("run-e", at)];
  const scoped = windowFor(mixed, "run-d", 1);
  check(
    "another run's tool calls never land in this run's transcript",
    scoped.calls.length === 2 && scoped.calls.every((c) => c.tool.length > 0),
    `${scoped.calls.length} call(s): ${JSON.stringify(scoped.calls.map((c) => c.tool))}`,
  );

  // 6. No tool calls is an empty list, not a missing field's worth of noise.
  const bare = [ev("run-f", "prompt_sent", at, { text: "go" }, "participant"), ev("run-f", "agent_response", at, { text: "hi" })];
  check(
    "a turn that called no tools attributes none",
    windowFor(bare, "run-f", 1).calls.length === 0,
    "0 calls, and the message still renders",
  );

  console.log(failures === 0 ? "\nall transcript checks passed" : `\n${failures} transcript check(s) FAILED`);
  return failures === 0 ? 0 : 1;
}

try {
  process.exit(main());
} catch (err) {
  console.error("transcript gate threw:", err);
  process.exit(1);
}
