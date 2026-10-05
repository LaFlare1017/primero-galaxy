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
 * The full `--json` is a diagnostic: 72KB for three runs, three quarters of it a
 * per-test timing list and a path to a temp directory that means nothing on the
 * machine reading it. None of that belongs in a file whose whole job is to be
 * read later by something else — the `worker-pin` check, and whoever opens it
 * next. So the committed shape keeps the two counts, the machine, and each run's
 * verdict and per-file times, and drops the rest. The bench writes both shapes
 * from the one object; only which path was asked for decides.
 *
 * Lives here rather than beside the bench for the reason above: the bench runs
 * the suite when it is imported, so nothing can reach into it.
 */
export function committedCurve(measurement) {
  return {
    ...measurement,
    runs: (measurement.runs ?? []).map(({ tests, report, ...rest }) => rest),
  };
}
