/**
 * Whether the `E2E_WORKERS` committed in ci.yml still matches the knee the
 * bench measured, and whether the per-test timeouts in the curve still match
 * the suite's current shape.
 *
 * The pin is a number in a workflow file arguing with a machine nobody here
 * has. It is 3 because 3 measured fastest on a four-vCPU runner, and every
 * later edit to the suite changed the answer the pin was standing on without
 * changing the pin. Nothing noticed, because the pin was never compared to
 * anything — the bench reported a curve on `main` pushes and into a job
 * summary, and a job summary is read by whoever happens to open the run.
 *
 * So the comparison lives here, where it runs before a commit and in the same
 * pass as everything else this checkout can be wrong about.
 *
 * It cannot measure. Measuring the knee means three full suite runs at
 * different worker counts — tens of minutes — and a doctor that spent that
 * would stop being run at all. So it reads a measurement the bench already
 * took, from `e2e/worker-curve.json`, and the interesting part is deciding
 * when that measurement is allowed to settle the question:
 *
 *   - Only a measurement taken ON THE RUNNER settles it. A laptop curve is a
 *     real measurement of a different machine, and comparing it to a
 *     four-vCPU pin would be inventing a fact. The bench says the same thing
 *     about itself, which is why `hosted` is part of the reading and not a
 *     detail.
 *   - Only a measurement taken AFTER the last change to the suite settles it.
 *     A curve of a suite that has since been edited is a curve of something
 *     else, and disagreeing with today's pin about yesterday's timings is not
 *     a finding.
 *   - No measurement, or one that settles nothing, is UNKNOWN — not a pass.
 *     Locally that is a warning with the command to fix it. On CI it is a
 *     skip, because CI cannot run the bench either: the `E2E worker curve`
 *     job owns that, and a warning here would be a warning about a fact CI
 *     has no way to establish.
 *   - A measurement taken on a machine that is not the runner is a SKIP, not
 *     a warning, and on either kind of machine. It is not a contradiction and
 *     not something a local run can follow up on by re-measuring — a laptop
 *     re-measures a laptop — so a standing warning would only repeat what the
 *     person running the doctor already knows: the fix is to get the runner
 *     to measure, which is the `E2E worker curve` job.
 *
 * The committed curve also keeps a per-run timeout list: every test that hit
 * whatever timeout applied to it — the suite's 150-second default or the
 * test's own `test.setTimeout` budget — before it reached its assertion. That
 * list is the only durable memory of a workload's tail shape, and it is the
 * shape that decides whether three workers is a fast count or a failing one on
 * the runner — the knee is a summary of it, but the summary is the part that
 * can be wrong about the cause. So this check reads the list the same way the
 * bench does, and asks the one question a static read can answer about it: do
 * the files it name still belong to the suite? A timeout whose file has been
 * deleted is a list that has drifted from the suite it guards.
 *
 * The curve's per-test timings answer a second question the knee cannot. The
 * suite commits a budget per test — an explicit `test.setTimeout(600_000)` in
 * the spec, the config's 150-second default for a test that declares none —
 * and every budget here was sized from a loaded measurement, with the margin
 * it left spelled out in the comment above it. Budgets erode the way the pin
 * does: the suite grows, the budget keeps yesterday's number. So this check
 * compares each committed budget against what the curve measured for that
 * same test AT THE PINNED COUNT — the run the knee is read from — and
 * reports the tests the measurement has caught up with. A test measuring over
 * its budget times out on the next run at that count; one measuring within a
 * fifth of it has spent the margin its comment promised. What the doctor
 * cannot re-derive is the margin itself — that was a judgment about headroom,
 * and it lives in the spec.
 *
 * The pin itself is read through `scripts/e2e-pin.mjs`, which the bench also
 * imports — two readers of ci.yml would be two chances to disagree about what
 * the pin is.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { CURVE, pinnedWorkers } from '../../e2e-pin.mjs';
import { commit, git, track, write } from '../fixture.mjs';
import { git as gitHere } from '../lib.mjs';

const MEASURE = 'npm run e2e:bench -- --workers=2,3,4 --repeat=2 --json=e2e/worker-curve.json --force';

/**
 * A budget whose measurement has come within this share of it has spent the
 * margin it was sized with. Every budget comment in this suite promises a
 * multiple of its loaded measurement — 2.2x, 2.4x, 3x — so what is left at
 * four fifths gone is not a margin, it is the last fifth, and it is reported
 * as spent rather than waiting for the run that proves it was.
 */
const TIGHT = 0.8;

/**
 * When the suite or the pin last changed, as a date, or null when this
 * repository cannot say.
 *
 * The measurement file itself is excluded, because committing a hosted
 * measurement is how the pin gets its proof on disk — including the file
 * would make every committed measurement stale against its own commit, which
 * is the exact state this check exists to confirm.
 *
 * Null rather than "now": a checkout with no history for these paths has not
 * proved the measurement is current, and it has not proved it is stale either.
 * Treating "cannot tell" as fresh would let a shallow clone quietly accept a
 * curve of a suite it has never seen.
 */
function suiteChangedAt(root) {
  let when;
  try {
    // Exclude the measurement file: committing it is the proof step, and
    // including it would mark every committed measurement as stale.
    when = gitHere(
      ['log', '-1', '--format=%cI', '--', ':!e2e/worker-curve.json', 'e2e', '.github/workflows/ci.yml'],
      { cwd: root },
    );
  } catch {
    return null;
  }
  if (when === '') return null;
  const parsed = Date.parse(when);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * A measurement, or the reason this file is not one.
 *
 * The two refusals are a failure rather than a warning, because they are the
 * states where the check could not look: a file that is not JSON, and a file
 * that parses but carries no knee. Both print exactly what a check with
 * nothing wrong prints.
 */
function readMeasurement(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { error: `it could not be read (${error.code ?? error.message})` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: `it is not JSON (${error.message})` };
  }
  if (parsed === null || typeof parsed !== 'object') return { error: 'it is JSON, and not an object' };
  if (!Number.isInteger(parsed.knee)) return { error: 'it carries no knee — not a curve measurement' };
  if (!Number.isInteger(parsed.pin)) return { error: 'it carries no pin — not a curve measurement' };
  const recordedAt = Date.parse(parsed.recordedAt);
  if (Number.isNaN(recordedAt)) return { error: 'it carries no recordedAt — not a curve measurement' };
  return {
    knee: parsed.knee,
    hosted: parsed.hosted === true,
    recordedAt,
    perTestTimeouts: perTestTimeoutsFrom(parsed.runs),
    runs: Array.isArray(parsed.runs) ? parsed.runs : null,
  };
}

/**
 * The union of every test that timed out across the committed runs, as the
 * bench writes them: the file as the report spells it, then ` › `, then the
 * test's title.
 *
 * A timeout here is a test caught by whatever timeout applied to it — the
 * suite's default or that test's own budget — on one of the measured counts.
 * The committed file keeps one raw list per run, un-deduped: the bench's
 * cross-run dedup happens in its summary, which the committed shape does not
 * carry. So this check takes the union itself, which also makes the order
 * independent of how many runs recorded the same test.
 */
function perTestTimeoutsFrom(runs) {
  if (!Array.isArray(runs)) return null;
  const timeouts = new Set();
  for (const run of runs) {
    if (!Array.isArray(run.timeouts)) continue;
    for (const timeout of run.timeouts) {
      if (typeof timeout === 'string' && timeout.length > 0) timeouts.add(timeout);
    }
  }
  if (timeouts.size === 0) return [];
  // Stable, deterministic order: the bench emits them sorted by file then title.
  return [...timeouts].sort();
}

/**
 * A question this check could not answer.
 *
 * Asked of a developer's machine that is a warning, because that is the person
 * who can go and measure. Asked on CI it is a skip, because CI cannot measure
 * it either — the bench would take longer than the job, and the `E2E worker
 * curve` job already exists to do it. A skip here is not silence about the
 * pin; it is a statement that answering it is somebody else's step.
 */
function unanswerable(detail, context, hint = []) {
  if (context.ci) {
    return {
      level: 'skip',
      detail: `${detail} — CI cannot measure the curve, so the \`E2E worker curve\` job settles the pin`,
    };
  }
  return { level: 'warn', detail: `${detail} — nothing has checked the pin against a knee`, hint: [MEASURE, ...hint] };
}

export default {
  name: 'worker-pin',
  order: 85,
  proof: [
    {
      level: 'pass',
      repo: true,
      why: 'a runner measurement of the current suite whose knee is the committed pin — the state this check exists to confirm',
      setup: (root) => plant(root, { pin: 3, knee: 3 }),
    },
    {
      level: 'warn',
      repo: true,
      why: "a runner measurement of the current suite putting the knee somewhere else, which is the pin having gone stale against its own evidence",
      setup: (root) => plant(root, { pin: 3, knee: 4 }),
    },
    {
      level: 'warn',
      why: 'no measurement at all, so the pin is compared against nothing and reads as agreed when it is only unexamined',
      setup: (root) => pinOnly(root),
    },
    {
      level: 'skip',
      repo: true,
      why: 'a measurement taken on a developer machine, which is a real number about a different computer and cannot settle a four-vCPU pin',
      setup: (root) => plant(root, { pin: 3, knee: 4, hosted: false }),
    },
    {
      level: 'warn',
      repo: true,
      why: 'a runner measurement older than the last edit to the suite — a curve of a suite that no longer exists',
      setup: (root) => plant(root, { pin: 3, knee: 4, recordedAt: '2020-01-01T00:00:00.000Z' }),
    },
    {
      level: 'fail',
      repo: true,
      why: 'the committed file is not JSON, which is the check unable to look rather than the pin being wrong',
      setup: (root) => {
        pinOnly(root);
        write(root, CURVE, 'this is not json\n');
      },
    },
    {
      level: 'fail',
      repo: true,
      why: 'the committed file is JSON with no knee in it — a measurement written by something that is not this bench',
      setup: (root) => {
        pinOnly(root);
        write(root, CURVE, JSON.stringify({ recordedAt: '2024-01-01T00:00:00.000Z', hosted: true }));
      },
    },
    {
      level: 'skip',
      why: 'no workflow declaring a pin, so there is nothing to compare a knee to',
      setup: (root) => write(root, CURVE, JSON.stringify(measurement({ knee: 3 }))),
    },
    {
      level: 'skip',
      context: { ci: true },
      repo: true,
      why: 'CI with no measurement: a skip rather than a warning, because CI cannot run the bench that would answer it',
      setup: (root) => plant(root, { pin: 3, knee: 4, hosted: false }),
    },
    {
      level: 'pass',
      repo: true,
      why: 'a knee-matching measurement whose per-test timeout list still names only tests that are in the current suite — the tail shape is current along with the knee',
      setup: (root) => {
        plant(root, { pin: 3, knee: 3, config: true });
        write(root, CURVE, JSON.stringify(measurement({ pin: 3, knee: 3, runs: [{ timeouts: ['example.spec.ts › an example'] }] }), null, 2));
        track(root, CURVE);
        commit(root, 'a measurement whose timeout list still applies');
      },
    },
    {
      level: 'warn',
      repo: true,
      why: 'a knee-matching measurement whose per-test timeout list names a file that is no longer in the suite — the tail shape has drifted even though the fastest count has not',
      setup: (root) => {
        plant(root, { pin: 3, knee: 3, config: true });
        write(root, CURVE, JSON.stringify(measurement({ pin: 3, knee: 3, runs: [{ timeouts: ['removed.spec.ts › a removed test'] }] }), null, 2));
        track(root, CURVE);
        commit(root, 'a measurement whose timeout list names a gone file');
      },
    },
    {
      level: 'skip',
      repo: true,
      why: 'a knee-matching measurement whose timeout list is stale on CI, where the runner is the only machine that can re-measure it',
      context: { ci: true },
      setup: (root) => {
        plant(root, { pin: 3, knee: 3, config: true });
        write(root, CURVE, JSON.stringify(measurement({ pin: 3, knee: 3, runs: [{ timeouts: ['removed.spec.ts › a removed test'] }] }), null, 2));
        track(root, CURVE);
        commit(root, 'a CI checkout whose timeout list names a gone file');
      },
    },
    {
      level: 'pass',
      repo: true,
      why: 'a knee-matching measurement with no per-test timeouts, which is the shape of a suite whose floor is not a single test timing out',
      setup: (root) => {
        plant(root, { pin: 3, knee: 3 });
        write(root, CURVE, JSON.stringify(measurement({ pin: 3, knee: 3, runs: [{ timeouts: [] }] }), null, 2));
        track(root, CURVE);
        commit(root, 'a measurement with an empty timeout list');
      },
    },
    {
      level: 'pass',
      repo: true,
      why: 'a knee-matching measurement whose per-test timings sit well inside the budgets the suite commits — the tail the budgets were sized for is still the tail the suite has',
      setup: (root) => {
        plant(root, { pin: 3, knee: 3, config: true });
        write(root, CURVE, JSON.stringify(
          measurement({ pin: 3, knee: 3, runs: [{ count: 3, tests: [{ test: 'example.spec.ts › an example', ms: 20_000 }] }] }),
          null,
          2,
        ));
        track(root, CURVE);
        commit(root, 'a measurement whose timings fit the budgets');
      },
    },
    {
      level: 'warn',
      repo: true,
      why: 'a test measuring within a fifth of the budget committed for it — the margin the budget was sized with has been spent, and the next slow run times out',
      setup: (root) => {
        plant(root, { pin: 3, knee: 3, config: true });
        write(root, CURVE, JSON.stringify(
          measurement({ pin: 3, knee: 3, runs: [{ count: 3, tests: [{ test: 'example.spec.ts › an example', ms: 130_000 }] }] }),
          null,
          2,
        ));
        track(root, CURVE);
        commit(root, 'a measurement that has spent a budget margin');
      },
    },
    {
      level: 'warn',
      repo: true,
      why: 'a test measuring over the budget committed for it — the next run at the pinned count times out before the test reaches its assertion',
      setup: (root) => {
        plant(root, { pin: 3, knee: 3, config: true });
        write(root, CURVE, JSON.stringify(
          measurement({ pin: 3, knee: 3, runs: [{ count: 3, tests: [{ test: 'example.spec.ts › an example', ms: 200_000 }] }] }),
          null,
          2,
        ));
        track(root, CURVE);
        commit(root, 'a measurement that has outgrown its budget');
      },
    },
    {
      level: 'warn',
      repo: true,
      why: 'a test measuring over its own explicit test.setTimeout, while still under the suite default — proof the budget was read out of the spec and not out of the config',
      setup: (root) => {
        plant(root, {
          pin: 3,
          knee: 3,
          config: true,
          spec: "import { test } from './worker-server';\n\ntest('an example', async () => {\n  test.setTimeout(60_000);\n});\n",
        });
        write(root, CURVE, JSON.stringify(
          measurement({ pin: 3, knee: 3, runs: [{ count: 3, tests: [{ test: 'example.spec.ts › an example', ms: 70_000 }] }] }),
          null,
          2,
        ));
        track(root, CURVE);
        commit(root, 'a measurement that has outgrown its own budget');
      },
    },
    {
      level: 'skip',
      repo: true,
      context: { ci: true },
      why: 'a budget the curve has outgrown, on CI — the fix is a runner re-measure or an edited budget, and neither is CI to do from a doctor run',
      setup: (root) => {
        plant(root, { pin: 3, knee: 3, config: true });
        write(root, CURVE, JSON.stringify(
          measurement({ pin: 3, knee: 3, runs: [{ count: 3, tests: [{ test: 'example.spec.ts › an example', ms: 200_000 }] }] }),
          null,
          2,
        ));
        track(root, CURVE);
        commit(root, 'a CI checkout whose measurement outgrew its budget');
      },
    },
  ],

  run(root, context) {
    const pin = pinnedWorkers(root);
    if (pin === null) {
      return { level: 'skip', detail: 'no E2E_WORKERS in .github/workflows/ci.yml, so there is no pin to check' };
    }

    const path = join(root, CURVE);
    if (!existsSync(path)) {
      return unanswerable(`${CURVE} holds no measurement`, context, [
        'the `E2E worker curve` job writes one on the runner; locally, run:',
      ]);
    }

    const read = readMeasurement(path);
    if (read.error !== undefined) {
      return {
        level: 'fail',
        detail: `${CURVE} could not be read as a curve measurement — ${read.error}`,
        hint: [`${MEASURE} rewrites it`, 'a half-written file is not a measurement of anything'],
      };
    }

    const machine = read.hosted ? 'on the runner' : 'on a machine that is not the runner';
    if (!read.hosted) {
      return {
        level: 'skip',
        detail: `${CURVE} was measured ${machine}, and a laptop's curve cannot settle a four-vCPU pin`,
        hint: ['the `E2E worker curve` job is the measurement that settles this pin'],
      };
    }

    const changed = suiteChangedAt(root);
    if (changed !== null && read.recordedAt < changed) {
      return unanswerable(
        `${CURVE} was measured ${machine} before the suite or the pin last changed`,
        context,
      );
    }

    if (read.knee === pin) {
      const stale = checkTimeouts(root, context, read);
      if (stale !== undefined) return stale;
      const spent = checkBudgets(root, context, read, pin);
      if (spent !== undefined) return spent;
      return {
        detail: `E2E_WORKERS is ${pin} and the runner's measured knee is ${read.knee} — the pin is behind a measurement`,
      };
    }
    return {
      level: 'warn',
      detail: `E2E_WORKERS is ${pin} but the runner's measured knee is ${read.knee}`,
      hint: [
        `the knee is the cheapest count within ${Math.round((read.within ?? 0.1) * 100)}% of the fastest green count`,
        'change E2E_WORKERS in ci.yml to match, or re-measure if the suite moved since',
        MEASURE,
      ],
    };
  },
};

/**
 * Whether the budgets the suite commits still cover what the curve measured
 * for the same tests, at the count the pin commits to.
 *
 * A budget is the timeout a test runs under: an explicit `test.setTimeout` in
 * its spec, or the suite default when it declares none. Every budget in this
 * suite was sized from a loaded measurement, with the margin it left spelled
 * out in the comment above it — and a budget erodes the way the pin does,
 * because the suite grows while the number stands still. So the comparison is
 * against the pinned count's own run, the run the knee is read from: a test
 * measuring over its budget times out on the next run at that count, and one
 * within a fifth of it has spent the margin its comment promised without
 * having failed yet. Findings about the other counts are not findings about
 * the pin — the bench already names a count whose run timed out, and the knee
 * carries the summary.
 *
 * Attribution is textual, and it is honest about that. The report names a test
 * as `file › title`, the title being the test's own and not its describes',
 * so each `test.setTimeout` is read as belonging to the nearest `test('…')`
 * declaration before it — the shape every spec here uses, the call sitting at
 * the top of the test body it budgets. A curve entry whose title cannot be
 * found in the file it names is left alone rather than charged to the default,
 * because an unfindable title is exactly the case where guessing a budget
 * would invent a finding: a test renamed since the measurement, a title built
 * at runtime, a budget living in a beforeEach. Those need a re-measure, which
 * is the next runner run, not a warning with a wrong number in it.
 *
 * Curves without the per-test list are left alone too: `committedCurve` drops
 * `tests` from future committed curves, and a per-FILE total is not a budget
 * for any one test in the file — comparing one to the other would flag a file
 * whose tests merely add up past a budget none of them exceeds. The per-test
 * list is what makes this comparison per-test, and without it there is
 * nothing here to say.
 */
function checkBudgets(root, context, read, pin) {
  const pinnedRun = (read.runs ?? []).find((run) => run && run.count === pin);
  const tests = pinnedRun !== undefined && Array.isArray(pinnedRun.tests) ? pinnedRun.tests : null;
  if (tests === null || tests.length === 0) return undefined;
  const suite = suiteSpecs(root);
  if (suite === null) return undefined;

  const parsed = new Map();
  const parse = (path, text) => {
    let tree = parsed.get(path);
    if (tree === undefined) {
      tree = { titles: declaredTitles(text), budgets: budgetsIn(text) };
      parsed.set(path, tree);
    }
    return tree;
  };

  const overBudget = [];
  const tight = [];
  for (const entry of tests) {
    if (entry === null || typeof entry.test !== 'string') continue;
    const ms = Number(entry.ms);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    const at = entry.test.indexOf(' › ');
    if (at === -1) continue;
    const file = entry.test.slice(0, at);
    const title = entry.test.slice(at + 3);
    const spec = specTextFor(suite, file);
    if (spec === null) continue;
    const tree = parse(spec.path, spec.text);
    if (!tree.titles.has(title)) continue;
    const budget = tree.budgets.get(title) ?? suite.defaultMs;
    if (ms > budget) overBudget.push({ test: entry.test, ms, budget });
    else if (ms >= budget * TIGHT) tight.push({ test: entry.test, ms, budget });
  }
  if (overBudget.length === 0 && tight.length === 0) return undefined;

  const label =
    overBudget.length > 0
      ? `${overBudget.length} test(s) at the pinned count measured over the timeout committed for them`
      : `${tight.length} test(s) at the pinned count measured to within a fifth of the timeout committed for them`;
  const found = overBudget.length > 0 ? overBudget : tight;
  return {
    level: context.ci ? 'skip' : 'warn',
    detail: `${label} — ${formatTimeouts(found.map((f) => `${f.test} (${formatMs(f.ms)} of a ${formatMs(f.budget)} budget)`))}`,
    ...(context.ci
      ? {}
      : {
          hint: [
            'the committed budgets were sized from a loaded measurement, and the suite has grown into the margin they left',
            'raise the budget in the spec, or re-measure before deciding the budget is the thing that moved',
            MEASURE,
          ],
        }),
  };
}

/**
 * The text of the suite file a curve entry names, or null when none matches.
 *
 * The report's spelling is relative to the test directory; the walk's is
 * relative to the repository root. The same rule as `testInSuite` covers both
 * spellings: a path that equals the name, or ends with `/` before it.
 */
function specTextFor(suite, file) {
  if (!file) return null;
  for (const [path, text] of suite.files) {
    if (path === file || path.endsWith(`/${file}`)) return { path, text };
  }
  return null;
}

/**
 * Every title the spec declares a test with, read out of `test('…')` calls in
 * the source.
 *
 * The report's `title` is the test's own, without the describes around it, so
 * the match is against the declaration's own string and not against a
 * reconstructed full title path — reconstructing one would mean parsing the
 * describes, and a parser that guessed wrong at nesting would silently drop
 * every test under it.
 */
function declaredTitles(text) {
  const titles = new Set();
  for (const m of text.matchAll(/\btest\s*\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
    titles.add(m[2].replace(/\\(.)/g, '$1'));
  }
  return titles;
}

/**
 * Each explicit budget the spec commits, as a map from test title to
 * milliseconds.
 *
 * `test.setTimeout` is a call inside the test's own body — the budget for the
 * test declared above it — so each call is attributed to the nearest
 * `test('…')` declaration before it, and the first call inside a body wins,
 * because that is the one that set the budget the test ran under. A call with
 * no declaration above it is a call this read cannot attribute, and is left
 * out rather than guessed at.
 */
function budgetsIn(text) {
  const declarations = [...text.matchAll(/\btest\s*\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)].map((m) => ({
    at: m.index,
    title: m[2].replace(/\\(.)/g, '$1'),
  }));
  const budgets = new Map();
  for (const m of text.matchAll(/\btest\.setTimeout\s*\(\s*(\d[\d_]*)/g)) {
    const ms = Number(m[1].replaceAll('_', ''));
    let owner = null;
    for (const declaration of declarations) {
      if (declaration.at >= m.index) break;
      owner = declaration.title;
    }
    if (owner !== null && !budgets.has(owner)) budgets.set(owner, ms);
  }
  return budgets;
}

/**
 * A duration the way the budget comments write one: seconds, or minutes and
 * seconds once the seconds stop fitting on a line.
 */
function formatMs(ms) {
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 120) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${Math.round(seconds % 60)}s`;
}

/**
 * Whether the committed per-test timeout list still names tests that belong to
 * the current suite.
 *
 * Only asked when the knee already matches the pin, because a mismatched knee
 * is the finding this pass is here for and a stale timeout list is a second
 * finding layered on top of a correct one — the check reports the first one it
 * reaches, and a pin that is wrong about the fastest count is more important
 * than a pin that is right about the fastest count and stale about which test
 * is carrying it.
 *
 * Every committed run keeps its own raw timeout list, as `file › title`
 * strings in the report's own spelling of the file — relative to the test
 * directory, so `galaxy-keys.spec.ts`, not `e2e/galaxy-keys.spec.ts`. This
 * check takes the union across runs and asks, for each, whether the file it
 * names is still reachable from the suite's config. That is all a static read
 * can ask: whether the suite would time out the same tests today is a
 * measurement, and the runner is the only machine that can take it. A timeout
 * whose file has been deleted is a list that has drifted from the suite it
 * guards; a timeout whose file is still present is the list still applying,
 * and the next runner measurement says whether it still applies on the day.
 */
function checkTimeouts(root, context, read) {
  const committed = read.perTestTimeouts;
  if (committed === null || committed.length === 0) return undefined;
  const suite = suiteSpecs(root);
  if (suite === null) return undefined;
  const notInSuite = committed.filter((t) => !testInSuite(t, suite));
  if (notInSuite.length === 0) return undefined;
  return {
    level: context.ci ? 'skip' : 'warn',
    detail: `the committed measurement lists ${notInSuite.length} timeout(s) for file(s) no longer in the suite — ${formatTimeouts(notInSuite)}`,
    ...(context.ci
      ? {}
      : {
          hint: [
            'the committed timeout list is the suite\'s tail shape, and a tail whose files have gone is a tail that no longer applies',
            'the knee can still be right about the fastest count while its timeout list is stale about which tests carry it',
            're-measure on the runner to refresh both the knee and the timeout list',
            MEASURE,
          ],
        }),
  };
}

/**
 * Whether the `file › title` string names a file in the suite.
 *
 * The report spells files relative to the test directory
 * (`galaxy-keys.spec.ts`); a walk of the suite produces repository-relative
 * paths (`e2e/galaxy-keys.spec.ts`). Both spellings are true at once, so the
 * file half matches a suite path that equals it or ends with `/` before it —
 * matching by suffix rather than equality is what keeps this check honest
 * about whichever spelling the bench used.
 */
function testInSuite(timeout, suite) {
  if (typeof timeout !== 'string') return false;
  const file = timeout.split(' › ')[0];
  if (!file) return false;
  for (const path of suite.files.keys()) {
    if (path === file || path.endsWith(`/${file}`)) return true;
  }
  return false;
}

/**
 * The suite as the configs declare it: each spec file's text, keyed by its
 * repository-relative path, and the timeout a test without an explicit budget
 * runs under.
 *
 * Read from the same source Playwright uses to find the suite — the config's
 * `testDir` and `testMatch` — because a file not reachable from those is not
 * in the suite, and a curve that names a file outside them is naming a
 * different suite. Null means the config could not be read — not that the
 * suite is empty.
 */
function suiteSpecs(root) {
  const config = join(root, 'playwright.config.ts');
  let text;
  try {
    text = readFileSync(config, 'utf8');
  } catch {
    return null;
  }
  const testDir = testDirFrom(text);
  if (testDir === null) return null;
  const fullDir = join(root, testDir);
  if (!existsSync(fullDir)) return null;
  const testMatch = testMatchFrom(text);
  const paths = [];
  walkSpecFiles(fullDir, testMatch, root, paths);
  const files = new Map();
  for (const full of paths) {
    try {
      files.set(relative(root, full), readFileSync(full, 'utf8'));
    } catch {
      // A file that vanished between the walk and the read is a file the
      // suite no longer has; leaving it out is the honest answer.
    }
  }
  return { files, defaultMs: suiteDefaultFrom(text) };
}

/**
 * The suite-wide default timeout a config declares, or Playwright's own when
 * the config says nothing.
 *
 * The first `timeout:` in the config is the suite-wide one in this repo's
 * shape, and `expect: { timeout }` matches the same pattern — which is why the
 * FIRST match wins: this config declares the suite default above its expect
 * timeout, and a config ordered the other way would hand this check an
 * assertion budget to compare against a test budget. That is a shape this
 * repo does not have; if it grows one, this is the line to fix.
 */
function suiteDefaultFrom(text) {
  const m = text.match(/\btimeout\s*:\s*(\d[\d_]*)/);
  return m ? Number(m[1].replaceAll('_', '')) : 30_000;
}

/**
 * The `testDir` a config declares, or null when the config says nothing.
 */
function testDirFrom(text) {
  const m = text.match(/testDir\s*:\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

/**
 * The `testMatch` patterns a config declares, or null when the config says
 * nothing — in which case the pattern is the one Playwright itself defaults
 * to: every file ending in `.spec.ts`, under the test directory, at any depth.
 */
function testMatchFrom(text) {
  const m = text.match(/testMatch\s*:\s*\[([^\]]+)\]/);
  if (!m) return null;
  return m[1].match(/['"]([^'"]+)['"]/g)?.map((s) => s.slice(1, -1)) ?? null;
}

/**
 * Every spec file under a test directory, filtered by the config's testMatch,
 * as full paths.
 */
function walkSpecFiles(dir, testMatch, root, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSpecFiles(full, testMatch, root, out);
    } else if (entry.isFile() && matchesTestMatch(full, testMatch)) {
      out.push(full);
    }
  }
}

/**
 * Whether a file matches the config's testMatch patterns, or the Playwright
 * default when the config declares none.
 */
function matchesTestMatch(full, testMatch) {
  const patterns = testMatch ?? ['**/*.spec.ts'];
  return patterns.some((pattern) => specMatch(pattern, full));
}

/**
 * Whether a file path matches one of the patterns the suite's config actually
 * uses. Nothing general — only the shapes this repo's configs have.
 */
function specMatch(pattern, full) {
  if (pattern === '**/*.spec.ts') return full.endsWith('.spec.ts');
  if (pattern.endsWith('.spec.ts')) return full.endsWith(pattern);
  if (pattern.startsWith('*.')) return full.endsWith(pattern.slice(1));
  return full === pattern || full.endsWith('/' + pattern);
}

/**
 * The first few named things, on one line — a doctor detail is one line, and
 * a finding that wraps its list across several of them is a finding nobody
 * reads to the end of.
 */
function formatTimeouts(items) {
  const shown = items.slice(0, 3);
  const extra = items.length - shown.length;
  const text = shown.join('; ');
  return extra > 0 ? `${text}; and ${extra} more` : text;
}

/**
 * The suite config a fixture carries when a scenario needs the timeout checks
 * to engage: the two facts the real config declares, and nothing else, because
 * a fixture is not the place to maintain a second copy of the whole file.
 */
const SUITE_CONFIG = "import { defineConfig } from '@playwright/test';\n\nexport default defineConfig({\n  testDir: './e2e',\n  timeout: 150_000,\n});\n";

/** A measurement as a JSON object, with the runner's shape unless overridden. */
function measurement(overrides) {
  return {
    recordedAt: new Date().toISOString(),
    machine: { platform: 'linux x64', cores: 4 },
    hosted: true,
    pin: 3,
    fastest: 3,
    knee: 3,
    within: 0.1,
    ...overrides,
  };
}

/** A workflow carrying a pin and nothing else — the half a fixture needs. */
function pinOnly(root, pin = 3) {
  write(root, '.github/workflows/ci.yml', `jobs:\n  e2e:\n    steps:\n      - env:\n          E2E_WORKERS: '${pin}'\n`);
}

/**
 * A fixture holding a committed pin and a measurement of it.
 *
 * The suite files are committed BEFORE the measurement is written, so a
 * scenario that means to be current really is: the last change to `e2e/` is
 * the commit this fixture made, and the measurement is timestamped after it.
 * A scenario that means to be stale passes an old `recordedAt` and gets the
 * same ordering.
 *
 * `config` writes a playwright.config.ts alongside the suite — the testDir and
 * the default timeout, the two facts the timeout comparisons read — and
 * commits it with the suite, because a config committed after the measurement
 * would be a checkout where the config postdates the curve, which is not the
 * staleness any scenario here is about. `spec` replaces the example test, for
 * the scenarios whose finding depends on the shape of the spec itself.
 */
function plant(root, { pin = 3, knee, hosted = true, recordedAt = undefined, spec = undefined, config = false }) {
  pinOnly(root, pin);
  write(root, 'e2e/example.spec.ts', spec ?? "import { test } from './worker-server';\n\ntest('an example', async () => {});\n");
  if (config) write(root, 'playwright.config.ts', SUITE_CONFIG);
  track(root, '.github/workflows/ci.yml', 'e2e/example.spec.ts', ...(config ? ['playwright.config.ts'] : []));
  commit(root, 'the suite and the pin');
  // Only an explicitly given recordedAt goes into the overrides: a literal
  // `recordedAt: undefined` would spread OVER the measurement helper's default
  // timestamp and write a curve with no recordedAt at all — a file this
  // check refuses to read, which is not the state any scenario here means.
  const overrides = { pin, knee, hosted };
  if (recordedAt !== undefined) overrides.recordedAt = recordedAt;
  write(root, CURVE, `${JSON.stringify(measurement(overrides), null, 2)}\n`);
  track(root, CURVE);
  commit(root, 'the measurement of it');
}