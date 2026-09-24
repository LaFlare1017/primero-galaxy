/**
 * Score persistence: single writer for scores.json, used by both the submit
 * route and the smoke tests (so cohort data is complete wherever scoring
 * runs).
 */

import { writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { dataDir } from "../paths";
import type { Score } from "../scoring/scorers";

export function persistScores(scores: Score[]): void {
  const dir = dataDir();
  const p = join(dir, "scores.json");
  // Merge-on-write: concurrent submits (two participants finishing at once)
  // each hold their own snapshot of scores.json; a plain read-modify-write
  // would silently DROP the other submit's rows. Re-read at write time and
  // merge by (runId, dimension) — the natural unique key, since a run is
  // scored exactly once per dimension (enforced by the submit route's
  // idempotency guard). Same read→merge→write atomicity contract as the
  // event log.
  const existing = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Array<Score & { ts?: string }>) : [];
  const byKey = new Map<string, Score & { ts?: string }>();
  for (const row of existing) byKey.set(`${row.runId}:${row.dimension}`, row);
  for (const s of scores) byKey.set(`${s.runId}:${s.dimension}`, { ...s, ts: new Date().toISOString() });
  writeFileSync(p, JSON.stringify([...byKey.values()], null, 2));
}
