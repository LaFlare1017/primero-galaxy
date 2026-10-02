/**
 * Score persistence: one row per (run, dimension), used by both the submit
 * route and the smoke tests (so cohort data is complete wherever scoring runs).
 *
 * Now on the store seam, with the merge-on-write rule it has always had: two
 * participants finishing at once each hold their own snapshot, so a plain
 * write would drop the other's rows. The key is (runId, dimension) — a run is
 * scored exactly once per dimension, enforced by the submit route's
 * idempotency guard — so an upsert replaces a re-score and never collides with
 * a different one.
 */

import type { Row } from "../store/store";
import { byRunAndDimension, openStore, type Store } from "../store/store";
import type { Score } from "../scoring/scorers";

/**
 * Every score row, for the facilitator grid. It used to read `scores.json`
 * straight off the filesystem, which is the second reason the store had to
 * exist rather than only the first: a reader that bypasses the seam is a
 * reader that silently answers "no scores" on a deployment whose scores are
 * somewhere else — and the grid's whole job is to show what a participant was
 * detected for.
 */
export async function readScores(store?: Store): Promise<Array<Score & { ts?: string }>> {
  const backing = store ?? (await openStore());
  return (await backing.read("scores")) as unknown as Array<Score & { ts?: string }>;
}

export async function persistScores(scores: Score[], store?: Store): Promise<void> {
  if (scores.length === 0) return;
  const backing = store ?? (await openStore());
  const existing = (await backing.read("scores")) as unknown as Array<Score & { ts?: string }>;
  const byKey = new Map<string, Score>();
  for (const row of existing) byKey.set(byRunAndDimension(row as unknown as Row), row);
  const stamped = scores.map((s) => ({ ...s, ts: new Date().toISOString() }));
  for (const row of stamped) byKey.set(byRunAndDimension(row as unknown as Row), row);
  // Only the rows this call is about: a full-table write would re-write every
  // other participant's scores on every submit, which is how the file store
  // turned two concurrent submits into a dropped row.
  await backing.upsert("scores", stamped as unknown as Row[], byRunAndDimension);
}
