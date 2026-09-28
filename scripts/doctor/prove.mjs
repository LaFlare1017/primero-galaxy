/**
 * The doctor's own proof: every check, pointed at a fixture checkout, at every
 * level it claims it can report.
 *
 * Both gates this doctor reads carry the same kind of fixture, and for the same
 * reason — the gitignore gate plants a tracked, ignored file and must catch it;
 * the untracked gate plants one artifact per kind of evidence plus a plain
 * source file that must come back unaccounted. A checker that has quietly
 * stopped checking prints exactly what a checker with nothing to report prints,
 * and no amount of reading the code settles which one is running. That risk is
 * worst here: this is the script that decides whether to believe everything
 * else, so until it is proved, its own good news is the only evidence it works.
 *
 * Every check therefore declares `proof`: the levels it claims, the fixture
 * state that makes each one happen, and why that state is the one that does.
 * Three things are refused rather than tolerated:
 *
 *   - a check with no proof at all. A level nothing has tested is a claim.
 *   - a scenario that cannot run: an unknown level, no setup, no reason. The
 *     reason is what makes the proof readable, and reading it is the point.
 *   - a check whose claims are all `pass` or `skip`. A check that cannot report
 *     bad news can only ever report good news, which is what a check that never
 *     looked reports too — and that is the failure this file exists for.
 *
 * The runner's own rules are proved as well, with checks that are objects rather
 * than files: one that throws, one that says nothing, one that returns nothing,
 * one that names a level nobody prints, and one that answers with a bare string.
 * That last pair is not a formality in either direction — "could not run"
 * reading as a pass is how a doctor lies, and a rule that rejects a terse answer
 * would break every check that gives one.
 */
import { discard, newRepo, newRoot } from './fixture.mjs';
import { findingFrom, MARKS } from './levels.mjs';

/** A check's scenarios, refused if the claims do not add up to a check. */
function claims(check) {
  const proof = check.proof;
  if (!Array.isArray(proof) || proof.length === 0) {
    throw new Error(`${check.name} carries no proof — a level nothing has tested is a claim, not a check`);
  }
  for (const scenario of proof) {
    if (!(scenario.level in MARKS)) {
      throw new Error(`${check.name} proves a level nobody prints: \`${scenario.level}\``);
    }
    if (typeof scenario.setup !== 'function') {
      throw new Error(`${check.name} claims ${scenario.level} with no setup — the fixture state is the proof`);
    }
    if (typeof scenario.why !== 'string' || scenario.why.trim() === '') {
      throw new Error(`${check.name} claims ${scenario.level} without saying why that state is the one`);
    }
  }
  const levels = [...new Set(proof.map((scenario) => scenario.level))];
  if (!levels.includes('warn') && !levels.includes('fail')) {
    throw new Error(
      `${check.name} proves only ${levels.join(', ')} — a check that cannot report bad news can only report good news`,
    );
  }
  return proof;
}

/** The runner, checkpoint by checkpoint, with the fake check that puts it there. */
const RUNNER = [
  ['a check that throws', { run: () => { throw new Error('the fixture cannot run'); } }, 'fail'],
  ['a check that says nothing', { run: () => ({ level: 'pass', detail: '   ' }) }, 'fail'],
  ['a check that returns nothing', { run: () => undefined }, 'fail'],
  ['a check that names a level nobody prints', { run: () => ({ level: 'broken', detail: 'invented' }) }, 'fail'],
  ['a check that answers in a bare string', { run: () => 'the fixture said so' }, 'pass'],
];

function runnerProof() {
  const root = newRoot();
  const failures = [];
  try {
    for (const [what, check, level] of RUNNER) {
      const found = findingFrom(check, root, {});
      if (found.level !== level) failures.push(`${what} reported ${found.level}, not ${level}`);
    }
  } finally {
    discard(root);
  }
  return { name: 'runner', levels: ['fail', 'pass'], failures, scenarios: RUNNER.length };
}

/**
 * Runs every check's proof. Returns one result per check plus the runner's, the
 * total number of fixtures built, and the failures — which the caller folds into
 * its verdict, because a doctor whose proof failed has not answered anything.
 */
export function prove(checks) {
  const results = [];
  let scenarios = 0;
  let failures = 0;

  for (const check of checks) {
    const held = [];
    const broken = [];
    for (const scenario of claims(check)) {
      scenarios += 1;
      const root = scenario.repo ? newRepo() : newRoot();
      try {
        scenario.setup(root);
        const { level, detail } = findingFrom(check, root, scenario.context ?? {});
        if (level === scenario.level) held.push(scenario.level);
        else broken.push(`claimed ${scenario.level} but reported ${level} — ${scenario.why} (it said: ${detail})`);
      } finally {
        discard(root);
      }
    }
    failures += broken.length;
    results.push({ name: check.name, levels: [...new Set(held)], failures: broken });
  }

  const runner = runnerProof();
  scenarios += runner.scenarios;
  failures += runner.failures.length;
  results.push(runner);

  return { results, scenarios, failures };
}
