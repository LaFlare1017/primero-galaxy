/**
 * What CI pins for the E2E suite, and where the measurement of that pin lives.
 *
 * Two callers, and they have to agree exactly: the bench, which reports against
 * the pin, and the doctor check, which compares it against a measured knee. A
 * transcription of the pin is a copy that rots — so both of them read it out of
 * ci.yml, through this one function, rather than each holding their own copy or
 * their own regex.
 *
 * This is a module of its own for a second reason: `e2e-workers-bench.mjs` runs
 * the suite at import time, so nothing can import the pin reader out of it
 * without launching an hour of Playwright. One definition, importable.
 *
 * Everything here takes the repository root rather than assuming one, because
 * the doctor points checks at fixture checkouts and a check that read the real
 * repository's pin would be proving nothing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where a curve measurement is kept, relative to the repository root.
 *
 * Committed on purpose. The doctor can compare the pin against a knee in
 * milliseconds, but only if a measurement survives the run that produced it —
 * an uncommitted measurement would make the check's answer depend on whether
 * the person running the doctor happened to have run the bench first, which is
 * the kind of check that passes on Monday and says nothing on Tuesday.
 *
 * The `E2E worker curve` job writes the runner's measurement to the same shape,
 * so replacing a laptop's curve with the runner's is copying one file.
 */
export const CURVE = 'e2e/worker-curve.json';

/**
 * The count CI runs with, read back out of the workflow, or null if there is
 * none to read.
 *
 * Null rather than a default on purpose: a caller that cannot find the pin has
 * to be able to say the pin is unknown, and a default would let it report a
 * comparison against a number nobody chose.
 */
export function pinnedWorkers(root) {
  const workflow = join(root, '.github', 'workflows', 'ci.yml');
  if (!existsSync(workflow)) return null;
  const match = readFileSync(workflow, 'utf8').match(/E2E_WORKERS:\s*'(\d+)'/);
  return match === null ? null : Number(match[1]);
}
/**
 * What a committed curve keeps, and what it leaves in the run's own report file.
 *
 * The full `--json` is a diagnostic: 72KB for three runs, most of it per-test
 * timing tables and a path to a temp directory that means nothing on the
 * machine reading it. Most of that belongs in the job's artifact, not in a file
 * whose whole job is to be read later by something else — the `worker-pin`
 * check, and whoever opens it next. So the committed shape keeps the two
 * shape keeps: the pinned run's. That is the run the doctor's budget check
 * reads, comparing each committed `test.setTimeout` against what the curve
 * measured for the same test at the count CI actually runs, and without that
 * one table the check has nothing to compare. When a measurement repeats the
 * pinned count (--repeat=2 and up), the table kept is the SLOWER rep's: the
 * budgets were sized from a loaded measurement, so the comparison that matters
 * is the rep the machine struggled with, not the one it breezed through. The
 * other counts' tables stay out — a count CI does not run is not a budget
 * question, and the raw reports keep everything — and the temp path stays out
 * everywhere. When the measurement carries neither a pin nor a knee, no run
 * carries the table, which is the shape the file had before any of it was kept.
 *
 * Lives here rather than beside the bench for the reason above: the bench runs
 * the suite when it is imported, so nothing can reach into it.
 */
export function committedCurve(measurement) {
  const preferred = measurement.pin ?? measurement.knee;
  const candidates = (measurement.runs ?? []).filter((run) => run && run.count === preferred);
  // The rep whose table survives a repeated pinned count. An unreadable rep
  // (no suite time) sorts last, because a table that cannot be read settles
  // nothing; two readable reps sort by suite time, slower first.
  const kept = candidates.reduce((a, b) => ((b.suite ?? 0) > (a.suite ?? 0) ? b : a), candidates[0]);
  return {
    ...measurement,
    runs: (measurement.runs ?? []).map((run) => {
      const { tests, report, count, ...rest } = run;
      return run === kept ? { count, ...rest, tests } : { count, ...rest };
    }),
  };
}
