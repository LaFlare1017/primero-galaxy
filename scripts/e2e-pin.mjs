/**
 * What CI pins for the E2E suite, the measurement that pin is checked against,
 * and the vocabulary every reader of that measurement shares.
 *
 * The callers are three, and they have to agree exactly: the bench, which
 * writes a measurement; curve-pr, which decides whether a measurement is worth
 * a pull request; and the doctor check, which compares the committed knee
 * against the pin. A transcription of any of these in a second place is a copy
 * that rots — so the pin is read out of ci.yml here, the suite's content is
 * hashed here, and "two measurements say the same thing" is decided here,
 * rather than each caller holding its own regex, its own walk, or its own
 * notion of sameness.
 *
 * This is a module of its own for a second reason: `e2e-workers-bench.mjs`
 * runs the suite at import time, so nothing can import the pin reader or the
 * curve helpers out of it without launching an hour of Playwright. One
 * definition, importable, and testable without running anything.
 *
 * Everything here takes the repository root rather than assuming one, because
 * the doctor points checks at fixture checkouts and a check that read the real
 * repository's pin would be proving nothing.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
 * The suite's content, hashed.
 *
 * A measurement is of a suite, and "the same suite" is a question about
 * content, not about commits: a commit that only moves a comment changes
 * nothing the bench measured, while a suite edit can land without any
 * timestamp being able to vouch for it. So the bench stamps every measurement
 * with the hash of the content it measured — every `.ts` file under `e2e/`,
 * the Playwright config, and the workflow that carries the pin — and every
 * reader compares hashes instead of guessing from dates. The workflow is in
 * the hash because a pin edit changes what a measurement is evidence about,
 * and freshness should move with it.
 *
 * Content-addressed and walked in a stable order, so the same files hash the
 * same on the runner, on a laptop, and in a fixture. Null when there is no
 * `e2e/` directory: a checkout without a suite has nothing to hash, and a null
 * that means "nothing" must not be mistaken for a hash that means "anything".
 */
export function suiteHash(root) {
  const e2e = join(root, 'e2e');
  if (!existsSync(e2e)) return null;
  const parts = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = rel === null ? entry.name : `${rel}/${entry.name}`;
      const child = join(dir, entry.name);
      if (entry.isDirectory()) walk(child, name);
      else if (entry.isFile() && entry.name.endsWith('.ts')) {
        try {
          parts.push([name, readFileSync(child)]);
        } catch {
          // A file that vanished between the listing and the read is gone;
          // hashing the rest is the honest read of a moving checkout.
        }
      }
    }
  };
  walk(e2e, null);
  for (const [rel, path] of [
    ['playwright.config.ts', join(root, 'playwright.config.ts')],
    ['.github/workflows/ci.yml', join(root, '.github', 'workflows', 'ci.yml')],
  ]) {
    try {
      parts.push([rel, readFileSync(path)]);
    } catch {
      // Absent is absent; the hash covers what the checkout has.
    }
  }
  if (parts.length === 0) return null;
  parts.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const hash = createHash('sha256');
  for (const [name, bytes] of parts) hash.update(`${name}\0`).update(bytes).update('\0');
  return hash.digest('hex');
}

/**
 * The best suite time each count managed in one measurement, over that
 * measurement's green runs only.
 *
 * A run is green the way the bench's own table means it: it ran, its report
 * was readable, nothing failed, and nothing timed out — a count that timed out
 * is a failing count, and a failing run's time measures a different thing. The
 * best of a count's repeats is the run the machine managed at its quietest,
 * which is the number the era accumulates: one run is a sample, and the floor
 * of several is the closest a hosted runner comes to a fact about the suite.
 */
export function bestFromRuns(runs) {
  const best = {};
  if (!Array.isArray(runs)) return best;
  for (const run of runs) {
    if (run === null || typeof run !== 'object') continue;
    if (run.readable !== true || !Number.isFinite(run.suite)) continue;
    if (run.exit !== 0 || (run.unexpected ?? 0) !== 0) continue;
    if (Array.isArray(run.timeouts) && run.timeouts.length > 0) continue;
    const count = Number(run.count);
    if (!Number.isInteger(count) || count < 1) continue;
    const key = String(count);
    if (!(key in best) || run.suite < best[key]) best[key] = run.suite;
  }
  return best;
}

/**
 * The era's best times: this run's bests merged into the committed curve's,
 * or this run's alone when the two are not of the same era.
 *
 * Two measurements belong to the same era when both were taken on the runner
 * and the committed one carries the hash of the suite this run measured — same
 * content, so every time in it is still evidence about this suite. Anything
 * else (a laptop's curve, a committed curve from before the bench stamped
 * hashes, a suite that changed underneath) means the old bests say nothing
 * about what was just measured, and carrying them forward would be
 * accumulating evidence about a suite that no longer exists.
 *
 * Corrupt or non-numeric entries in the committed bests are dropped rather
 * than trusted: a floor is a number, and a string in the map is a typo, not a
 * time.
 */
export function mergeBest(existing, { hosted, suiteHash, best }) {
  const fresh = { ...best };
  const sameEra =
    existing !== null &&
    typeof existing === 'object' &&
    existing.hosted === hosted &&
    typeof existing.suiteHash === 'string' &&
    existing.suiteHash === suiteHash &&
    existing.best !== null &&
    typeof existing.best === 'object';
  if (!sameEra) return { best: fresh, merged: false };
  const merged = {};
  for (const [count, ms] of Object.entries(existing.best)) {
    const number = Number(count);
    if (Number.isInteger(number) && number >= 1 && Number.isFinite(ms)) merged[count] = ms;
  }
  for (const [count, ms] of Object.entries(fresh)) {
    const kept = merged[count];
    if (!Number.isFinite(kept) || ms < kept) merged[count] = ms;
  }
  return { best: merged, merged: true };
}

/**
 * The fastest green count and the knee, read from a map of best times.
 *
 * The same rule the bench applies to one run's rows — the fastest green count,
 * and the cheapest count within `within` of it — applied to the era's
 * accumulated bests, so the verdict a pin is checked against comes from the
 * floor of every green run of this suite, not from whichever run happened to
 * run last. Counts with no best (never green in this era) are not candidates,
 * which is the same treatment a failing count gets in a single run.
 */
export function kneeFromBest(best, within) {
  const counts = Object.keys(best)
    .map(Number)
    .filter((count) => Number.isInteger(count) && count >= 1)
    .sort((a, b) => a - b);
  if (counts.length === 0) return { fastest: null, knee: null };
  const fastestCount = counts.reduce((a, b) => (best[String(b)] < best[String(a)] ? b : a));
  const fastestMs = best[String(fastestCount)];
  const kneeCount = counts.find((count) => best[String(count)] <= fastestMs * (1 + within));
  return { fastest: { count: fastestCount, suite: fastestMs }, knee: { count: kneeCount, suite: best[String(kneeCount)] } };
}

/**
 * Whether two era-best maps record the same floors.
 *
 * Exact float equality on purpose, not an epsilon: a floor in a committed curve
 * is a stored minimum, not a computed one, and an unchanged floor survives the
 * JSON round-trip as the very same double — while a floor that moved is the
 * finding, and an epsilon loose enough to swallow it would be tuned to hide
 * exactly what this comparison exists to catch. One-sided maps and non-object
 * maps are a refusal rather than a mismatch: a measurement that cannot prove
 * what its times are is not proven the same by anything.
 */
function sameBests(left, right) {
  if (left === null || typeof left !== 'object' || right === null || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!(key in right)) return false;
    if (!Number.isFinite(left[key]) || !Number.isFinite(right[key])) return false;
    if (left[key] !== right[key]) return false;
  }
  return true;
}

/**
 * Whether two measurements say the same thing — the question that decides
 * whether a re-measurement is worth a pull request.
 *
 * Same knee, same pin, same machine class, (when both carry the stamp) the
 * same suite content, and (when both carry the era) the same best times. The
 * times are the part a knee-equal comparison would otherwise hide: a run whose
 * floor moved is a finding even when the ordering — and so the knee — did not,
 * and the bench's merged bests differ from main's exactly when this run
 * improved one. The recordedAt is deliberately NOT compared: a newer timestamp
 * for an unchanged suite is the normal, healthy outcome of a re-measure, and
 * treating it as a difference is what opened a pull request on every push.
 *
 * A committed curve from before the stamp or the era existed cannot prove
 * content-equality or time-equality, so it falls back to the old
 * near-identical-timestamp comparison — which means the first measurement
 * after this lands opens one pull request, establishes both, and every
 * re-measure that changed nothing the file records skips.
 */
export function sameMeasurement(left, right) {
  if (left === null || right === null) return false;
  if (left.knee !== right.knee) return false;
  if (left.hosted !== right.hosted) return false;
  if (left.pin !== right.pin) return false;
  const stamped = left.suiteHash !== undefined || right.suiteHash !== undefined;
  if (stamped && left.suiteHash !== right.suiteHash) return false;
  const carriesBests = left.best !== undefined || right.best !== undefined;
  if (carriesBests && !sameBests(left.best, right.best)) return false;
  if (stamped || carriesBests) return true;
  const a = Date.parse(left.recordedAt);
  const b = Date.parse(right.recordedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) < 2000;
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
 * top-level facts a committed curve carries — the knee, the suite hash, the
 * era's best times — pass through untouched: they are the parts every reader
 * compares, and dropping any of them would turn the committed file back into
 * something the next run cannot build on. The other counts' tables stay out —
 * a count CI does not run is not a budget question, and the raw reports keep
 * everything — and the temp path stays out everywhere. When the measurement
 * carries neither a pin nor a knee, no run carries the table, which is the
 * shape the file had before any of it was kept.
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
