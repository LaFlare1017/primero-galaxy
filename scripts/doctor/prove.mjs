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
 * The state is kept rather than folded into the level it produced, because the
 * level cannot be read back: that a check reports `fail` says nothing about
 * whether it refused the era declared backwards, the era that never landed on
 * this branch, or the shallow clone that cannot see the era — three states, one
 * word. The result below carries them, and the report prints one line each, so
 * the reasons are the proof and not a remark about it.
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
  const fixtures = [];
  try {
    for (const [what, check, level] of RUNNER) {
      const found = findingFrom(check, root, {});
      const held = found.level === level;
      fixtures.push({ level, why: what, held, reported: held ? null : found });
    }
  } finally {
    discard(root);
  }
  return {
    name: 'runner',
    levels: [...new Set(fixtures.map((fixture) => fixture.level))],
    fixtures,
    failures: fixtures.filter((fixture) => !fixture.held).length,
    scenarios: RUNNER.length,
  };
}

/**
 * Runs every check's proof. Returns one result per check plus the runner's, the
 * total number of fixtures built, and the failures — which the caller folds into
 * its verdict, because a doctor whose proof failed has not answered anything.
 *
 * Each result carries a record per scenario — the level it claims, the state
 * that is supposed to make it happen, and how the check answered — because the
 * caller prints those records: the state is what proves the level, and a level
 * counted without the state behind it is the number this section exists to
 * replace.
 */
export function prove(checks) {
  const results = [];
  let scenarios = 0;
  let failures = 0;

  for (const check of checks) {
    const fixtures = [];
    for (const scenario of claims(check)) {
      scenarios += 1;
      const root = scenario.repo ? newRepo() : newRoot();
      try {
        scenario.setup(root);
        const found = findingFrom(check, root, scenario.context ?? {});
        const held = found.level === scenario.level;
        fixtures.push({ level: scenario.level, why: scenario.why, held, reported: held ? null : found });
      } finally {
        discard(root);
      }
    }
    const broken = fixtures.filter((fixture) => !fixture.held).length;
    failures += broken;
    results.push({
      name: check.name,
      levels: [...new Set(fixtures.map((fixture) => fixture.level))],
      fixtures,
      failures: broken,
    });
  }

  const runner = runnerProof();
  scenarios += runner.scenarios;
  failures += runner.failures;
  results.push(runner);

  return { results, scenarios, failures };
}
