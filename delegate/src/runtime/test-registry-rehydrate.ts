/**
 * The cold-process gate: a runtime that is not in memory.
 *
 * The store work made a deployment possible, and a deployment is the one place
 * where "the runtime for this run" is routinely absent from the process handling
 * the request. This suite plants exactly that state — a run recorded in the
 * store, an EMPTY registry — and then asks the questions the routes ask:
 *
 *   1. Can a process that has never seen the run resolve its runtime at all?
 *   2. Is the rebuilt runtime the same runtime, for the things a request does?
 *      (gates the same tools, reads the same ledger, returns the same rows)
 *   3. Can a rebuild WIDEN access — the tool gate is rebuilt from the scenario
 *      id, so a run's tools must still be exactly its scenario's tools. This is
 *      the check that matters most: it is the difference between "a lost cache"
 *      and "a lost authorization".
 *   4. Does an id that is not in the log still refuse? The rebuild must not
 *      turn a 404 into a fresh runtime with guessed tools.
 *   5. Is the resolved instance cached, so the single-machine behaviour that
 *      predates the store is unchanged where it can still hold?
 *   6. Does scoring still see what the participant looked at? The rebuilt
 *      runtime's own `openRecords` is empty by construction, so the s6
 *      behavioural ground truth depends on the event-log leg of its `||` — that
 *      leg is what this plants, because it is the one that survives a restart.
 *
 * The registry is emptied by deleting the map's entries, which is exactly what a
 * fresh invocation has and the closest a test can get to it without a process.
 * Wired into `npm test`.
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { EventLog } from "./events";
import { globalRegistry, resolveRuntime } from "./registry";
import { ScenarioRuntime } from "./state";
import { ignoreClosedPipe } from "../print";
import { fileStore } from "../store/file-store";
import type { Store } from "../store/store";

// A reader who pipes this to `head` must not kill the run before it cleans up.
ignoreClosedPipe();

let failures = 0;
function check(name: string, passed: boolean, detail: string): void {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!passed) failures += 1;
}

/** The state a cold invocation is in: the run is in the store, memory is not. */
async function plantRun(store: Store, scenarioId: "s5" | "s6"): Promise<{ runId: string; store: Store }> {
  const log = await EventLog.open(store);
  const session = log.startSession("P-cold", "cohort-registry-gate");
  const run = log.startRun(session.id, scenarioId);
  log.log(run.id, "prompt_sent", "participant", { text: "start" });
  await log.flush();
  globalRegistry.clear(); // the part a new machine does not have
  return { runId: run.id, store };
}

async function main(): Promise<number> {
  const root = mkdtempSync(join(tmpdir(), "delegate-registry-gate-"));
  const saved = process.env.DELEGATE_DATA_DIR;
  process.env.DELEGATE_DATA_DIR = join(root, "data");
  try {
    // 1. A cold process resolves the run at all.
    const planted = await plantRun(fileStore(), "s5");
    const log = await EventLog.open(planted.store);
    const cold = resolveRuntime(planted.runId, log);
    check(
      "a process with no runtime in memory still resolves the run",
      cold !== undefined,
      cold ? `rebuilt as ${cold.scenarioId}` : "resolveRuntime returned nothing",
    );
    if (!cold) return 1;

    // 2. The rebuild reads the same ledger and gates the same tools.
    const original = new ScenarioRuntime("s5");
    const gateMatches =
      JSON.stringify(cold.availableToolNames().sort()) === JSON.stringify(original.availableToolNames().sort());
    check(
      "the rebuilt runtime gates exactly the same tools",
      gateMatches,
      `${cold.availableToolNames().length} tools, same list as a runtime built at the time`,
    );
    const line = cold.ledger.bankLines[0];
    check(
      "the rebuilt runtime reads the same ledger rows",
      JSON.stringify(line) === JSON.stringify(original.ledger.bankLines[0]) && line !== undefined,
      line ? `bank line ${String(line.id)} is byte-identical` : "no bank lines in the ledger",
    );

    // 3. A rebuild cannot widen the gate. `s6` tools on an `s5` run is the
    //    shape of the mistake: build from the run's own scenario, always.
    let refused = "";
    try {
      cold.executeTool("post_entry", { note: "should not be reachable" }, "agent");
    } catch (error) {
      refused = (error as Error).message;
    }
    check(
      "a rebuilt runtime refuses a tool its scenario does not allow",
      refused.includes("not available in scenario s5"),
      refused || "the tool was accepted",
    );

    // 4. An unknown id still refuses, rather than inventing a runtime.
    check(
      "an id with no run row still resolves to nothing",
      resolveRuntime("run-does-not-exist", log) === undefined,
      "undefined, so the route answers 404 exactly as before",
    );

    // 5. The second lookup is the same instance, so one machine keeps the
    //    accumulation behaviour the registry has always had.
    check(
      "the resolved runtime is cached for the next request",
      resolveRuntime(planted.runId, log) === cold,
      "the same instance, not a second rebuild",
    );

    // 6. What a rebuild does NOT have, and what scoring reads instead.
    const six = await plantRun(fileStore(), "s6");
    const sixLog = await EventLog.open(six.store);
    sixLog.log(six.runId, "record_opened", "participant", { type: "accrual", id: "ACC-2026-03-U" });
    await sixLog.flush();

    globalRegistry.clear();
    const rebuilt = resolveRuntime(six.runId, await EventLog.open(six.store));
    const fromRuntime = rebuilt?.hasOpenedRecord(["ACC-2026-03-U", "ACC-2026-03-W", "ACC-2026-03-I"]) ?? true;
    const fromEvents = (await EventLog.open(six.store))
      .all()
      .events.some(
        (e) => e.type === "record_opened" && e.actor === "participant" && String(e.payload.id ?? "").startsWith("ACC-"),
      );
    check(
      "the rebuilt runtime's own record list is empty, as documented",
      fromRuntime === false,
      "openRecords starts empty on a rebuild",
    );
    check(
      "the event-log leg of the s6 ground truth still holds after a rebuild",
      fromEvents,
      "the participant's opens are in the log, which is what `hasOpenedRecord(...) ||` falls back to",
    );
  } finally {
    globalRegistry.clear();
    if (saved === undefined) delete process.env.DELEGATE_DATA_DIR;
    else process.env.DELEGATE_DATA_DIR = saved;
    rmSync(root, { recursive: true, force: true });
  }
  console.log(failures === 0 ? "\nall cold-process checks passed" : `\n${failures} cold-process check(s) FAILED`);
  return failures === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error("cold-process gate threw:", error);
    process.exit(1);
  },
);
