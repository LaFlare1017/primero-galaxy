/**
 * Per-process run→runtime registry so chat/submit route invocations hit the
 * same ScenarioRuntime instance (open-record telemetry accumulates per run).
 * v1 single-machine tool: in-memory is correct; documented limitation is
 * that a server restart mid-scenario orphans the runtime (event log survives;
 * scoring still works from events for s1–s4, and s5/s6 behavioral events
 * survive too).
 */

import type { ScenarioRuntime } from "./state";

const globalForRegistry = globalThis as unknown as { __delegateRegistry?: Map<string, ScenarioRuntime> };
export const globalRegistry: Map<string, ScenarioRuntime> =
  globalForRegistry.__delegateRegistry ?? (globalForRegistry.__delegateRegistry = new Map());

export function getSharedRuntime(runId: string): ScenarioRuntime | undefined {
  return globalRegistry.get(runId);
}
