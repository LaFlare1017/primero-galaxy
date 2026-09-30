/**
 * Run→runtime lookup, with a rebuild path.
 *
 * The cache is per-process because on a laptop the process IS the workshop: one
 * `next dev`, one map, and every route hits the same `ScenarioRuntime` for a
 * given run. That assumption is what a deployment takes away — on Vercel each
 * request is very likely a different invocation, so "the runtime I built during
 * that participant's chat turn" is a thing this process has usually never
 * heard of, and a lookup that answered 404 for a run that demonstrably exists
 * would break the workshop in the two places it hurts most: the viewer's next
 * click, and the submit that produces the score.
 *
 * So the map is a CACHE and the run row is the truth. `resolveRuntime` rebuilds
 * from the run's `scenarioId` when this process has nothing, which is exact
 * rather than approximate:
 *   - the tool gate and the ledger are derived from the scenario id, and the
 *     ledger is the shared deterministic one, so a rebuilt runtime gates and
 *     reads identically to the original;
 *   - the only per-run arrays (`openRecords`, `toolCalls`, `proposedEntries`)
 *     start empty — and the one place scoring reads them,
 *     `hasOpenedRecord` in the s6 behavioural ground truth, is already an `||`
 *     over the event log, which survives a restart by construction. A cold
 *     rebuild therefore cannot change a score.
 *
 * The registry still holds what it is given, so on a single machine the two
 * requests of a turn keep sharing one instance and the accumulation behaviour
 * the v1 comment described is unchanged.
 */

import { ScenarioRuntime, type ScenarioId } from "./state";
import type { EventLog } from "./events";

const globalForRegistry = globalThis as unknown as { __delegateRegistry?: Map<string, ScenarioRuntime> };
export const globalRegistry: Map<string, ScenarioRuntime> =
  globalForRegistry.__delegateRegistry ?? (globalForRegistry.__delegateRegistry = new Map());

export function getSharedRuntime(runId: string): ScenarioRuntime | undefined {
  return globalRegistry.get(runId);
}

/**
 * The runtime for a run, from this process's map or rebuilt from the store.
 *
 * `undefined` means the run is not in the log either — a genuine unknown id,
 * which callers answer with 404. It never means "not in memory", because that
 * answer is the bug this function exists to remove.
 */
export function resolveRuntime(runId: string, log: Pick<EventLog, "all">): ScenarioRuntime | undefined {
  const cached = globalRegistry.get(runId);
  if (cached) return cached;
  const run = log.all().runs.find((r) => r.id === runId);
  if (!run) return undefined;
  const rebuilt = new ScenarioRuntime(run.scenarioId as ScenarioId);
  globalRegistry.set(runId, rebuilt);
  return rebuilt;
}
