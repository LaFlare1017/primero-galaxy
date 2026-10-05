/**
 * Whether the `E2E_WORKERS` committed in ci.yml still matches the knee the
 * bench measured.
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
 *     skip, because CI cannot run the bench either: the `E2E worker curve` job
 *     owns that, and a warning here would be a warning about a fact CI has no
 *     way to establish.
 *
 * The one thing that warns everywhere is a genuine contradiction: a runner's
 * own measurement of the current suite, disagreeing with the pin committed
 * beside it. That is `warn` rather than `fail` so a local run reports it
 * without blocking, and it still blocks CI, which runs `--strict`.
 *
 * The pin itself is read through `scripts/e2e-pin.mjs`, which the bench also
 * imports — two readers of ci.yml would be two chances to disagree about what
 * the pin is.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CURVE, pinnedWorkers } from '../../e2e-pin.mjs';
import { commit, git, track, write } from '../fixture.mjs';
import { git as gitHere } from '../lib.mjs';

const MEASURE = 'npm run e2e:bench -- --workers=2,3,4 --json=e2e/worker-curve.json --force';

/**
 * When the suite or the pin last changed, as a date, or null when this
 * repository cannot say.
 *
 * Null rather than "now": a checkout with no history for these paths has not
 * proved the measurement is current, and it has not proved it is stale either.
 * Treating "cannot tell" as fresh would let a shallow clone quietly accept a
 * curve of a suite it has never seen.
 */
function suiteChangedAt(root) {
  let when;
  try {
    when = gitHere(['log', '-1', '--format=%cI', '--', 'e2e', '.github/workflows/ci.yml'], { cwd: root });
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
  return { knee: parsed.knee, hosted: parsed.hosted === true, recordedAt: Date.parse(parsed.recordedAt) };
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
      level: 'warn',
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
      return unanswerable(
        `${CURVE} was measured ${machine}, and a laptop's curve cannot settle a four-vCPU pin`,
        context,
      );
    }

    const changed = suiteChangedAt(root);
    if (changed !== null && read.recordedAt < changed) {
      return unanswerable(
        `${CURVE} was measured ${machine} before the suite or the pin last changed`,
        context,
      );
    }

    if (read.knee === pin) {
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
 */
function plant(root, { pin = 3, knee, hosted = true, recordedAt = undefined }) {
  pinOnly(root, pin);
  write(root, 'e2e/example.spec.ts', "import { test } from './worker-server';\n\ntest('an example', async () => {});\n");
  track(root, '.github/workflows/ci.yml', 'e2e/example.spec.ts');
  commit(root, 'the suite and the pin');
  write(root, CURVE, `${JSON.stringify(measurement({ pin, knee, hosted, recordedAt }), null, 2)}\n`);
  track(root, CURVE);
  commit(root, 'the measurement of it');
}